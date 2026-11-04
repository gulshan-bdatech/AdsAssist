import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export const EVENT_TYPES = [
  'page_view',
  'form_start',
  'field_capture',
  'form_abandon',
  'form_submit',
  'conversion',
  'identify',
  'custom',
  'email_open',
  'email_click',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export type Channel = 'google' | 'meta' | 'organic' | 'other';

@Schema({ timestamps: true, collection: 'site_keys' })
export class SiteKey {
  @Prop({ type: Types.ObjectId, ref: 'Workspace', required: true, index: true }) workspaceId: Types.ObjectId;
  @Prop({ required: true, trim: true }) name: string;
  @Prop({ required: true }) keyPrefix: string;
  /** Pixel keys are public (they sit in page HTML), so the key itself is stored to rebuild the install snippet. */
  @Prop({ required: true, unique: true }) key: string;
  @Prop({ default: true }) active: boolean;
  @Prop({ type: [String], default: [] }) allowedDomains: string[];
  @Prop({ default: true }) createLeadOnSubmit: boolean;
  /** Pixel holds back PII until the page calls adsassist.consent(true). */
  @Prop({ default: false }) requireConsent: boolean;
  createdAt: Date;
}
export type SiteKeyDoc = HydratedDocument<SiteKey>;
export const SiteKeySchema = SchemaFactory.createForClass(SiteKey);

@Schema({ timestamps: true, collection: 'api_keys' })
export class ApiKey {
  @Prop({ type: Types.ObjectId, ref: 'Workspace', required: true, index: true }) workspaceId: Types.ObjectId;
  @Prop({ required: true, trim: true }) name: string;
  @Prop({ required: true }) keyPrefix: string;
  @Prop({ required: true, unique: true, select: false }) keyHash: string;
  @Prop({ type: Date, default: null }) lastUsedAt: Date | null;
  createdAt: Date;
}
export type ApiKeyDoc = HydratedDocument<ApiKey>;
export const ApiKeySchema = SchemaFactory.createForClass(ApiKey);

@Schema({ _id: false })
export class Utm {
  @Prop() source?: string;
  @Prop() medium?: string;
  @Prop() campaign?: string;
  @Prop() content?: string;
  @Prop() term?: string;
  /** utm_id — set it to the campaign id ({campaignid} on Google, {{campaign.id}} on Meta) for exact attribution. */
  @Prop() id?: string;
}
export const UtmSchema = SchemaFactory.createForClass(Utm);

@Schema({ collection: 'events' })
export class TrackingEvent {
  @Prop({ type: Types.ObjectId, ref: 'Workspace', required: true }) workspaceId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'SiteKey', default: null }) siteKeyId: Types.ObjectId | null;
  @Prop({ type: Types.ObjectId, ref: 'Contact', default: null }) contactId: Types.ObjectId | null;
  @Prop({ required: true }) deviceKey: string;
  @Prop({ enum: EVENT_TYPES, required: true }) type: EventType;
  @Prop({ default: '' }) name: string;
  @Prop({ default: '' }) pageUrl: string;
  @Prop({ default: '' }) pagePath: string;
  @Prop({ default: '' }) referrer: string;
  @Prop({ type: UtmSchema, default: () => ({}) }) utm: Utm;
  @Prop({ type: String, default: null }) gclid: string | null;
  @Prop({ type: String, default: null }) fbclid: string | null;
  @Prop({ type: String, default: null }) fbp: string | null;
  @Prop({ type: String, default: null }) fieldName: string | null;
  @Prop({ type: String, default: null }) fieldValue: string | null;
  @Prop({ type: Number, default: null }) value: number | null;
  @Prop({ default: '' }) ip: string;
  @Prop({ default: '' }) userAgent: string;
  @Prop({ default: '' }) country: string;
  @Prop({ default: () => new Date() }) createdAt: Date;
}
export type TrackingEventDoc = HydratedDocument<TrackingEvent>;
export const TrackingEventSchema = SchemaFactory.createForClass(TrackingEvent);
TrackingEventSchema.index({ workspaceId: 1, createdAt: -1 });
TrackingEventSchema.index({ workspaceId: 1, deviceKey: 1, createdAt: -1 });
TrackingEventSchema.index({ workspaceId: 1, contactId: 1, createdAt: -1 });
TrackingEventSchema.index({ workspaceId: 1, type: 1, createdAt: -1 });

