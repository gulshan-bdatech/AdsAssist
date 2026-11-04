import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomBytes } from 'node:crypto';
import { isValidObjectId, Model, Types } from 'mongoose';
import { escapeRegex, Paged } from '../common/dto.js';
import { DayRange, rangeToInstants } from '../common/utils/dates.js';
import { emailHash, normalizeEmail, normalizePhone, phoneHash } from '../common/utils/identity.js';
import { Campaign, CampaignDoc } from '../database/schemas/ads.schema.js';
import { Lead, LeadDoc, StageChange } from '../database/schemas/leads.schema.js';
import { Channel, TrackingEvent } from '../database/schemas/tracking.schema.js';
import { PipelineStage, User, WorkspaceDoc } from '../database/schemas/workspace.schema.js';
import { channelOf, TouchSignals } from './attribution.js';
import { EventsBus } from '../common/events/events.module.js';
import { ConversionsService } from './conversions.service.js';

export interface LeadInput {
  externalId?: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  stage?: string;
  value?: number | null;
  currency?: string;
  channel?: Channel;
  campaignId?: string;
  notes?: string;
  fields?: Record<string, string>;
  touch?: TouchSignals;
  ip?: string;
  userAgent?: string;
  contactId?: Types.ObjectId | null;
  deviceKey?: string | null;
  /** false = opted out: never pushed to ad platforms or audiences. */
  consent?: boolean | null;
  country?: string;
  metaLeadId?: string | null;
}

export interface LeadListQuery {
  stage?: string;
  channel?: Channel;
  campaignId?: string;
  search?: string;
  page: number;
  pageSize: number;
}

/** Same person submitting again within this window updates the existing lead instead of creating a new one. */
const DEDUP_WINDOW_MS = 30 * 86_400_000;

@Injectable()
export class LeadsService {
  constructor(
    @InjectModel(Lead.name) private readonly leads: Model<Lead>,
    @InjectModel(Campaign.name) private readonly campaigns: Model<Campaign>,
    @InjectModel(TrackingEvent.name) private readonly events: Model<TrackingEvent>,
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly conversions: ConversionsService,
    private readonly bus: EventsBus,
  ) {}

  /** Emits lead.* events with the same shape the API returns. */
  private async announce(ws: WorkspaceDoc, lead: LeadDoc, type: 'lead.created' | 'lead.stage_changed', previousStage?: string) {
    const [view] = await this.view(ws, [lead]);
    this.bus.emit(type, ws._id, type === 'lead.created' ? { lead: view } : { lead: view, previousStage });
    const kind = ws.pipeline.find((s) => s.key === lead.stage)?.kind;
    if (kind === 'won' && previousStage !== lead.stage) this.bus.emit('lead.won', ws._id, { lead: view });
  }

  private stageOf(ws: WorkspaceDoc, key: string): PipelineStage {
    const stage = ws.pipeline.find((s) => s.key === key);
    if (!stage) throw new BadRequestException(`Unknown stage "${key}". Valid: ${ws.pipeline.map((s) => s.key).join(', ')}`);
    return stage;
  }

  private firstStage(ws: WorkspaceDoc): PipelineStage {
    return [...ws.pipeline].sort((a, b) => a.order - b.order).find((s) => s.kind === 'open') ?? ws.pipeline[0];
  }

  /**
   * Links a lead to a synced campaign. `utm_id` (campaign id) is exact; the
   * campaign name in `utm_campaign` is the fallback. Platform is narrowed by
   * the click id when present so same-named campaigns don't cross platforms.
   */
  private async matchCampaign(workspaceId: Types.ObjectId, touch: TouchSignals | undefined): Promise<CampaignDoc | null> {
    if (!touch) return null;
    const ch = channelOf(touch);
    const platformFilter = ch === 'google' || ch === 'meta' ? { platform: ch } : {};
    const id = touch.utm?.id?.trim();
    if (id) {
      const byId = await this.campaigns.findOne({ workspaceId, externalId: id, ...platformFilter });
      if (byId) return byId;
    }
    const name = touch.utm?.campaign?.trim();
    if (name) {
      if (/^\d{6,}$/.test(name)) {
        const byNumericName = await this.campaigns.findOne({ workspaceId, externalId: name, ...platformFilter });
        if (byNumericName) return byNumericName;
      }
      return this.campaigns.findOne({ workspaceId, name: new RegExp(`^${escapeRegex(name)}$`, 'i'), ...platformFilter });
    }
    return null;
  }

