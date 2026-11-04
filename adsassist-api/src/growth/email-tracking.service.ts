import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { isValidObjectId, Model, Types } from 'mongoose';
import { escapeRegex } from '../common/dto.js';
import { RedisService } from '../common/redis/redis.module.js';
import { DayRange, rangeToInstants } from '../common/utils/dates.js';
import { emailHash, normalizeEmail } from '../common/utils/identity.js';
import { round } from '../common/utils/metrics.js';
import { EmailMessage, EmailMessageDoc } from '../database/schemas/growth.schema.js';
import { Contact, TrackingEvent } from '../database/schemas/tracking.schema.js';
import { WorkspaceDoc } from '../database/schemas/workspace.schema.js';
import { eventsChannel } from '../tracking/tracking.service.js';

/** 1×1 transparent GIF. */
export const PIXEL_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

/**
 * Email open/click tracking (from FunnelOS). The sender registers each email
 * and gets a tracking pixel and rewritten links. Tokens are
 * `<messageDocId>.<o|linkIndex>.<hmac>`, so a link can only redirect to a URL
 * that was registered with the message (no open redirect).
 */
@Injectable()
export class EmailTrackingService {
  private readonly key: Buffer;

  constructor(
    @InjectModel(EmailMessage.name) private readonly messages: Model<EmailMessage>,
    @InjectModel(Contact.name) private readonly contacts: Model<Contact>,
    @InjectModel(TrackingEvent.name) private readonly events: Model<TrackingEvent>,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {
    this.key = createHmac('sha256', config.getOrThrow<string>('JWT_SECRET')).update('email-tracking-v1').digest();
  }

  private sign(id: string, part: string) {
    return createHmac('sha256', this.key).update(`${id}.${part}`).digest('base64url').slice(0, 22);
  }

  private token(id: string, part: string) {
    return `${id}.${part}.${this.sign(id, part)}`;
  }

  /** Returns [messageDocId, part] for a valid token, else null. */
  private verify(token: string): [string, string] | null {
    const [id, part, sig] = token.split('.');
    if (!id || !part || !sig || !isValidObjectId(id)) return null;
    const expected = Buffer.from(this.sign(id, part));
    const given = Buffer.from(sig);
    return expected.length === given.length && timingSafeEqual(expected, given) ? [id, part] : null;
  }

  async register(ws: WorkspaceDoc, input: { to: string; subject?: string; campaign?: string; messageId?: string; links?: string[] }) {
    const to = normalizeEmail(input.to);
    if (!to) throw new BadRequestException('"to" must be a valid email');
    const links = (input.links ?? []).slice(0, 50);
    for (const l of links) {
      try {
        if (!['http:', 'https:'].includes(new URL(l).protocol)) throw new Error();
      } catch {
        throw new BadRequestException(`Invalid link: ${l}`);
      }
    }
    const toHash = emailHash(to);
    const contact = await this.contacts.findOne({ workspaceId: ws._id, emailHash: toHash }, { _id: 1 });
    const messageId = input.messageId?.trim() || `msg_${randomBytes(9).toString('base64url')}`;
    let doc: EmailMessageDoc;
    try {
      doc = await this.messages.create({
        workspaceId: ws._id,
        messageId,
        to,
        toHash,
        subject: input.subject?.slice(0, 300) ?? '',
        campaign: input.campaign?.slice(0, 120) ?? '',
        links,
        contactId: (contact?._id as Types.ObjectId | undefined) ?? null,
      });
    } catch (e: any) {
      if (e?.code === 11000) throw new BadRequestException(`messageId "${messageId}" was already registered`);
      throw e;
    }
    const api = this.config.get<string>('API_URL')!.replace(/\/$/, '');
    const openPixelUrl = `${api}/api/v1/e/o/${this.token(doc.id, 'o')}`;
    return {
      messageId,
      openPixelUrl,
      openPixelHtml: `<img src="${openPixelUrl}" width="1" height="1" alt="" style="display:block;border:0" />`,
      links: links.map((url, i) => ({ url, trackedUrl: `${api}/api/v1/e/c/${this.token(doc.id, String(i))}` })),
    };
  }

  private async record(msg: EmailMessageDoc, type: 'email_open' | 'email_click', meta: { ip: string; userAgent: string }, url?: string) {
    const event = await this.events.create({
      workspaceId: msg.workspaceId,
      contactId: msg.contactId,
      deviceKey: `em_${msg.toHash.slice(0, 24)}`,
      type,
      name: msg.campaign || msg.subject.slice(0, 120),
      pageUrl: url ?? '',
      ip: meta.ip,
      userAgent: meta.userAgent.slice(0, 500),
    });
    if (msg.contactId) await this.contacts.updateOne({ _id: msg.contactId }, { lastSeenAt: new Date() });
    await this.redis.publish(eventsChannel(String(msg.workspaceId)), event.toJSON()).catch(() => undefined);
  }

  async open(token: string, meta: { ip: string; userAgent: string }) {
    const v = this.verify(token);
    if (!v || v[1] !== 'o') return;
    const msg = await this.messages.findByIdAndUpdate(v[0], { $inc: { opens: 1 } }, { returnDocument: 'after' });
    if (!msg) return;
    if (!msg.firstOpenedAt) await msg.updateOne({ firstOpenedAt: new Date() });
    await this.record(msg, 'email_open', meta);
  }

  /** Returns the URL to redirect to, or null for an invalid token. */
  async click(token: string, meta: { ip: string; userAgent: string }): Promise<string | null> {
    const v = this.verify(token);
    if (!v || !/^\d+$/.test(v[1])) return null;
    const msg = await this.messages.findById(v[0]);
    const url = msg?.links[Number(v[1])];
    if (!msg || !url) return null;
    await msg.updateOne({ $inc: { clicks: 1 }, lastClickedAt: new Date(), ...(msg.firstOpenedAt ? {} : { firstOpenedAt: new Date() }) });
    await this.record(msg, 'email_click', meta, url);
    return url;
  }

  async list(workspaceId: Types.ObjectId, q: { search?: string; campaign?: string; page: number; pageSize: number }) {
    const filter: Record<string, unknown> = { workspaceId };
    if (q.campaign) filter.campaign = q.campaign;
    if (q.search?.trim()) {
      const rx = new RegExp(escapeRegex(q.search.trim()), 'i');
      filter.$or = [{ to: rx }, { subject: rx }, { messageId: rx }];
    }
    const [rows, total] = await Promise.all([
      this.messages.find(filter, { links: 0, toHash: 0 }).sort({ createdAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize),
      this.messages.countDocuments(filter),
    ]);
    return { items: rows, total, page: q.page, pageSize: q.pageSize };
  }

  async stats(ws: WorkspaceDoc, range: DayRange) {
    const { start, end } = rangeToInstants(range, ws.timezone);
    const rows = await this.messages.aggregate<{ _id: string; sent: number; opened: number; clicked: number }>([
      { $match: { workspaceId: ws._id, createdAt: { $gte: start, $lt: end } } },
      {
        $group: {
          _id: '$campaign',
          sent: { $sum: 1 },
          opened: { $sum: { $cond: [{ $gt: ['$opens', 0] }, 1, 0] } },
          clicked: { $sum: { $cond: [{ $gt: ['$clicks', 0] }, 1, 0] } },
        },
      },
      { $sort: { sent: -1 } },
    ]);
    const rate = (a: number, b: number) => (b ? round((a / b) * 100, 1) : 0);
    const sum = (k: 'sent' | 'opened' | 'clicked') => rows.reduce((s, r) => s + r[k], 0);
    return {
      sent: sum('sent'),
      opened: sum('opened'),
      clicked: sum('clicked'),
      openRate: rate(sum('opened'), sum('sent')),
      clickRate: rate(sum('clicked'), sum('sent')),
      byCampaign: rows.map((r) => ({
        campaign: r._id || '(none)',
        sent: r.sent,
        opened: r.opened,
        clicked: r.clicked,
        openRate: rate(r.opened, r.sent),
        clickRate: rate(r.clicked, r.sent),
      })),
    };
  }
}
