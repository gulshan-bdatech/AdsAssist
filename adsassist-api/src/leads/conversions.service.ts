import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Queue } from 'bullmq';
import { Model, Types } from 'mongoose';
import type { Paged } from '../common/dto.js';
import { DayRange, rangeToInstants } from '../common/utils/dates.js';
import { googlePhoneHash, metaPhoneHash, sha256 } from '../common/utils/identity.js';
import { AdAccount, AdAccountDoc, Platform } from '../database/schemas/integration.schema.js';
import { ConversionPush, ConversionPushDoc, Lead, LeadDoc, PushStatus } from '../database/schemas/leads.schema.js';
import { PipelineStage, Workspace, WorkspaceDoc } from '../database/schemas/workspace.schema.js';
import { ConnectionsService } from '../integrations/connections.service.js';
import { GoogleAdsClient } from '../integrations/platforms/google-ads.client.js';
import { PlatformError } from '../integrations/platforms/http.js';
import { MetaClient } from '../integrations/platforms/meta.client.js';
import { ConversionJob, defaultJobOptions, QUEUES } from '../queues.js';
import { EventsBus } from '../common/events/events.module.js';
import { formatFbc } from './attribution.js';

/**
 * Sends lead stage changes back to Google Ads (offline click conversions with
 * enhanced identifiers) and Meta (Conversions API), so the platforms optimise
 * for leads that actually progress, not just form fills.
 *
 * Every attempt is recorded in conversion_pushes. `eventId` is
 * `<leadId>-<stage>` and is unique per platform, so a stage can't be
 * reported twice and both platforms can de-duplicate against browser pixels.
 */
@Injectable()
export class ConversionsService {
  private readonly logger = new Logger(ConversionsService.name);

  constructor(
    @InjectModel(ConversionPush.name) private readonly pushes: Model<ConversionPush>,
    @InjectModel(Lead.name) private readonly leads: Model<Lead>,
    @InjectModel(AdAccount.name) private readonly adAccounts: Model<AdAccount>,
    @InjectModel(Workspace.name) private readonly workspaces: Model<Workspace>,
    @InjectQueue(QUEUES.conversions) private readonly queue: Queue<ConversionJob>,
    private readonly connections: ConnectionsService,
    private readonly google: GoogleAdsClient,
    private readonly meta: MetaClient,
    private readonly bus: EventsBus,
  ) {}

  /** Creates push rows for each platform a stage should be reported to, then queues them. */
  async queueForStage(ws: WorkspaceDoc, lead: LeadDoc, stage: PipelineStage) {
    // Opted-out people are never reported to ad platforms.
    if (!stage.pushToPlatforms || lead.consent === false) return;
    const accounts = await this.adAccounts.find({ workspaceId: ws._id, status: 'active', conversionsEnabled: true });
    for (const platform of ['google', 'meta'] as Platform[]) {
      const candidates = accounts.filter((a) => a.platform === platform);
      if (!candidates.length) continue;
      // Prefer the account whose campaign produced the lead.
      const account = candidates.find((a) => lead.adAccountId?.equals(a._id)) ?? candidates[0];
      const skip = this.skipReason(platform, lead, account, stage);
      const eventName = platform === 'meta' ? (stage.metaEventName || 'Lead') : stage.label;
      try {
        const push = await this.pushes.create({
          workspaceId: ws._id,
          leadId: lead._id,
          adAccountId: account._id,
          platform,
          stage: stage.key,
          eventName,
          eventId: `${lead.id}-${stage.key}`,
          status: skip ? 'skipped' : 'pending',
          lastError: skip,
        });
        if (!skip) await this.enqueue(push);
      } catch (e: any) {
        if (e?.code !== 11000) throw e; // already reported this stage
      }
    }
  }