  private async applyAttribution(ws: WorkspaceDoc, lead: LeadDoc, input: LeadInput) {
    const touch = input.touch;
    if (touch) {
      lead.utm = touch.utm ?? lead.utm;
      lead.gclid = touch.gclid ?? lead.gclid;
      lead.fbclid = touch.fbclid ?? lead.fbclid;
      lead.fbp = touch.fbp ?? lead.fbp;
      lead.landingPage = touch.landingPage ?? lead.landingPage;
    }
    let campaign: CampaignDoc | null = null;
    if (input.campaignId && isValidObjectId(input.campaignId)) {
      campaign = await this.campaigns.findOne({ _id: input.campaignId, workspaceId: ws._id });
    }
    campaign ??= await this.matchCampaign(ws._id, touch);
    if (campaign) {
      lead.campaignId = campaign._id;
      lead.adAccountId = campaign.adAccountId;
      lead.campaignExternalId = campaign.externalId;
      lead.channel = campaign.platform;
    } else {
      lead.channel = input.channel ?? (touch ? channelOf(touch) : lead.channel);
    }
  }

  private setIdentity(ws: WorkspaceDoc, lead: LeadDoc, input: LeadInput) {
    const email = normalizeEmail(input.email);
    const phone = normalizePhone(input.phone, ws.phoneCountryCode);
    if (input.name) lead.name = input.name.trim().slice(0, 200);
    if (email) {
      lead.email = email;
      lead.emailHash = emailHash(email);
    }
    if (phone) {
      lead.phone = phone;
      lead.phoneHash = phoneHash(phone);
    }
    if (input.fields) {
      for (const [k, v] of Object.entries(input.fields).slice(0, 50)) lead.fields.set(k.slice(0, 60).replace(/[.$]/g, '_'), String(v).slice(0, 500));
    }
  }

  private pushHistory(lead: LeadDoc, stage: string, by: StageChange['by'], userId?: string) {
    lead.history.push({ stage, at: new Date(), by, userId: userId ? new Types.ObjectId(userId) : null });
  }

  async create(ws: WorkspaceDoc, input: LeadInput, source: Lead['source'], by: StageChange['by'], userId?: string) {
    const stage = input.stage ? this.stageOf(ws, input.stage) : this.firstStage(ws);
    const lead = new this.leads({
      workspaceId: ws._id,
      externalId: input.externalId?.trim() || `${source === 'pixel' ? 'px' : 'ld'}_${randomBytes(9).toString('base64url')}`,
      source,
      stage: stage.key,
      value: input.value ?? stage.value ?? null,
      currency: input.currency?.toUpperCase() ?? ws.currency,
      notes: input.notes ?? '',
      ip: input.ip ?? '',
      userAgent: input.userAgent?.slice(0, 500) ?? '',
      contactId: input.contactId ?? null,
      deviceKey: input.deviceKey ?? null,
      consent: input.consent ?? null,
      country: input.country ?? '',
      metaLeadId: input.metaLeadId ?? null,
    });
    if (!input.email && !input.phone && !input.name && source !== 'pixel') {
      throw new BadRequestException('A lead needs at least a name, email or phone');
    }
    this.setIdentity(ws, lead, input);
    await this.applyAttribution(ws, lead, input);
    this.pushHistory(lead, stage.key, by, userId);
    if (stage.kind === 'won') lead.wonAt = new Date();
    try {
      await lead.save();
    } catch (e: any) {
      if (e?.code === 11000) throw new BadRequestException(`A lead with externalId "${lead.externalId}" already exists`);
      throw e;
    }
    await this.conversions.queueForStage(ws, lead, stage);
    await this.announce(ws, lead, 'lead.created');
    return lead;
  }

