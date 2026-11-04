import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Queue } from 'bullmq';
import { isValidObjectId, Model, Types } from 'mongoose';
import { emailHash, googlePhoneHash, metaPhoneHash, normalizeEmail, normalizePhone, sha256 } from '../common/utils/identity.js';
import { AdAccount, AdAccountDoc } from '../database/schemas/integration.schema.js';
import { Audience, AudienceDoc, AudienceMember, AudienceRules, AudienceType } from '../database/schemas/growth.schema.js';
import { Lead } from '../database/schemas/leads.schema.js';
import { Contact, TrackingEvent } from '../database/schemas/tracking.schema.js';
import { WorkspaceDoc } from '../database/schemas/workspace.schema.js';
import { ConnectionsService } from '../integrations/connections.service.js';
import { GoogleAdsClient } from '../integrations/platforms/google-ads.client.js';
import { PlatformError } from '../integrations/platforms/http.js';
import { MetaClient } from '../integrations/platforms/meta.client.js';
import { AutomationJob, QUEUES } from '../queues.js';
import { maskEmail, maskPhone } from './utils.js';

/** One person to upload. Hashes follow each platform's normalisation rules. */
interface Member {
  key: string;
  emailHash: string | null;
  metaPhoneHash: string | null;
  googlePhoneHash: string | null;
  hint: { name: string | null; email: string | null; phone: string | null };
}

export interface UploadRow {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
}

const SAMPLE_SIZE = 10;

/**
 * Audiences built from leads, tracked contacts or an uploaded list, synced to
 * Meta Custom Audiences and Google Customer Match. Every sync replaces the
 * platform list with the current members, so audiences stay in step with the
 * pipeline. People who opted out (`consent: false`) are always excluded.
 */
@Injectable()
export class AudiencesService {
  private readonly logger = new Logger(AudiencesService.name);

  constructor(
    @InjectModel(Audience.name) private readonly audiences: Model<Audience>,
    @InjectModel(AudienceMember.name) private readonly members: Model<AudienceMember>,
    @InjectModel(Lead.name) private readonly leads: Model<Lead>,
    @InjectModel(Contact.name) private readonly contacts: Model<Contact>,
    @InjectModel(TrackingEvent.name) private readonly events: Model<TrackingEvent>,
    @InjectModel(AdAccount.name) private readonly adAccounts: Model<AdAccount>,
    @InjectQueue(QUEUES.automation) private readonly queue: Queue,
    private readonly connections: ConnectionsService,
    private readonly google: GoogleAdsClient,
    private readonly meta: MetaClient,
  ) {}

  // ── Membership ────────────────────────────────────────────────────────────

  private since(days?: number) {
    return days ? new Date(Date.now() - days * 86_400_000) : null;
  }

  private member(name: string | null, email: string | null, phone: string | null): Member | null {
    const eh = email ? emailHash(email) : null;
    const key = eh ?? (phone ? metaPhoneHash(phone) : null);
    if (!key) return null;
    return {
      key,
      emailHash: eh,
      metaPhoneHash: phone ? metaPhoneHash(phone) : null,
      googlePhoneHash: phone ? googlePhoneHash(phone) : null,
      hint: { name, email: maskEmail(email), phone: maskPhone(phone) },
    };
  }

  /** Resolves the rule set to the current list of people (deduplicated). */
  async resolveMembers(workspaceId: Types.ObjectId, type: AudienceType, rules: AudienceRules, audienceId?: Types.ObjectId): Promise<Member[]> {
    const out = new Map<string, Member>();
    const add = (m: Member | null) => {
      if (m && !out.has(m.key)) out.set(m.key, m);
    };
    if (type === 'upload') {
      if (!audienceId) return [];
      for await (const m of this.members.find({ audienceId }).cursor()) {
        out.set(m.key, {
          key: m.key,
          emailHash: m.emailHash,
          metaPhoneHash: m.phoneHash,
          googlePhoneHash: m.googlePhoneHash,
          hint: { name: null, email: m.hint || null, phone: null },
        });
      }
      return [...out.values()];
    }
    const since = this.since(rules.createdWithinDays);
    if (type === 'leads') {
      const q: Record<string, unknown> = { workspaceId, consent: { $ne: false }, $or: [{ email: { $ne: null } }, { phone: { $ne: null } }] };
      const stage: Record<string, unknown> = {};
      if (rules.stages?.length) stage.$in = rules.stages;
      if (rules.excludeStages?.length) stage.$nin = rules.excludeStages;
      if (Object.keys(stage).length) q.stage = stage;
      if (rules.channels?.length) q.channel = { $in: rules.channels };
      if (rules.campaignIds?.length) q.campaignId = { $in: rules.campaignIds.filter(isValidObjectId).map((id) => new Types.ObjectId(id)) };
      if (since) q.createdAt = { $gte: since };
      for await (const l of this.leads.find(q, { name: 1, email: 1, phone: 1 }).cursor()) add(this.member(l.name, l.email, l.phone));
      return [...out.values()];
    }
    const q: Record<string, unknown> = { workspaceId, consent: { $ne: false }, $or: [{ email: { $ne: null } }, { phone: { $ne: null } }] };
    if (rules.minIntentScore) q.intentScore = { $gte: rules.minIntentScore };
    if (rules.contactStatus?.length) q.status = { $in: rules.contactStatus };
    if (since) q.createdAt = { $gte: since };
    if (rules.eventTypes?.length) {
      const evQ: Record<string, unknown> = { workspaceId, type: { $in: rules.eventTypes }, contactId: { $ne: null } };
      if (since) evQ.createdAt = { $gte: since };
      q._id = { $in: await this.events.distinct('contactId', evQ) };
    }
    for await (const c of this.contacts.find(q, { name: 1, email: 1, phone: 1 }).cursor()) add(this.member(c.name, c.email, c.phone));
    return [...out.values()];
  }

