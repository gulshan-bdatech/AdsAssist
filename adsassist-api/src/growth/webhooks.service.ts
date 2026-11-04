import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Queue } from 'bullmq';
import { lookup } from 'node:dns/promises';
import { randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { isValidObjectId, Model, Types } from 'mongoose';
import { decryptToken, encryptToken } from '../common/crypto/token-crypto.js';
import { EventsBus } from '../common/events/events.module.js';
import { Webhook, WebhookDelivery, WebhookDeliveryDoc, WebhookDoc, WEBHOOK_EVENTS, WebhookEvent } from '../database/schemas/growth.schema.js';
import { AutomationJob, QUEUES } from '../queues.js';
import { isPrivateAddress, signPayload } from './utils.js';

const MAX_ATTEMPTS = 6;

/** Outbound webhooks: signed POSTs of domain events to customer URLs, with retries and a delivery log. */
@Injectable()
export class WebhooksService implements OnModuleInit {
  constructor(
    @InjectModel(Webhook.name) private readonly webhooks: Model<Webhook>,
    @InjectModel(WebhookDelivery.name) private readonly deliveries: Model<WebhookDelivery>,
    @InjectQueue(QUEUES.automation) private readonly queue: Queue,
    private readonly bus: EventsBus,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    this.bus.on(async (e) => {
      if (!(WEBHOOK_EVENTS as readonly string[]).includes(e.type)) return;
      const type = e.type as WebhookEvent;
      const hooks = await this.webhooks.find({ workspaceId: new Types.ObjectId(e.workspaceId), active: true, events: type });
      for (const hook of hooks) {
        const delivery = await this.deliveries.create({
          workspaceId: hook.workspaceId,
          webhookId: hook._id,
          event: e.type,
          payload: {},
        });
        delivery.payload = { id: delivery.id, event: e.type, createdAt: e.at.toISOString(), workspaceId: e.workspaceId, data: e.data };
        await delivery.save();
        await this.enqueue(delivery);
      }
    });
  }

  private enqueue(d: WebhookDeliveryDoc) {
    const job: AutomationJob = { name: 'webhook-deliver', data: { deliveryId: d.id } };
    return this.queue.add(job.name, job.data, {
      attempts: MAX_ATTEMPTS,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: { age: 86_400 },
      removeOnFail: { age: 7 * 86_400 },
    });
  }

  /** Rejects non-https URLs (except localhost in development) and hosts that resolve to private networks. */
  async assertSafeUrl(raw: string) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new BadRequestException('Invalid URL');
    }
    const dev = this.config.get('NODE_ENV') !== 'production';
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const local = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    if (dev && local && (url.protocol === 'http:' || url.protocol === 'https:')) return url;
    if (url.protocol !== 'https:') throw new BadRequestException('Webhook URL must use https://');
    const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
    if (!addrs.length) throw new BadRequestException(`Cannot resolve ${host}`);
    if (addrs.some((a) => isPrivateAddress(a.address))) throw new BadRequestException('Webhook URL points to a private network address');
    return url;
  }

  private view(h: WebhookDoc) {
    const { secretEnc: _s, ...rest } = h.toJSON() as unknown as Record<string, unknown>;
    return rest;
  }

  async list(workspaceId: Types.ObjectId) {
    return (await this.webhooks.find({ workspaceId }).sort({ createdAt: -1 })).map((h) => this.view(h));
  }

  private async get(workspaceId: Types.ObjectId, id: string, withSecret = false) {
    const q = this.webhooks.findOne({ _id: isValidObjectId(id) ? id : null, workspaceId });
    const hook = withSecret ? await q.select('+secretEnc') : await q;
    if (!hook) throw new NotFoundException('Webhook not found');
    return hook;
  }

  private newSecret() {
    const secret = `whsec_${randomBytes(24).toString('base64url')}`;
    return { secret, secretEnc: encryptToken(secret), secretPrefix: secret.slice(0, 12) };
  }

  async create(workspaceId: Types.ObjectId, input: { name: string; url: string; events: WebhookEvent[] }) {
    await this.assertSafeUrl(input.url);
    const { secret, secretEnc, secretPrefix } = this.newSecret();
    const hook = await this.webhooks.create({ ...input, workspaceId, secretEnc, secretPrefix });
    return { ...this.view(hook), secret };
  }

  async update(workspaceId: Types.ObjectId, id: string, patch: { name?: string; url?: string; events?: WebhookEvent[]; active?: boolean }) {
    const hook = await this.get(workspaceId, id);
    if (patch.url) await this.assertSafeUrl(patch.url);
    Object.assign(hook, patch);
    if (patch.active) hook.failureCount = 0;
    await hook.save();
    return this.view(hook);
  }

  async remove(workspaceId: Types.ObjectId, id: string) {
    const hook = await this.get(workspaceId, id);
    await this.deliveries.deleteMany({ webhookId: hook._id });
    await hook.deleteOne();
    return { ok: true };
  }

  async rotate(workspaceId: Types.ObjectId, id: string) {
    const hook = await this.get(workspaceId, id);
    const { secret, secretEnc, secretPrefix } = this.newSecret();
    await hook.updateOne({ secretEnc, secretPrefix });
    return { secret };
  }

  /** Sends a `ping` synchronously so the user sees the response right away. */
  async test(workspaceId: Types.ObjectId, id: string) {
    const hook = await this.get(workspaceId, id);
    const delivery = await this.deliveries.create({ workspaceId, webhookId: hook._id, event: 'ping', payload: {} });
    delivery.payload = {
      id: delivery.id,
      event: 'ping',
      createdAt: new Date().toISOString(),
      workspaceId: String(workspaceId),
      data: { message: 'Test delivery from AdsAssist' },
    };
    await delivery.save();
    await this.deliver(delivery.id, true);
    return (await this.deliveries.findById(delivery.id))!.toJSON();
  }

  async listDeliveries(workspaceId: Types.ObjectId, webhookId: string, page: number, pageSize: number) {
    const hook = await this.get(workspaceId, webhookId);
    const [items, total] = await Promise.all([
      this.deliveries.find({ webhookId: hook._id }).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize),
      this.deliveries.countDocuments({ webhookId: hook._id }),
    ]);
    return { items, total, page, pageSize };
  }

  async redeliver(workspaceId: Types.ObjectId, deliveryId: string) {
    const d = isValidObjectId(deliveryId) ? await this.deliveries.findOne({ _id: deliveryId, workspaceId }) : null;
    if (!d) throw new NotFoundException('Delivery not found');
    d.status = 'pending';
    await d.save();
    await this.enqueue(d);
    return d.toJSON();
  }

  /**
   * Worker entry point. Throws on failure so BullMQ retries; `final` marks
   * the attempt as the last one (test sends and the final retry).
   */
  async deliver(deliveryId: string, final = false) {
    const d = await this.deliveries.findById(deliveryId);
    if (!d || d.status === 'sent') return { skipped: true };
    const hook = await this.webhooks.findById(d.webhookId).select('+secretEnc');
    if (!hook) {
      await d.updateOne({ status: 'failed', error: 'Webhook was deleted' });
      return { skipped: true };
    }
    const body = JSON.stringify(d.payload);
    const started = Date.now();
    d.attempts += 1;
    let error: string | null = null;
    try {
      await this.assertSafeUrl(hook.url);
      const res = await fetch(hook.url, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'AdsAssist-Webhooks/1.0',
          'X-AdsAssist-Event': d.event,
          'X-AdsAssist-Delivery': d.id,
          'X-AdsAssist-Signature': signPayload(decryptToken(hook.secretEnc), body),
        },
        body,
      });
      d.responseStatus = res.status;
      d.responseBody = (await res.text().catch(() => '')).slice(0, 500);
      if (res.status < 200 || res.status >= 300) error = `HTTP ${res.status}`;
    } catch (e) {
      error = (e as Error).message;
    }
    d.durationMs = Date.now() - started;
    d.error = error;
    const lastTry = final || d.attempts >= MAX_ATTEMPTS;
    d.status = error ? (lastTry ? 'failed' : 'pending') : 'sent';
    await d.save();
    await hook.updateOne(
      error
        ? { lastDeliveryAt: new Date(), lastStatus: 'failed', $inc: { failureCount: 1 } }
        : { lastDeliveryAt: new Date(), lastStatus: 'sent', failureCount: 0 },
    );
    if (error && !final) throw new Error(`Webhook delivery failed: ${error}`);
    return { sent: !error };
  }
}