  /** Form submit from the pixel: create, or merge into a recent lead from the same person. */
  async captureFromPixel(ws: WorkspaceDoc, input: LeadInput) {
    const email = normalizeEmail(input.email);
    const phone = normalizePhone(input.phone, ws.phoneCountryCode);
    const or: Record<string, unknown>[] = [];
    if (email) or.push({ emailHash: emailHash(email) });
    if (phone) or.push({ phoneHash: phoneHash(phone) });
    if (input.contactId) or.push({ contactId: input.contactId });
    if (!or.length) return null;
    const existing = await this.leads.findOne({ workspaceId: ws._id, $or: or, createdAt: { $gte: new Date(Date.now() - DEDUP_WINDOW_MS) } }).sort({ createdAt: -1 });
    if (!existing) return this.create(ws, input, 'pixel', 'pixel');
    this.setIdentity(ws, existing, input);
    existing.contactId ??= input.contactId ?? null;
    existing.deviceKey ??= input.deviceKey ?? null;
    if (input.consent != null) existing.consent = input.consent;
    if (input.country && !existing.country) existing.country = input.country;
    // Keep the original attribution unless the lead had none.
    if (!existing.campaignId && input.touch && (input.touch.gclid || input.touch.fbclid || input.touch.utm?.campaign)) {
      await this.applyAttribution(ws, existing, input);
    }
    await existing.save();
    return existing;
  }

  /** CRM/LMS upsert by externalId. */
  async upsertFromApi(ws: WorkspaceDoc, input: LeadInput & { externalId: string }) {
    const existing = await this.leads.findOne({ workspaceId: ws._id, externalId: input.externalId });
    if (!existing) return this.create(ws, input, 'api', 'api');
    this.setIdentity(ws, existing, input);
    if (input.notes != null) existing.notes = input.notes;
    if (input.value != null) existing.value = input.value;
    if (input.touch || input.campaignId) await this.applyAttribution(ws, existing, input);
    await existing.save();
    if (input.stage && input.stage !== existing.stage) return this.changeStage(ws, existing, input.stage, input.value ?? undefined, 'api');
    return existing;
  }

  async changeStage(ws: WorkspaceDoc, lead: LeadDoc, stageKey: string, value: number | undefined, by: StageChange['by'], userId?: string) {
    const stage = this.stageOf(ws, stageKey);
    const previousStage = lead.stage;
    if (value != null) lead.value = value;
    else if (lead.value == null && stage.value != null) lead.value = stage.value;
    if (lead.stage !== stage.key) {
      lead.stage = stage.key;
      this.pushHistory(lead, stage.key, by, userId);
      lead.wonAt = stage.kind === 'won' ? new Date() : stage.kind === 'lost' ? null : lead.wonAt;
    }
    await lead.save();
    await this.conversions.queueForStage(ws, lead, stage);
    if (previousStage !== lead.stage) await this.announce(ws, lead, 'lead.stage_changed', previousStage);
    return lead;
  }

  /** `conversion` event from the pixel: the latest lead on this device/contact moves to the first won stage. */
  async markWonFromPixel(ws: WorkspaceDoc, deviceKey: string, contactId: Types.ObjectId | null, value: number | null) {
    const or: Record<string, unknown>[] = [{ deviceKey }];
    if (contactId) or.push({ contactId });
    const lead = await this.leads.findOne({ workspaceId: ws._id, $or: or }).sort({ createdAt: -1 });
    const won = [...ws.pipeline].sort((a, b) => a.order - b.order).find((s) => s.kind === 'won');
    if (!lead || !won) return null;
    return this.changeStage(ws, lead, won.key, value ?? undefined, 'pixel');
  }

  async get(workspaceId: Types.ObjectId, id: string) {
    const lead = isValidObjectId(id) ? await this.leads.findOne({ _id: id, workspaceId }) : null;
    if (!lead) throw new NotFoundException('Lead not found');
    return lead;
  }

  async getByExternalId(workspaceId: Types.ObjectId, externalId: string) {
    const lead = await this.leads.findOne({ workspaceId, externalId });
    if (!lead) throw new NotFoundException(`Lead "${externalId}" not found`);
    return lead;
  }