  private stats(members: Member[]) {
    return {
      size: members.length,
      emailCount: members.filter((m) => m.emailHash).length,
      phoneCount: members.filter((m) => m.metaPhoneHash).length,
    };
  }

  async preview(workspaceId: Types.ObjectId, type: AudienceType, rules: AudienceRules) {
    if (type === 'upload') throw new BadRequestException('Upload audiences have no rules to preview; upload a list instead');
    const members = await this.resolveMembers(workspaceId, type, rules);
    return { ...this.stats(members), sample: members.slice(0, SAMPLE_SIZE).map((m) => m.hint) };
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────

  private async view(a: AudienceDoc) {
    const accounts = new Map(
      (await this.adAccounts.find({ _id: { $in: a.destinations.map((d) => d.adAccountId) } }, { name: 1 })).map((x) => [x.id as string, x.name]),
    );
    return {
      id: a.id as string,
      name: a.name,
      description: a.description,
      type: a.type,
      rules: a.rules ?? {},
      autoSync: a.autoSync,
      size: a.size,
      emailCount: a.emailCount,
      phoneCount: a.phoneCount,
      lastComputedAt: a.lastComputedAt,
      createdAt: a.createdAt,
      destinations: a.destinations.map((d) => ({
        adAccountId: String(d.adAccountId),
        adAccountName: accounts.get(String(d.adAccountId)) ?? '',
        platform: d.platform,
        externalAudienceId: d.externalAudienceId,
        status: d.status,
        lastSyncedAt: d.lastSyncedAt,
        uploadedCount: d.uploadedCount,
        matchedCount: d.matchedCount,
        error: d.error,
      })),
    };
  }

  async list(workspaceId: Types.ObjectId) {
    const rows = await this.audiences.find({ workspaceId }).sort({ createdAt: -1 });
    return Promise.all(rows.map((a) => this.view(a)));
  }

  async get(workspaceId: Types.ObjectId, id: string) {
    const a = isValidObjectId(id) ? await this.audiences.findOne({ _id: id, workspaceId }) : null;
    if (!a) throw new NotFoundException('Audience not found');
    return a;
  }

  async detail(workspaceId: Types.ObjectId, id: string) {
    const a = await this.get(workspaceId, id);
    const members = await this.resolveMembers(workspaceId, a.type, a.rules ?? {}, a._id);
    return { ...(await this.view(a)), sample: members.slice(0, SAMPLE_SIZE).map((m) => m.hint) };
  }

  private async recompute(a: AudienceDoc) {
    const members = await this.resolveMembers(a.workspaceId, a.type, a.rules ?? {}, a._id);
    Object.assign(a, this.stats(members), { lastComputedAt: new Date() });
    await a.save();
    return members;
  }

  async create(workspaceId: Types.ObjectId, userId: string, input: { name: string; description?: string; type: AudienceType; rules?: AudienceRules; autoSync?: boolean }) {
    const a = await this.audiences.create({
      workspaceId,
      name: input.name.trim(),
      description: input.description ?? '',
      type: input.type,
      rules: input.type === 'upload' ? {} : (input.rules ?? {}),
      autoSync: input.type === 'upload' ? false : (input.autoSync ?? false),
      consentConfirmedAt: new Date(),
      consentConfirmedBy: new Types.ObjectId(userId),
    });
    await this.recompute(a);
    return this.view(a);
  }

  async update(workspaceId: Types.ObjectId, id: string, patch: { name?: string; description?: string; rules?: AudienceRules; autoSync?: boolean }) {
    const a = await this.get(workspaceId, id);
    if (patch.name) a.name = patch.name.trim();
    if (patch.description != null) a.description = patch.description;
    if (patch.rules && a.type !== 'upload') a.rules = patch.rules;
    if (patch.autoSync != null && a.type !== 'upload') a.autoSync = patch.autoSync;
    await a.save();
    await this.recompute(a);
    return this.view(a);
  }

  async remove(workspaceId: Types.ObjectId, id: string, removeFromPlatforms: boolean) {
    const a = await this.get(workspaceId, id);
    if (removeFromPlatforms) {
      for (const d of a.destinations) await this.deletePlatformAudience(d.adAccountId, d.externalAudienceId).catch(() => undefined);
    }
    await this.members.deleteMany({ audienceId: a._id });
    await a.deleteOne();
    return { ok: true };
  }

  /** Adds hashed rows to an upload audience. Raw values are never stored. */
  async upload(ws: WorkspaceDoc, id: string, mode: 'append' | 'replace', rows: UploadRow[]) {
    const a = await this.get(ws._id, id);
    if (a.type !== 'upload') throw new BadRequestException('Only "upload" audiences accept a file');
    if (mode === 'replace') await this.members.deleteMany({ audienceId: a._id });
    // `added` counts people new to the list; invalid rows and repeats are reported as skipped.
    let added = 0;
    const ops = [];
    for (const r of rows) {
      const email = normalizeEmail(r.email);
      const phone = normalizePhone(r.phone, ws.phoneCountryCode);
      const m = this.member(null, email, phone);
      if (!m) continue;
      const name = (s?: string) => (s?.trim() ? sha256(s.trim().toLowerCase()) : null);
      ops.push({
        updateOne: {
          filter: { audienceId: a._id, key: m.key },
          update: {
            $set: {
              emailHash: m.emailHash,
              phoneHash: m.metaPhoneHash,
              googlePhoneHash: m.googlePhoneHash,
              firstNameHash: name(r.firstName),
              lastNameHash: name(r.lastName),
              hint: m.hint.email ?? m.hint.phone ?? '',
            },
          },
          upsert: true,
        },
      });
    }
    for (let i = 0; i < ops.length; i += 5000) {
      const res = await this.members.bulkWrite(ops.slice(i, i + 5000), { ordered: false });
      added += res.upsertedCount;
    }
    await this.recompute(a);
    return { added, skipped: rows.length - added, size: a.size };
  }

  // ── Destinations & sync ───────────────────────────────────────────────────

  async addDestinations(workspaceId: Types.ObjectId, id: string, adAccountIds: string[]) {
    const a = await this.get(workspaceId, id);
    const accounts = await this.adAccounts.find({
      _id: { $in: adAccountIds.filter(isValidObjectId) },
      workspaceId,
      status: { $ne: 'disconnected' },
    });
    if (!accounts.length) throw new BadRequestException('No valid ad accounts selected');
    for (const acc of accounts) {
      if (!a.destinations.some((d) => d.adAccountId.equals(acc._id))) {
        a.destinations.push({
          adAccountId: acc._id,
          platform: acc.platform,
          externalAudienceId: null,
          status: 'pending',
          lastSyncedAt: null,
          uploadedCount: 0,
          matchedCount: null,
          error: null,
        });
      }
    }
    await a.save();
    await this.enqueueSync(a);
    return this.view(a);
  }

  async removeDestination(workspaceId: Types.ObjectId, id: string, adAccountId: string) {
    const a = await this.get(workspaceId, id);
    a.destinations = a.destinations.filter((d) => String(d.adAccountId) !== adAccountId);
    await a.save();
    return this.view(a);
  }

  async enqueueSync(a: AudienceDoc) {
    const job: AutomationJob = { name: 'audience-sync', data: { audienceId: a.id } };
    await this.queue.add(job.name, job.data, {
      jobId: `audience-${a.id}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 60_000 },
      removeOnComplete: true,
      removeOnFail: true,
    });
    return { queued: true };
  }

  async syncNow(workspaceId: Types.ObjectId, id: string) {
    const a = await this.get(workspaceId, id);
    if (!a.destinations.length) throw new BadRequestException('Add a Google or Meta ad account to sync to first');
    return this.enqueueSync(a);
  }

  private googleCtx(acc: AdAccountDoc, accessToken: string) {
    return { accessToken, customerId: acc.externalId, loginCustomerId: acc.loginCustomerId };
  }

  /** Worker: recompute members and replace the list on every destination. */
  async sync(audienceId: string) {
    const a = await this.audiences.findById(audienceId);
    if (!a || !a.destinations.length) return { skipped: true };
    const members = await this.recompute(a);
    for (const d of a.destinations) {
      const acc = await this.adAccounts.findById(d.adAccountId);
      if (!acc || acc.status === 'disconnected') {
        Object.assign(d, { status: 'failed', error: 'Ad account is disconnected' });
        continue;
      }
      d.status = 'syncing';
      await a.save();
      try {
        const token = await this.connections.accessToken(acc.connectionId);
        const label = `AdsAssist · ${a.name}`;
        if (acc.platform === 'meta') {
          d.externalAudienceId ??= await this.meta.createCustomAudience(token, acc.externalId, label, a.description || `Synced from AdsAssist (${a.type})`);
          const rows = members.map((m) => [m.emailHash ?? '', m.metaPhoneHash ?? ''] as [string, string]);
          d.uploadedCount = rows.length ? await this.meta.replaceAudienceUsers(token, d.externalAudienceId, rows) : 0;
          d.matchedCount = await this.meta.audienceSize(token, d.externalAudienceId).catch(() => null);
        } else {
          const ctx = this.googleCtx(acc, token);
          d.externalAudienceId ??= await this.google.createCustomerMatchList(ctx, `${label} ${a.id.slice(-6)}`, a.description || 'Synced from AdsAssist');
          d.uploadedCount = await this.google.replaceCustomerMatch(
            ctx,
            d.externalAudienceId,
            members.map((m) => ({ hashedEmail: m.emailHash, hashedPhoneNumber: m.googlePhoneHash })),
          );
          d.matchedCount = await this.google.userListSize(ctx, d.externalAudienceId).catch(() => null);
        }
        Object.assign(d, { status: 'synced', error: null, lastSyncedAt: new Date() });
      } catch (e) {
        const msg = (e as Error).message;
        this.logger.warn(`Audience ${a.id} → ${acc.platform} ${acc.externalId} failed: ${msg}`);
        Object.assign(d, { status: 'failed', error: msg });
        if (e instanceof PlatformError && e.authRevoked) await this.connections.markRevoked(acc.connectionId, msg);
      }
      await a.save();
    }
    return { members: members.length };
  }

  /** Refreshes match counts, and re-syncs auto-sync audiences once a day. */
  async tick() {
    const rows = await this.audiences.find({ 'destinations.0': { $exists: true } });
    let queued = 0;
    for (const a of rows) {
      const stale = a.destinations.some((d) => !d.lastSyncedAt || Date.now() - d.lastSyncedAt.getTime() > 23 * 3_600_000);
      if (a.autoSync && stale) {
        await this.enqueueSync(a);
        queued++;
        continue;
      }
      for (const d of a.destinations.filter((x) => x.status === 'synced' && x.externalAudienceId)) {
        const acc = await this.adAccounts.findById(d.adAccountId);
        if (!acc || acc.status !== 'active') continue;
        try {
          const token = await this.connections.accessToken(acc.connectionId);
          d.matchedCount =
            acc.platform === 'meta'
              ? await this.meta.audienceSize(token, d.externalAudienceId!)
              : await this.google.userListSize(this.googleCtx(acc, token), d.externalAudienceId!);
        } catch {
          // keep the last known count
        }
      }
      await a.save();
    }
    return { audiences: rows.length, queued };
  }

  private async deletePlatformAudience(adAccountId: Types.ObjectId, externalId: string | null) {
    if (!externalId) return;
    const acc = await this.adAccounts.findById(adAccountId);
    if (!acc) return;
    const token = await this.connections.accessToken(acc.connectionId);
    if (acc.platform === 'meta') await this.meta.deleteAudience(token, externalId);
    else await this.google.removeUserList(this.googleCtx(acc, token), externalId);
  }

  async lookalike(workspaceId: Types.ObjectId, id: string, adAccountId: string, country: string, ratio: number) {
    const a = await this.get(workspaceId, id);
    const dest = a.destinations.find((d) => String(d.adAccountId) === adAccountId);
    if (!dest || dest.platform !== 'meta') throw new BadRequestException('Lookalikes need a Meta destination on this audience');
    if (!dest.externalAudienceId || dest.status !== 'synced') throw new BadRequestException('Sync the audience to this Meta account first');
    const acc = await this.adAccounts.findById(dest.adAccountId);
    if (!acc) throw new NotFoundException('Ad account not found');
    const token = await this.connections.accessToken(acc.connectionId);
    const name = `AdsAssist · ${a.name} · LAL ${Math.round(ratio * 100)}% ${country}`;
    const externalAudienceId = await this.meta.createLookalike(token, acc.externalId, dest.externalAudienceId, country.toUpperCase(), ratio, name);
    return { externalAudienceId, name };
  }
}
