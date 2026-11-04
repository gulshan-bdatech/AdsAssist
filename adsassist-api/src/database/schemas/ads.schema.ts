import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { PLATFORMS, type Platform } from './integration.schema.js';

export type EntityStatus = 'active' | 'paused' | 'removed' | 'other';

/** Maps Google (ENABLED/PAUSED/REMOVED) and Meta (ACTIVE/PAUSED/DELETED/ARCHIVED…) statuses to one set. */
export function normalizeStatus(raw: string | undefined | null): EntityStatus {
  const s = (raw ?? '').toUpperCase();
  if (s === 'ENABLED' || s === 'ACTIVE') return 'active';
  if (s === 'PAUSED' || s.endsWith('_PAUSED') || s === 'CAMPAIGN_PAUSED' || s === 'ADSET_PAUSED') return 'paused';
  if (s === 'REMOVED' || s === 'DELETED' || s === 'ARCHIVED') return 'removed';
  return 'other';
}

const common = {
  workspaceId: { type: Types.ObjectId, ref: 'Workspace', required: true },
  adAccountId: { type: Types.ObjectId, ref: 'AdAccount', required: true },
};

@Schema({ timestamps: true, collection: 'campaigns' })
export class Campaign {
  @Prop(common.workspaceId) workspaceId: Types.ObjectId;
  @Prop(common.adAccountId) adAccountId: Types.ObjectId;
  @Prop({ enum: PLATFORMS, required: true }) platform: Platform;
  @Prop({ required: true }) externalId: string;
  @Prop({ default: '' }) name: string;
  @Prop({ default: 'other' }) status: EntityStatus;
  @Prop({ default: '' }) rawStatus: string;
  @Prop({ default: '' }) objective: string;
  @Prop({ type: Number, default: null }) dailyBudget: number | null;
}
export type CampaignDoc = HydratedDocument<Campaign>;
export const CampaignSchema = SchemaFactory.createForClass(Campaign);
CampaignSchema.index({ adAccountId: 1, externalId: 1 }, { unique: true });
CampaignSchema.index({ workspaceId: 1, platform: 1, status: 1 });
CampaignSchema.index({ workspaceId: 1, name: 1 });

@Schema({ timestamps: true, collection: 'ad_groups' })
export class AdGroup {
  @Prop(common.workspaceId) workspaceId: Types.ObjectId;
  @Prop(common.adAccountId) adAccountId: Types.ObjectId;
  @Prop({ enum: PLATFORMS, required: true }) platform: Platform;
  @Prop({ required: true }) externalId: string;
  @Prop({ required: true }) campaignExternalId: string;
  @Prop({ default: '' }) name: string;
  @Prop({ default: 'other' }) status: EntityStatus;
  @Prop({ default: '' }) rawStatus: string;
}
export type AdGroupDoc = HydratedDocument<AdGroup>;
export const AdGroupSchema = SchemaFactory.createForClass(AdGroup);
AdGroupSchema.index({ adAccountId: 1, externalId: 1 }, { unique: true });
AdGroupSchema.index({ adAccountId: 1, campaignExternalId: 1 });

@Schema({ timestamps: true, collection: 'ads' })
export class Ad {
  @Prop(common.workspaceId) workspaceId: Types.ObjectId;
  @Prop(common.adAccountId) adAccountId: Types.ObjectId;
  @Prop({ enum: PLATFORMS, required: true }) platform: Platform;
  @Prop({ required: true }) externalId: string;
  @Prop({ required: true }) campaignExternalId: string;
  @Prop({ default: '' }) adGroupExternalId: string;
  @Prop({ default: '' }) name: string;
  @Prop({ default: 'other' }) status: EntityStatus;
  @Prop({ default: '' }) rawStatus: string;
  @Prop({ default: '' }) headline: string;
  @Prop({ default: '' }) body: string;
  @Prop({ default: '' }) imageUrl: string;
  @Prop({ default: '' }) finalUrl: string;
}
export type AdDoc = HydratedDocument<Ad>;
export const AdSchema = SchemaFactory.createForClass(Ad);
AdSchema.index({ adAccountId: 1, externalId: 1 }, { unique: true });
AdSchema.index({ adAccountId: 1, campaignExternalId: 1 });

export type MetricLevel = 'campaign' | 'ad_group' | 'ad';

/**
 * One row per (ad account, level, entity, day) as reported by the platform.
 * Campaign-level rows are the source of truth for totals; ad group and ad
 * rows are only used for drill-down so nothing is double counted.
 */
@Schema({ timestamps: true, collection: 'metrics_daily' })
export class MetricDaily {
  @Prop(common.workspaceId) workspaceId: Types.ObjectId;
  @Prop(common.adAccountId) adAccountId: Types.ObjectId;
  @Prop({ enum: PLATFORMS, required: true }) platform: Platform;
  @Prop({ enum: ['campaign', 'ad_group', 'ad'], required: true }) level: MetricLevel;
  @Prop({ required: true }) entityExternalId: string;
  @Prop({ required: true }) campaignExternalId: string;
  @Prop({ default: '' }) adGroupExternalId: string;
  @Prop({ required: true }) date: string;
  @Prop({ default: 0 }) spend: number;
  @Prop({ default: 0 }) impressions: number;
  @Prop({ default: 0 }) clicks: number;
  @Prop({ default: 0 }) conversions: number;
  @Prop({ default: 0 }) conversionValue: number;
  /** Platform-reported lead results (Meta "lead" action, Google conversions in a lead category). */
  @Prop({ default: 0 }) platformLeads: number;
  @Prop({ default: 0 }) reach: number;
  /** Start time of the sync that last wrote this row; older rows in a re-synced window are stale and removed. */
  @Prop({ required: true }) syncedAt: Date;
}
export type MetricDailyDoc = HydratedDocument<MetricDaily>;
export const MetricDailySchema = SchemaFactory.createForClass(MetricDaily);
MetricDailySchema.index({ adAccountId: 1, level: 1, entityExternalId: 1, date: 1 }, { unique: true });
MetricDailySchema.index({ workspaceId: 1, level: 1, date: 1 });
MetricDailySchema.index({ workspaceId: 1, level: 1, campaignExternalId: 1, date: 1 });
