import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Queue } from 'bullmq';
import { isValidObjectId, Model, Types } from 'mongoose';
import { escapeRegex, Paged } from '../common/dto.js';
import { EventsBus } from '../common/events/events.module.js';
import { RedisService } from '../common/redis/redis.module.js';
import { generateKey } from '../common/utils/identity.js';
import { Lead } from '../database/schemas/leads.schema.js';
import {
  ApiKey,
  Contact,
  ContactDoc,
  Device,
  EVENT_TYPES,
  EventType,
  SiteKey,
  SiteKeyDoc,
  TrackingEvent,
  TrackingEventDoc,
  Utm,
} from '../database/schemas/tracking.schema.js';
import { Workspace, WorkspaceDoc } from '../database/schemas/workspace.schema.js';
import { hasAdSignal, toTouch, TouchSignals } from '../leads/attribution.js';
import { defaultJobOptions, IdentifyJob, PixelConversionJob, QUEUES } from '../queues.js';

const str = (v: unknown, max = 500): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};

export const eventsChannel = (workspaceId: string) => `events:${workspaceId}`;

export interface IngestMeta {
  ip: string;
  userAgent: string;
  origin: string | null;
  /** ISO-2 country from the CDN/proxy header, '' when unknown. */
  country: string;
}

const PIXEL_EVENT_TYPES = EVENT_TYPES.filter((t) => !t.startsWith('email_'));

function parseUserAgent(ua: string): { platform: string; os: string } {
  const os = /android/i.test(ua)
    ? 'android'
    : /iphone|ipad|ipod/i.test(ua)
      ? 'ios'
      : /windows/i.test(ua)
        ? 'windows'
        : /mac os x|macintosh/i.test(ua)
          ? 'macos'
          : /linux/i.test(ua)
            ? 'linux'
            : '';
  const platform = /ipad|tablet/i.test(ua) ? 'tablet' : /mobi|iphone|android/i.test(ua) ? 'mobile' : ua ? 'desktop' : '';
  return { platform, os };
}

@Injectable()
export class TrackingService {
  private readonly keyCache = new Map<string, { at: number; doc: SiteKeyDoc | null; ws: WorkspaceDoc | null }>();

  constructor(
    @InjectModel(SiteKey.name) private readonly siteKeys: Model<SiteKey>,
    @InjectModel(ApiKey.name) private readonly apiKeys: Model<ApiKey>,
    @InjectModel(TrackingEvent.name) private readonly events: Model<TrackingEvent>,
    @InjectModel(Device.name) private readonly devices: Model<Device>,
    @InjectModel(Contact.name) private readonly contacts: Model<Contact>,
    @InjectModel(Lead.name) private readonly leads: Model<Lead>,
    @InjectModel(Workspace.name) private readonly workspaces: Model<Workspace>,
    @InjectQueue(QUEUES.tracking) private readonly queue: Queue,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly bus: EventsBus,
  ) {}

  // ── Pixel ingest ──────────────────────────────────────────────────────────

  /** Site key lookup with a 60 s in-process cache; the pixel hits this on every event. */
  async siteKey(key: string): Promise<{ doc: SiteKeyDoc; ws: WorkspaceDoc } | null> {
    const hit = this.keyCache.get(key);
    if (hit && Date.now() - hit.at < 60_000) return hit.doc && hit.ws ? { doc: hit.doc, ws: hit.ws } : null;
    const doc = key.startsWith('aa_') ? await this.siteKeys.findOne({ key, active: true }) : null;
    const ws = doc ? await this.workspaces.findById(doc.workspaceId) : null;
    if (this.keyCache.size > 5000) this.keyCache.clear();
    this.keyCache.set(key, { at: Date.now(), doc, ws });
    return doc && ws ? { doc, ws } : null;
  }