@Schema({ _id: false })
export class Touch {
  @Prop({ default: 'organic' }) channel: Channel;
  @Prop() source?: string;
  @Prop() medium?: string;
  @Prop() campaign?: string;
  @Prop() campaignId?: string;
  @Prop() gclid?: string;
  @Prop() fbclid?: string;
  @Prop() fbp?: string;
  @Prop() landingPage?: string;
  @Prop() at?: Date;
}
export const TouchSchema = SchemaFactory.createForClass(Touch);

/** A real person seen by the pixel, stitched across devices by email/phone. */
@Schema({ timestamps: true, collection: 'contacts' })
export class Contact {
  @Prop({ type: Types.ObjectId, ref: 'Workspace', required: true }) workspaceId: Types.ObjectId;
  @Prop({ type: String, default: null }) email: string | null;
  @Prop({ type: String, default: null }) phone: string | null;
  @Prop({ type: String, default: null }) name: string | null;
  @Prop({ type: String, default: null }) emailHash: string | null;
  @Prop({ type: String, default: null }) phoneHash: string | null;
  @Prop({ enum: ['anonymous', 'known', 'cross_device'], default: 'known' }) status: 'anonymous' | 'known' | 'cross_device';
  @Prop({ default: 0 }) intentScore: number;
  @Prop({ type: Boolean, default: null }) consent: boolean | null;
  @Prop({ default: '' }) country: string;
  @Prop({ type: TouchSchema, default: null }) firstTouch: Touch | null;
  @Prop({ type: TouchSchema, default: null }) lastTouch: Touch | null;
  @Prop({ type: Map, of: String, default: {} }) attributes: Map<string, string>;
  @Prop({ default: () => new Date() }) lastSeenAt: Date;
  createdAt: Date;
}
export type ContactDoc = HydratedDocument<Contact>;
export const ContactSchema = SchemaFactory.createForClass(Contact);
ContactSchema.index(
  { workspaceId: 1, emailHash: 1 },
  { unique: true, partialFilterExpression: { emailHash: { $type: 'string' } } },
);
ContactSchema.index(
  { workspaceId: 1, phoneHash: 1 },
  { unique: true, partialFilterExpression: { phoneHash: { $type: 'string' } } },
);
ContactSchema.index({ workspaceId: 1, lastSeenAt: -1 });

/** One browser (first-party cookie) per row. */
@Schema({ collection: 'devices' })
export class Device {
  @Prop({ type: Types.ObjectId, ref: 'Workspace', required: true }) workspaceId: Types.ObjectId;
  @Prop({ required: true }) deviceKey: string;
  @Prop({ type: Types.ObjectId, ref: 'Contact', default: null, index: true }) contactId: Types.ObjectId | null;
  @Prop({ default: '' }) userAgent: string;
  @Prop({ default: '' }) ip: string;
  @Prop({ default: '' }) screenRes: string;
  @Prop({ default: '' }) platform: string;
  @Prop({ default: '' }) os: string;
  /** First ad touch on this browser, copied to the contact once it is identified. */
  @Prop({ type: TouchSchema, default: null }) firstTouch: Touch | null;
  @Prop({ type: TouchSchema, default: null }) lastTouch: Touch | null;
  @Prop({ default: () => new Date() }) firstSeenAt: Date;
  @Prop({ default: () => new Date() }) lastSeenAt: Date;
}
export type DeviceDoc = HydratedDocument<Device>;
export const DeviceSchema = SchemaFactory.createForClass(Device);
DeviceSchema.index({ workspaceId: 1, deviceKey: 1 }, { unique: true });
