import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { PLATFORMS, type Platform } from './integration.schema.js';
import { UtmSchema, type Channel, type Utm } from './tracking.schema.js';

@Schema({ _id: false })
export class StageChange {
  @Prop({ required: true }) stage: string;
  @Prop({ required: true }) at: Date;
  @Prop({ enum: ['pixel', 'api', 'user'], required: true }) by: 'pixel' | 'api' | 'user';
  @Prop({ type: Types.ObjectId, ref: 'User', default: null }) userId: Types.ObjectId | null;
}
const StageChangeSchema = SchemaFactory.createForClass(StageChange);

export type LeadSource = 'pixel' | 'api' | 'manual' | 'meta_form';

@Schema({ timestamps: true, collection: 'leads' })
export class Lead {
  @Prop({ type: Types.ObjectId, ref: 'Workspace', required: true }) workspaceId: Types.ObjectId;
  /** Caller-supplied id (CRM/LMS id) or generated. Unique per workspace. */
  @Prop({ required: true }) externalId: string;
  @Prop({ enum: ['pixel', 'api', 'manual', 'meta_form'], required: true }) source: LeadSource;
  @Prop({ type: String, default: null }) name: string | null;
  @Prop({ type: String, default: null }) email: string | null;
  @Prop({ type: String, default: null }) phone: string | null;
  @Prop({ type: String, default: null }) emailHash: string | null;
  @Prop({ type: String, default: null }) phoneHash: string | null;
  @Prop({ required: true }) stage: string;
  @Prop({ type: Number, default: null }) value: number | null;
  @Prop({ default: 'INR' }) currency: string;
  @Prop({ default: 'organic' }) channel: Channel;
  @Prop({ type: Types.ObjectId, ref: 'Campaign', default: null }) campaignId: Types.ObjectId | null;
  @Prop({ type: Types.ObjectId, ref: 'AdAccount', default: null }) adAccountId: Types.ObjectId | null;
  @Prop({ type: String, default: null }) campaignExternalId: string | null;
  @Prop({ type: UtmSchema, default: () => ({}) }) utm: Utm;
  @Prop({ type: String, default: null }) gclid: string | null;
  @Prop({ type: String, default: null }) fbclid: string | null;
  @Prop({ type: String, default: null }) fbp: string | null;
  @Prop({ default: '' }) landingPage: string;
  /** null = unknown, false = opted out (never pushed to ad platforms or audiences). */
  @Prop({ type: Boolean, default: null }) consent: boolean | null;
  @Prop({ default: '' }) country: string;
  /** Meta Lead Ads lead id, for de-duplicating form imports. */
  @Prop({ type: String, default: null }) metaLeadId: string | null;
  @Prop({ default: '' }) ip: string;
  @Prop({ default: '' }) userAgent: string;
  @Prop({ type: Types.ObjectId, ref: 'Contact', default: null }) contactId: Types.ObjectId | null;
  @Prop({ type: String, default: null }) deviceKey: string | null;
  @Prop({ default: '' }) notes: string;
  @Prop({ type: Map, of: String, default: {} }) fields: Map<string, string>;
  @Prop({ type: [StageChangeSchema], default: [] }) history: StageChange[];
  @Prop({ type: Date, default: null }) wonAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
export type LeadDoc = HydratedDocument<Lead>;
export const LeadSchema = SchemaFactory.createForClass(Lead);
LeadSchema.index({ workspaceId: 1, externalId: 1 }, { unique: true });
LeadSchema.index({ workspaceId: 1, createdAt: -1 });
LeadSchema.index({ workspaceId: 1, stage: 1 });
LeadSchema.index({ workspaceId: 1, campaignId: 1 });
LeadSchema.index({ workspaceId: 1, emailHash: 1 });
LeadSchema.index({ workspaceId: 1, phoneHash: 1 });
LeadSchema.index({ workspaceId: 1, contactId: 1 });
LeadSchema.index({ workspaceId: 1, metaLeadId: 1 }, { unique: true, partialFilterExpression: { metaLeadId: { $type: 'string' } } });

export type PushStatus = 'pending' | 'sent' | 'failed' | 'skipped';

/** Audit row for one offline/server-side conversion sent to an ad platform. */
@Schema({ timestamps: true, collection: 'conversion_pushes' })
export class ConversionPush {
  @Prop({ type: Types.ObjectId, ref: 'Workspace', required: true }) workspaceId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'Lead', required: true, index: true }) leadId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'AdAccount', default: null }) adAccountId: Types.ObjectId | null;
  @Prop({ enum: PLATFORMS, required: true }) platform: Platform;
  @Prop({ required: true }) stage: string;
  @Prop({ default: '' }) eventName: string;
  /** Dedup key sent to the platform (Meta event_id / Google order_id). */
  @Prop({ required: true }) eventId: string;
  @Prop({ enum: ['pending', 'sent', 'failed', 'skipped'], default: 'pending' }) status: PushStatus;
  @Prop({ default: 0 }) attempts: number;
  @Prop({ type: String, default: null }) lastError: string | null;
  @Prop({ type: Object, default: null }) response: Record<string, unknown> | null;
  @Prop({ type: Date, default: null }) sentAt: Date | null;
  createdAt: Date;
}
export type ConversionPushDoc = HydratedDocument<ConversionPush>;
export const ConversionPushSchema = SchemaFactory.createForClass(ConversionPush);
ConversionPushSchema.index({ workspaceId: 1, platform: 1, eventId: 1 }, { unique: true });
ConversionPushSchema.index({ workspaceId: 1, createdAt: -1 });
