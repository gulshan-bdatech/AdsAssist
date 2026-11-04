import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { EventsBus } from '../common/events/events.module.js';
import { Notification, NotificationKind, Severity } from '../database/schemas/growth.schema.js';

export interface NewNotification {
  kind: NotificationKind;
  severity: Severity;
  title: string;
  body?: string;
  link?: string | null;
  /** Collapses repeats: an unread notification with this key from the last 24 h is not duplicated. */
  dedupeKey?: string;
}

/** In-app notifications (the bell). Also turns sync and conversion failures into notifications. */
@Injectable()
export class NotificationsService implements OnModuleInit {
  constructor(
    @InjectModel(Notification.name) private readonly notifications: Model<Notification>,
    private readonly bus: EventsBus,
  ) {}

  onModuleInit() {
    this.bus.on(async (e) => {
      if (e.type === 'sync.failed') {
        const d = e.data as { adAccountId: string; platform: string; name: string; error: string };
        await this.create(e.workspaceId, {
          kind: 'sync_error',
          severity: 'critical',
          title: `${d.platform === 'google' ? 'Google Ads' : 'Meta'} account "${d.name}" failed to sync`,
          body: d.error,
          link: `/w/${e.workspaceId}/integrations`,
          dedupeKey: `sync:${d.adAccountId}`,
        });
      } else if (e.type === 'conversion.failed') {
        const d = e.data as { leadId: string; error: string; conversion: { platform: string; eventName: string } };
        await this.create(e.workspaceId, {
          kind: 'conversion_failed',
          severity: 'warning',
          title: `${d.conversion.platform === 'google' ? 'Google' : 'Meta'} rejected a "${d.conversion.eventName}" conversion`,
          body: d.error,
          link: `/w/${e.workspaceId}/conversions?status=failed`,
          dedupeKey: `push:${d.conversion.platform}:${d.error.slice(0, 80)}`,
        });
      }
    });
  }

  async create(workspaceId: string | Types.ObjectId, n: NewNotification) {
    const wid = new Types.ObjectId(String(workspaceId));
    if (n.dedupeKey) {
      const recent = await this.notifications.exists({
        workspaceId: wid,
        dedupeKey: n.dedupeKey,
        read: false,
        createdAt: { $gte: new Date(Date.now() - 86_400_000) },
      });
      if (recent) return null;
    }
    return this.notifications.create({ workspaceId: wid, body: '', link: null, ...n, dedupeKey: n.dedupeKey ?? null });
  }

  async list(workspaceId: Types.ObjectId, q: { unread?: boolean; page: number; pageSize: number }) {
    const filter: Record<string, unknown> = { workspaceId };
    if (q.unread) filter.read = false;
    const [items, total, unreadCount] = await Promise.all([
      this.notifications.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize),
      this.notifications.countDocuments(filter),
      this.notifications.countDocuments({ workspaceId, read: false }),
    ]);
    return { items: items.map((n) => ({ ...n.toJSON(), dedupeKey: undefined })), total, page: q.page, pageSize: q.pageSize, unreadCount };
  }

  async markRead(workspaceId: Types.ObjectId, ids?: string[]) {
    const filter: Record<string, unknown> = { workspaceId, read: false };
    if (ids?.length) filter._id = { $in: ids.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id)) };
    await this.notifications.updateMany(filter, { read: true });
    return { unreadCount: await this.notifications.countDocuments({ workspaceId, read: false }) };
  }
}