  private skipReason(platform: Platform, lead: LeadDoc, account: AdAccountDoc, stage: PipelineStage): string | null {
    if (platform === 'google') {
      if (!(stage.googleConversionActionId || account.googleConversionActionId)) {
        return 'No Google conversion action selected for this ad account or stage';
      }
      if (!lead.gclid && lead.channel !== 'google') return 'Lead did not come from Google Ads';
      if (!lead.gclid && !lead.emailHash && !lead.phoneHash) return 'Lead has no gclid, email or phone to match on';
      return null;
    }
    if (!account.metaPixelId) return 'No Meta pixel/dataset selected for this ad account';
    // Meta already counts the form submit itself; later stages are still reported (CRM conversion leads).
    if (lead.source === 'meta_form' && lead.history[0]?.stage === stage.key) return 'Meta already counts lead form submissions';
    if (lead.metaLeadId) return null;
    if (!lead.emailHash && !lead.phoneHash && !lead.fbclid && !lead.fbp) return 'Lead has no email, phone or Meta click id to match on';
    return null;
  }

  private enqueue(push: ConversionPushDoc) {
    return this.queue.add('push', { pushId: push.id }, { ...defaultJobOptions, jobId: `push-${push.id}-${push.attempts}` });
  }

  /** Worker entry point. Throws on transient errors so BullMQ retries with back-off. */
  async send(pushId: string) {
    const push = await this.pushes.findById(pushId);
    if (!push || push.status === 'sent' || push.status === 'skipped') return { skipped: true };
    const [lead, account] = await Promise.all([this.leads.findById(push.leadId), this.adAccounts.findById(push.adAccountId)]);
    if (!lead || !account) {
      await push.updateOne({ status: 'skipped', lastError: 'Lead or ad account no longer exists' });
      return { skipped: true };
    }
    push.attempts += 1;
    try {
      const token = await this.connections.accessToken(account.connectionId);
      const response = push.platform === 'google' ? await this.sendGoogle(push, lead, account, token) : await this.sendMeta(push, lead, account, token);
      push.status = 'sent';
      push.sentAt = new Date();
      push.lastError = null;
      push.response = response;
      await push.save();
      this.bus.emit('conversion.sent', push.workspaceId, { conversion: this.view(push, lead.name), leadId: lead.id });
      return { sent: true };
    } catch (e) {
      const err = e as Error;
      push.status = 'failed';
      push.lastError = err.message;
      push.response = e instanceof PlatformError ? ((e.body as Record<string, unknown>) ?? null) : null;
      await push.save();
      this.bus.emit('conversion.failed', push.workspaceId, { conversion: this.view(push, lead.name), leadId: lead.id, error: err.message });
      const permanent = e instanceof PlatformError && (e.authRevoked || (e.status >= 400 && e.status < 500 && e.status !== 429));
      if (permanent) return { failed: err.message };
      throw err;
    }
  }

  private async sendGoogle(push: ConversionPushDoc, lead: LeadDoc, account: AdAccountDoc, accessToken: string) {
    const ws = await this.workspaces.findById(lead.workspaceId, { pipeline: 1 });
    const stage = ws?.pipeline.find((s) => s.key === push.stage);
    const changedAt = [...lead.history].reverse().find((h) => h.stage === push.stage)?.at ?? new Date();
    return this.google.uploadClickConversion(
      { accessToken, customerId: account.externalId, loginCustomerId: account.loginCustomerId },
      {
        conversionAction: stage?.googleConversionActionId || account.googleConversionActionId,
        conversionDateTime: changedAt,
        orderId: push.eventId,
        gclid: lead.gclid,
        hashedEmail: lead.emailHash,
        hashedPhone: lead.phone ? googlePhoneHash(lead.phone) : null,
        value: lead.value ?? stage?.value ?? null,
        currency: lead.currency,
      },
    );
  }