  async update(ws: WorkspaceDoc, lead: LeadDoc, patch: Pick<LeadInput, 'name' | 'email' | 'phone' | 'notes' | 'value'>) {
    this.setIdentity(ws, lead, patch);
    if (patch.notes != null) lead.notes = patch.notes;
    if (patch.value != null) lead.value = patch.value;
    await lead.save();
    return lead;
  }

  async view(ws: WorkspaceDoc, leads: LeadDoc[]) {
    const campaignIds = [...new Set(leads.map((l) => l.campaignId).filter(Boolean).map(String))];
    const names = new Map(
      (await this.campaigns.find({ _id: { $in: campaignIds } }, { name: 1 })).map((c) => [c.id as string, c.name]),
    );
    const labels = new Map(ws.pipeline.map((s) => [s.key, s.label]));
    return leads.map((l) => ({
      id: l.id as string,
      externalId: l.externalId,
      source: l.source,
      name: l.name,
      email: l.email,
      phone: l.phone ? `+${l.phone}` : null,
      stage: l.stage,
      stageLabel: labels.get(l.stage) ?? l.stage,
      value: l.value,
      currency: l.currency,
      channel: l.channel,
      campaignId: l.campaignId ? String(l.campaignId) : null,
      campaignName: l.campaignId ? (names.get(String(l.campaignId)) ?? null) : (l.utm?.campaign ?? null),
      adAccountId: l.adAccountId ? String(l.adAccountId) : null,
      utm: l.utm ?? {},
      gclid: l.gclid,
      fbclid: l.fbclid,
      contactId: l.contactId ? String(l.contactId) : null,
      notes: l.notes,
      consent: l.consent,
      country: l.country,
      fields: Object.fromEntries(l.fields ?? []),
      createdAt: l.createdAt,
      updatedAt: l.updatedAt,
    }));
  }

  async list(ws: WorkspaceDoc, range: DayRange, q: LeadListQuery): Promise<Paged<unknown>> {
    const { start, end } = rangeToInstants(range, ws.timezone);
    const filter: Record<string, unknown> = { workspaceId: ws._id, createdAt: { $gte: start, $lt: end } };
    if (q.stage) filter.stage = q.stage;
    if (q.channel) filter.channel = q.channel;
    if (q.campaignId && isValidObjectId(q.campaignId)) filter.campaignId = new Types.ObjectId(q.campaignId);
    if (q.search?.trim()) {
      const rx = new RegExp(escapeRegex(q.search.trim()), 'i');
      const digits = q.search.replace(/\D/g, '');
      filter.$or = [{ name: rx }, { email: rx }, { externalId: rx }, ...(digits.length >= 4 ? [{ phone: new RegExp(digits) }] : [])];
    }
    const [rows, total] = await Promise.all([
      this.leads.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize),
      this.leads.countDocuments(filter),
    ]);
    return { items: await this.view(ws, rows), total, page: q.page, pageSize: q.pageSize };
  }

  async detail(ws: WorkspaceDoc, id: string) {
    const lead = await this.get(ws._id, id);
    const [[view], conversions, userNames] = await Promise.all([
      this.view(ws, [lead]),
      this.conversions.list(ws._id, { leadId: lead._id, page: 1, pageSize: 50 }),
      this.users.find({ _id: { $in: lead.history.map((h) => h.userId).filter(Boolean) } }, { name: 1 }),
    ]);
    const nameById = new Map(userNames.map((u) => [u.id as string, u.name]));
    const labels = new Map(ws.pipeline.map((s) => [s.key, s.label]));
    const eventFilter = lead.contactId ? { contactId: lead.contactId } : lead.deviceKey ? { deviceKey: lead.deviceKey } : null;
    const events = eventFilter ? await this.events.find({ workspaceId: ws._id, ...eventFilter }).sort({ createdAt: -1 }).limit(200) : [];
    return {
      lead: view,
      history: lead.history.map((h) => ({
        stage: h.stage,
        label: labels.get(h.stage) ?? h.stage,
        at: h.at,
        by: h.by,
        userName: h.userId ? (nameById.get(String(h.userId)) ?? null) : null,
      })),
      conversions: conversions.items,
      events,
    };
  }
}