  private originAllowed(site: SiteKeyDoc, origin: string | null): boolean {
    if (!site.allowedDomains.length) return true;
    if (!origin) return false;
    let host: string;
    try {
      host = new URL(origin).hostname.toLowerCase();
    } catch {
      return false;
    }
    return site.allowedDomains.some((d) => {
      const dom = d.toLowerCase().replace(/^\*?\./, '');
      return host === dom || host.endsWith(`.${dom}`);
    });
  }

  async ingest(key: string | undefined, body: unknown, meta: IngestMeta) {
    const site = key ? await this.siteKey(key) : null;
    if (!site) throw new ForbiddenException('Unknown or inactive site key');
    if (!this.originAllowed(site.doc, meta.origin)) throw new ForbiddenException('Origin not allowed for this site key');
    const limit = this.config.get<number>('RATE_LIMIT_PER_MIN') ?? 120;
    if (!(await this.redis.allow(`ev:${site.doc.id}:${meta.ip}`, limit))) {
      throw new HttpException('Too many events', HttpStatus.TOO_MANY_REQUESTS);
    }

    const p = (typeof body === 'string' ? safeJson(body) : body) as Record<string, any> | null;
    if (!p || typeof p !== 'object') throw new BadRequestException('Body must be a JSON object');
    const type = str(p.event_type, 40) as EventType | null;
    if (!type || !EVENT_TYPES.includes(type) || type.startsWith('email_')) {
      throw new BadRequestException(`event_type must be one of ${PIXEL_EVENT_TYPES.join(', ')}`);
    }
    // Consent mode: without an explicit opt-in the event is kept anonymous (no PII, no form values).
    const consent: boolean | null = p.consent === true ? true : p.consent === false ? false : null;
    if (site.doc.requireConsent && consent !== true) {
      for (const k of ['email', 'phone', 'name', 'field_value', 'fields']) delete p[k];
    }
    const deviceKey = str(p.device_key, 80);
    if (!deviceKey || !/^[\w-]{6,80}$/.test(deviceKey)) throw new BadRequestException('device_key is required');

    const ws = site.ws;
    const utm: Utm = {
      source: str(p.utm_source, 300) ?? undefined,
      medium: str(p.utm_medium, 300) ?? undefined,
      campaign: str(p.utm_campaign, 300) ?? undefined,
      content: str(p.utm_content, 300) ?? undefined,
      term: str(p.utm_term, 300) ?? undefined,
      id: str(p.utm_id, 100) ?? undefined,
    };
    const signals: TouchSignals = {
      gclid: str(p.gclid, 300),
      fbclid: str(p.fbclid, 300),
      fbp: str(p.fbp, 200),
      utm,
      landingPage: str(p.landing_page, 1000) ?? str(p.page_url, 1000),
      referrer: str(p.referrer, 1000),
    };
    const pageUrl = str(p.page_url, 1000) ?? '';
    let pagePath = '';
    try {
      pagePath = pageUrl ? new URL(pageUrl).pathname : '';
    } catch {
      // ignore malformed URLs
    }
    const { platform, os } = parseUserAgent(meta.userAgent);
    const now = new Date();

    const device = await this.devices.findOneAndUpdate(
      { workspaceId: ws._id, deviceKey },
      {
        $set: { lastSeenAt: now, userAgent: meta.userAgent.slice(0, 500), ip: meta.ip, platform, os, ...(p.screen_res ? { screenRes: str(p.screen_res, 20) } : {}) },
        $setOnInsert: { firstSeenAt: now },
      },
      { upsert: true, returnDocument: 'after' },
    );
    if (hasAdSignal(signals)) {
      const touch = toTouch(signals, now);
      if (!device.firstTouch) await device.updateOne({ firstTouch: touch, lastTouch: touch });
      else if (device.lastTouch?.gclid !== touch.gclid || device.lastTouch?.fbclid !== touch.fbclid || device.lastTouch?.campaign !== touch.campaign) {
        await device.updateOne({ lastTouch: touch });
      }
    }

    const fieldName = str(p.field_name, 60);
    // Email/phone live on the contact (hashed for matching); don't keep raw copies in the event log.
    const keepValue = fieldName !== 'email' && fieldName !== 'phone';
    const value = p.value == null || Number.isNaN(Number(p.value)) ? null : Number(p.value);
    const event = await this.events.create({
      workspaceId: ws._id,
      siteKeyId: site.doc._id,
      contactId: device.contactId,
      deviceKey,
      type,
      name: str(p.name, 120) ?? '',
      pageUrl,
      pagePath,
      referrer: signals.referrer ?? '',
      utm,
      gclid: signals.gclid,
      fbclid: signals.fbclid,
      fbp: signals.fbp,
      fieldName,
      fieldValue: keepValue ? str(p.field_value, 500) : null,
      value,
      ip: meta.ip,
      userAgent: meta.userAgent.slice(0, 500),
      country: meta.country,
      createdAt: now,
    });

    const email = str(p.email, 200);
    const phone = str(p.phone, 40);
    const name = type === 'form_submit' || type === 'identify' ? str(p.name, 200) : null;
    const wantsLead = type === 'form_submit' && site.doc.createLeadOnSubmit && (email || phone);
    if (email || phone) {
      const job: IdentifyJob = { workspaceId: ws.id, deviceKey, email, phone, name, consent, country: meta.country };
      if (wantsLead) {
        const fields: Record<string, string> = {};
        if (p.fields && typeof p.fields === 'object') {
          for (const [k, v] of Object.entries(p.fields).slice(0, 30)) {
            const s = str(v, 500);
            if (s) fields[k.slice(0, 60)] = s;
          }
        }
        if (p.form_id) fields.form_id = str(p.form_id, 80)!;
        job.lead = {
          fields,
          touch: {
            gclid: signals.gclid ?? device.lastTouch?.gclid ?? null,
            fbclid: signals.fbclid ?? device.lastTouch?.fbclid ?? null,
            fbp: signals.fbp ?? null,
            landingPage: signals.landingPage ?? null,
            utm: utm.source || utm.campaign || utm.id ? { ...utm } : { ...(deviceTouchUtm(device.lastTouch) ?? {}) },
          },
          ip: meta.ip,
          userAgent: meta.userAgent.slice(0, 500),
        };
      }
      await this.queue.add('identify', job, defaultJobOptions);
    }
    if (type === 'form_submit' || type === 'form_abandon') {
      this.bus.emit(type === 'form_submit' ? 'form.submitted' : 'form.abandoned', ws._id, {
        event: { id: event.id, deviceKey, contactId: device.contactId ? String(device.contactId) : null, pageUrl, utm, gclid: signals.gclid, fbclid: signals.fbclid, createdAt: now },
        fields: type === 'form_submit' && p.fields && typeof p.fields === 'object' ? p.fields : {},
      });
    }
    if (type === 'conversion') {
      // Give a just-submitted form's lead a moment to be created first.
      await this.queue.add('conversion', { workspaceId: ws.id, deviceKey, value } satisfies PixelConversionJob, { ...defaultJobOptions, delay: 5_000 });
    }

    await this.redis.publish(eventsChannel(ws.id), event.toJSON()).catch(() => undefined);
  }