  private async sendMeta(push: ConversionPushDoc, lead: LeadDoc, account: AdAccountDoc, accessToken: string) {
    const changedAt = [...lead.history].reverse().find((h) => h.stage === push.stage)?.at ?? new Date();
    const fromBrowser = lead.source === 'pixel' && lead.history[0]?.stage === push.stage;
    const userData: Record<string, unknown> = { external_id: [sha256(lead.id)] };
    if (lead.metaLeadId) userData.lead_id = lead.metaLeadId;
    if (lead.emailHash) userData.em = [lead.emailHash];
    if (lead.phone) userData.ph = [metaPhoneHash(lead.phone)];
    if (lead.fbclid) userData.fbc = formatFbc(lead.fbclid, lead.createdAt);
    if (lead.fbp) userData.fbp = lead.fbp;
    if (lead.ip) userData.client_ip_address = lead.ip;
    if (lead.userAgent) userData.client_user_agent = lead.userAgent;
    const custom: Record<string, unknown> = { lead_stage: push.stage };
    if (lead.value != null) {
      custom.value = lead.value;
      custom.currency = lead.currency;
    }
    if (lead.utm?.campaign) custom.campaign = lead.utm.campaign;
    return this.meta.sendCapiEvent(accessToken, account.metaPixelId, {
      event_name: push.eventName || 'Lead',
      // Meta rejects events older than 7 days
      event_time: Math.floor(Math.max(changedAt.getTime(), Date.now() - 6.9 * 86_400_000) / 1000),
      event_id: push.eventId,
      action_source: fromBrowser && lead.userAgent ? 'website' : 'system_generated',
      ...(fromBrowser && lead.landingPage ? { event_source_url: lead.landingPage } : {}),
      user_data: userData,
      custom_data: custom,
    });
  }

  async retry(workspaceId: Types.ObjectId, id: string) {
    const push = await this.pushes.findOne({ _id: id, workspaceId });
    if (!push) throw new NotFoundException('Conversion push not found');
    if (push.status !== 'sent') {
      push.status = 'pending';
      await push.save();
      await this.enqueue(push);
    }
    return this.view(push, null);
  }

  private view(p: ConversionPushDoc, leadName: string | null) {
    return {
      id: p.id as string,
      leadId: String(p.leadId),
      leadName,
      platform: p.platform,
      adAccountId: p.adAccountId ? String(p.adAccountId) : null,
      stage: p.stage,
      eventName: p.eventName,
      eventId: p.eventId,
      status: p.status,
      attempts: p.attempts,
      lastError: p.lastError,
      sentAt: p.sentAt,
      createdAt: p.createdAt,
    };
  }

  async list(workspaceId: Types.ObjectId, q: { status?: PushStatus; platform?: Platform; page: number; pageSize: number; leadId?: Types.ObjectId }): Promise<Paged<ReturnType<ConversionsService['view']>>> {
    const filter: Record<string, unknown> = { workspaceId };
    if (q.status) filter.status = q.status;
    if (q.platform) filter.platform = q.platform;
    if (q.leadId) filter.leadId = q.leadId;
    const [rows, total] = await Promise.all([
      this.pushes.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize),
      this.pushes.countDocuments(filter),
    ]);
    const names = new Map(
      (await this.leads.find({ _id: { $in: rows.map((r) => r.leadId) } }, { name: 1, email: 1, phone: 1 })).map((l) => [
        l.id as string,
        l.name || l.email || l.phone || 'Lead',
      ]),
    );
    return { items: rows.map((r) => this.view(r, names.get(String(r.leadId)) ?? null)), total, page: q.page, pageSize: q.pageSize };
  }

  async stats(ws: WorkspaceDoc, range: DayRange) {
    const { start, end } = rangeToInstants(range, ws.timezone);
    const rows = await this.pushes.aggregate<{ _id: { platform: Platform; status: PushStatus }; n: number }>([
      { $match: { workspaceId: ws._id, createdAt: { $gte: start, $lt: end } } },
      { $group: { _id: { platform: '$platform', status: '$status' }, n: { $sum: 1 } } },
    ]);
    const count = (status?: PushStatus, platform?: Platform) =>
      rows.filter((r) => (!status || r._id.status === status) && (!platform || r._id.platform === platform)).reduce((s, r) => s + r.n, 0);
    return {
      total: count(),
      sent: count('sent'),
      failed: count('failed'),
      pending: count('pending'),
      skipped: count('skipped'),
      byPlatform: (['google', 'meta'] as Platform[]).map((p) => ({ platform: p, sent: count('sent', p), failed: count('failed', p) })),
    };
  }
}
