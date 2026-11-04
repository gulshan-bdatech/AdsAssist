import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomBytes } from 'node:crypto';
import { Model, Types } from 'mongoose';
import { EventsBus } from '../common/events/events.module.js';
import { RedisService } from '../common/redis/redis.module.js';
import { emailHash, normalizeEmail, normalizePhone, phoneHash } from '../common/utils/identity.js';
import { Contact, ContactDoc, Device, EventType, TrackingEvent } from '../database/schemas/tracking.schema.js';
import { WorkspaceDoc } from '../database/schemas/workspace.schema.js';

const INTENT_WEIGHTS: Partial<Record<EventType, number>> = {
  page_view: 2,
  form_start: 10,
  field_capture: 4,
  form_abandon: 5,
  form_submit: 35,
  conversion: 50,
  identify: 10,
};

/**
 * Stitches a browser (device key) to a contact using email/phone. Ported from
 * the FunnelOS identity worker, with the same lookup order:
 *   1. contact with this email hash (returning / cross-device visitor)
 *   2. contact with this phone hash
 *   3. contact already linked to this browser (email then phone on one form)
 *   4. new contact
 * First captured email/phone stays on the profile; a second, unknown email on
 * the same browser doesn't create another person.
 */
@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);

  constructor(
    @InjectModel(Contact.name) private readonly contacts: Model<Contact>,
    @InjectModel(Device.name) private readonly devices: Model<Device>,
    @InjectModel(TrackingEvent.name) private readonly events: Model<TrackingEvent>,
    private readonly redis: RedisService,
    private readonly bus: EventsBus,
  ) {}

  async resolve(
    ws: WorkspaceDoc,
    deviceKey: string,
    raw: { email?: string | null; phone?: string | null; name?: string | null; consent?: boolean | null; country?: string },
  ) {
    const email = normalizeEmail(raw.email);
    const phone = normalizePhone(raw.phone, ws.phoneCountryCode);
    if (!email && !phone) return null;
    const contact = await this.withDeviceLock(ws._id, deviceKey, () => this.resolveLocked(ws, deviceKey, email, phone, raw.name?.trim() || null));
    const set: Record<string, unknown> = {};
    // An explicit opt-out always wins; an opt-in only fills an unknown state.
    if (raw.consent === false || (raw.consent === true && contact.consent == null)) set.consent = raw.consent;
    if (raw.country && !contact.country) set.country = raw.country;
    if (Object.keys(set).length) await contact.updateOne(set);
    return contact;
  }

  /** Serialises work per browser so the email and phone blur of one form don't race. */
  private async withDeviceLock<T>(workspaceId: Types.ObjectId, deviceKey: string, fn: () => Promise<T>): Promise<T> {
    const key = `lock:identity:${workspaceId}:${deviceKey}`;
    const token = randomBytes(8).toString('hex');
    for (let i = 0; i < 50; i++) {
      if (await this.redis.client.set(key, token, 'PX', 10_000, 'NX')) {
        try {
          return await fn();
        } finally {
          if ((await this.redis.client.get(key)) === token) await this.redis.client.del(key);
        }
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`Identity lock busy for device ${deviceKey}`);
  }

  private async lookup(workspaceId: Types.ObjectId, deviceKey: string, eh: string | null, ph: string | null) {
    if (eh) {
      const c = await this.contacts.findOne({ workspaceId, emailHash: eh });
      if (c) return c;
    }
    if (ph) {
      const c = await this.contacts.findOne({ workspaceId, phoneHash: ph });
      if (c) return c;
    }
    const device = await this.devices.findOne({ workspaceId, deviceKey, contactId: { $ne: null } });
    return device ? this.contacts.findById(device.contactId) : null;
  }

  private async resolveLocked(ws: WorkspaceDoc, deviceKey: string, email: string | null, phone: string | null, name: string | null) {
    const eh = email ? emailHash(email) : null;
    const ph = phone ? phoneHash(phone) : null;
    let contact = await this.lookup(ws._id, deviceKey, eh, ph);
    if (!contact) {
      try {
        contact = await this.contacts.create({ workspaceId: ws._id, email, phone, name, emailHash: eh, phoneHash: ph, status: 'known' });
        this.bus.emit('contact.identified', ws._id, {
          contact: { id: contact.id, email, phone: phone ? `+${phone}` : null, name, deviceKey, createdAt: contact.createdAt },
        });
      } catch (e: any) {
        // Another browser created this person concurrently.
        if (e?.code !== 11000) throw e;
        contact = await this.lookup(ws._id, deviceKey, eh, ph);
        if (!contact) throw e;
      }
    } else {
      await this.enrich(contact, email, eh, phone, ph, name);
    }
    await this.linkDevice(ws._id, deviceKey, contact);
    return contact;
  }

  private async enrich(c: ContactDoc, email: string | null, eh: string | null, phone: string | null, ph: string | null, name: string | null) {
    const set: Record<string, unknown> = { lastSeenAt: new Date() };
    if (!c.emailHash && eh && !(await this.contacts.exists({ workspaceId: c.workspaceId, emailHash: eh }))) {
      set.email = email;
      set.emailHash = eh;
    }
    if (!c.phoneHash && ph && !(await this.contacts.exists({ workspaceId: c.workspaceId, phoneHash: ph }))) {
      set.phone = phone;
      set.phoneHash = ph;
    }
    if (!c.name && name) set.name = name.slice(0, 200);
    if (c.status === 'anonymous') set.status = 'known';
    await c.updateOne(set);
  }

  /** Points the browser at the contact, backfills its anonymous events and carries its ad touches over. */
  private async linkDevice(workspaceId: Types.ObjectId, deviceKey: string, contact: ContactDoc) {
    const device = await this.devices.findOneAndUpdate(
      { workspaceId, deviceKey },
      { $set: { contactId: contact._id, lastSeenAt: new Date() }, $setOnInsert: { firstSeenAt: new Date() } },
      { upsert: true, returnDocument: 'after' },
    );
    await this.events.updateMany({ workspaceId, deviceKey, contactId: null }, { contactId: contact._id });

    const set: Record<string, unknown> = {};
    if (!contact.firstTouch && device.firstTouch) set.firstTouch = device.firstTouch;
    if (device.lastTouch && (!contact.lastTouch?.at || (device.lastTouch.at && device.lastTouch.at > contact.lastTouch.at))) {
      set.lastTouch = device.lastTouch;
    }
    const deviceCount = await this.devices.countDocuments({ workspaceId, contactId: contact._id });
    if (deviceCount > 1) set.status = 'cross_device';
    set.intentScore = await this.intentScore(workspaceId, contact._id);
    await contact.updateOne(set);
  }

  /** 0–100 from the contact's recent behaviour; capped so one long session can't max it out. */
  async intentScore(workspaceId: Types.ObjectId, contactId: Types.ObjectId): Promise<number> {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const rows = await this.events.aggregate<{ _id: EventType; n: number }>([
      { $match: { workspaceId, contactId, createdAt: { $gte: since } } },
      { $group: { _id: '$type', n: { $sum: 1 } } },
    ]);
    let score = 0;
    for (const r of rows) score += (INTENT_WEIGHTS[r._id] ?? 1) * Math.min(r.n, r._id === 'page_view' ? 10 : 3);
    return Math.min(100, score);
  }
}