  // ── Site keys ─────────────────────────────────────────────────────────────

  private installSnippet(key: string) {
    return `<script async src="${this.config.get('API_URL')}/pixel.js?key=${key}"></script>`;
  }

  async listSiteKeys(workspaceId: Types.ObjectId) {
    const keys = await this.siteKeys.find({ workspaceId }).sort({ createdAt: -1 });
    const since = new Date(Date.now() - 86_400_000);
    const counts = await this.events.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { workspaceId, createdAt: { $gte: since } } },
      { $group: { _id: '$siteKeyId', n: { $sum: 1 } } },
    ]);
    const byKey = new Map(counts.map((c) => [String(c._id), c.n]));
    return keys.map((k) => ({ ...this.siteKeyView(k), eventsLast24h: byKey.get(k.id) ?? 0 }));
  }

  private siteKeyView(k: SiteKeyDoc) {
    return {
      id: k.id as string,
      name: k.name,
      keyPrefix: k.keyPrefix,
      key: k.key,
      active: k.active,
      allowedDomains: k.allowedDomains,
      createLeadOnSubmit: k.createLeadOnSubmit,
      requireConsent: k.requireConsent,
      installSnippet: this.installSnippet(k.key),
      eventsLast24h: 0,
      createdAt: k.createdAt,
    };
  }

  private cleanDomains(domains?: string[]) {
    return (domains ?? [])
      .map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
      .filter(Boolean)
      .slice(0, 50);
  }

  async createSiteKey(workspaceId: Types.ObjectId, name: string, allowedDomains?: string[], requireConsent = false) {
    const { key, keyPrefix } = generateKey('aa');
    const doc = await this.siteKeys.create({ workspaceId, name: name.trim(), key, keyPrefix, allowedDomains: this.cleanDomains(allowedDomains), requireConsent });
    return this.siteKeyView(doc);
  }

  async updateSiteKey(workspaceId: Types.ObjectId, id: string, patch: { name?: string; active?: boolean; allowedDomains?: string[]; createLeadOnSubmit?: boolean; requireConsent?: boolean }) {
    const doc = await this.siteKeys.findOne({ _id: id, workspaceId });
    if (!doc) throw new NotFoundException('Site key not found');
    if (patch.name != null) doc.name = patch.name.trim();
    if (patch.active != null) doc.active = patch.active;
    if (patch.createLeadOnSubmit != null) doc.createLeadOnSubmit = patch.createLeadOnSubmit;
    if (patch.requireConsent != null) doc.requireConsent = patch.requireConsent;
    if (patch.allowedDomains) doc.allowedDomains = this.cleanDomains(patch.allowedDomains);
    await doc.save();
    this.keyCache.delete(doc.key);
    return this.siteKeyView(doc);
  }

  async deleteSiteKey(workspaceId: Types.ObjectId, id: string) {
    const doc = await this.siteKeys.findOneAndDelete({ _id: id, workspaceId });
    if (!doc) throw new NotFoundException('Site key not found');
    this.keyCache.delete(doc.key);
    return { ok: true };
  }

  // ── API keys ──────────────────────────────────────────────────────────────

  listApiKeys(workspaceId: Types.ObjectId) {
    return this.apiKeys.find({ workspaceId }).sort({ createdAt: -1 });
  }

  async createApiKey(workspaceId: Types.ObjectId, name: string) {
    const { key, hash, keyPrefix } = generateKey('aak');
    const doc = await this.apiKeys.create({ workspaceId, name: name.trim(), keyHash: hash, keyPrefix });
    return { ...doc.toJSON(), keyHash: undefined, key };
  }

  async deleteApiKey(workspaceId: Types.ObjectId, id: string) {
    const res = await this.apiKeys.deleteOne({ _id: id, workspaceId });
    if (!res.deletedCount) throw new NotFoundException('API key not found');
    return { ok: true };
  }

  // ── Events & contacts ─────────────────────────────────────────────────────

  async listEvents(workspaceId: Types.ObjectId, q: { type?: string; siteKeyId?: string; contactId?: string; page: number; pageSize: number }): Promise<Paged<TrackingEventDoc>> {
    const filter: Record<string, unknown> = { workspaceId };
    if (q.type) filter.type = q.type;
    if (q.siteKeyId && isValidObjectId(q.siteKeyId)) filter.siteKeyId = new Types.ObjectId(q.siteKeyId);
    if (q.contactId && isValidObjectId(q.contactId)) filter.contactId = new Types.ObjectId(q.contactId);
    const [items, total] = await Promise.all([
      this.events.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize),
      this.events.countDocuments(filter),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  recentEvents(workspaceId: Types.ObjectId, limit = 20) {
    return this.events.find({ workspaceId }).sort({ createdAt: -1 }).limit(limit);
  }

  private async contactViews(workspaceId: Types.ObjectId, contacts: ContactDoc[]) {
    const ids = contacts.map((c) => c._id);
    const count = (model: Model<any>) =>
      model.aggregate<{ _id: Types.ObjectId; n: number }>([
        { $match: { workspaceId, contactId: { $in: ids } } },
        { $group: { _id: '$contactId', n: { $sum: 1 } } },
      ]);
    const [devices, events, leads] = await Promise.all([count(this.devices), count(this.events), count(this.leads)]);
    const m = (rows: { _id: Types.ObjectId; n: number }[]) => new Map(rows.map((r) => [String(r._id), r.n]));
    const [d, e, l] = [m(devices), m(events), m(leads)];
    return contacts.map((c) => ({
      id: c.id as string,
      email: c.email,
      phone: c.phone ? `+${c.phone}` : null,
      name: c.name,
      status: c.status,
      intentScore: c.intentScore,
      consent: c.consent,
      country: c.country,
      firstTouch: c.firstTouch,
      lastTouch: c.lastTouch,
      deviceCount: d.get(c.id) ?? 0,
      eventCount: e.get(c.id) ?? 0,
      leadCount: l.get(c.id) ?? 0,
      lastSeenAt: c.lastSeenAt,
      createdAt: c.createdAt,
    }));
  }

  async listContacts(workspaceId: Types.ObjectId, q: { search?: string; status?: string; page: number; pageSize: number }) {
    const filter: Record<string, unknown> = { workspaceId };
    if (q.status) filter.status = q.status;
    if (q.search?.trim()) {
      const rx = new RegExp(escapeRegex(q.search.trim()), 'i');
      filter.$or = [{ email: rx }, { name: rx }, { phone: new RegExp(escapeRegex(q.search.replace(/\D/g, '') || q.search)) }];
    }
    const [rows, total] = await Promise.all([
      this.contacts.find(filter).sort({ lastSeenAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize),
      this.contacts.countDocuments(filter),
    ]);
    return { items: await this.contactViews(workspaceId, rows), total, page: q.page, pageSize: q.pageSize };
  }

  async contactDetail(workspaceId: Types.ObjectId, id: string) {
    const contact = isValidObjectId(id) ? await this.contacts.findOne({ _id: id, workspaceId }) : null;
    if (!contact) throw new NotFoundException('Contact not found');
    const [[view], devices, events, leads] = await Promise.all([
      this.contactViews(workspaceId, [contact]),
      this.devices.find({ workspaceId, contactId: contact._id }).sort({ lastSeenAt: -1 }),
      this.events.find({ workspaceId, contactId: contact._id }).sort({ createdAt: -1 }).limit(200),
      this.leads.find({ workspaceId, contactId: contact._id }).sort({ createdAt: -1 }),
    ]);
    // Latest non-sensitive form answers, newest first wins.
    const attributes: Record<string, string> = {};
    for (const ev of events) {
      if (ev.type === 'field_capture' && ev.fieldName && ev.fieldValue && !(ev.fieldName in attributes)) attributes[ev.fieldName] = ev.fieldValue;
    }
    return {
      contact: view,
      attributes,
      devices: devices.map((d) => ({
        deviceKey: d.deviceKey,
        userAgent: d.userAgent,
        platform: d.platform,
        os: d.os,
        screenRes: d.screenRes,
        firstSeenAt: d.firstSeenAt,
        lastSeenAt: d.lastSeenAt,
      })),
      events,
      leadDocs: leads,
    };
  }
}

function deviceTouchUtm(t: { source?: string; medium?: string; campaign?: string; campaignId?: string } | null | undefined) {
  if (!t) return null;
  return { source: t.source, medium: t.medium, campaign: t.campaign, id: t.campaignId };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
