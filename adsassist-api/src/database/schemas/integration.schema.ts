import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export const PLATFORMS = ['google', 'meta'] as const;
export type Platform = (typeof PLATFORMS)[number];

@Schema({ _id: false })
export class AvailableAccount {
  @Prop({ required: true }) externalId: string;
  @Prop({ default: '' }) name: string;
  @Prop({ default: '' }) currency: string;
  @Prop({ default: '' }) timezone: string;
  @Prop({ default: false }) isManager: boolean;
  /** Google: the manager (MCC) id to send as login-customer-id for this account. */
  @Prop({ default: '' }) loginCustomerId: string;
}
const AvailableAccountSchema = SchemaFactory.createForClass(AvailableAccount);

/** One OAuth grant (a Google or Facebook login) inside a workspace. */
@Schema({ timestamps: true, collection: 'platform_connections' })
export class PlatformConnection {
  @Prop({ type: Types.ObjectId, ref: 'Workspace', required: true, index: true }) workspaceId: Types.ObjectId;
  @Prop({ enum: PLATFORMS, required: true }) platform: Platform;
  @Prop({ default: '' }) externalUserId: string;
  @Prop({ default: '' }) externalUserName: string;
  @Prop({ default: '' }) externalUserEmail: string;
  @Prop({ select: false, default: '' }) accessTokenEnc: string;
  @Prop({ select: false, default: '' }) refreshTokenEnc: string;
  @Prop({ type: Date, default: null }) accessTokenExpiresAt: Date | null;
  @Prop({ type: [String], default: [] }) scopes: string[];
  @Prop({ enum: ['active', 'error', 'revoked'], default: 'active' }) status: 'active' | 'error' | 'revoked';
  @Prop({ type: String, default: null }) lastError: string | null;
  @Prop({ type: [AvailableAccountSchema], default: [] }) availableAccounts: AvailableAccount[];
  @Prop({ type: Types.ObjectId, ref: 'User' }) connectedBy: Types.ObjectId;
  createdAt: Date;
}
export type PlatformConnectionDoc = HydratedDocument<PlatformConnection>;
export const PlatformConnectionSchema = SchemaFactory.createForClass(PlatformConnection);
PlatformConnectionSchema.index({ workspaceId: 1, platform: 1, externalUserId: 1 });

/** A Google Ads customer or Meta ad account that we pull live data from. */
@Schema({ timestamps: true, collection: 'ad_accounts' })
export class AdAccount {
  @Prop({ type: Types.ObjectId, ref: 'Workspace', required: true }) workspaceId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'PlatformConnection', required: true, index: true }) connectionId: Types.ObjectId;
  @Prop({ enum: PLATFORMS, required: true }) platform: Platform;
  /** Google: customer id (digits). Meta: ad account id without "act_". */
  @Prop({ required: true }) externalId: string;
  @Prop({ default: '' }) name: string;
  @Prop({ default: '' }) currency: string;
  @Prop({ default: '' }) timezone: string;
  @Prop({ default: '' }) loginCustomerId: string;
  @Prop({ enum: ['active', 'error', 'disconnected'], default: 'active' }) status: 'active' | 'error' | 'disconnected';
  @Prop({ default: true }) syncEnabled: boolean;
  @Prop({ default: true }) conversionsEnabled: boolean;
  @Prop({ default: '' }) metaPixelId: string;
  @Prop({ default: '' }) googleConversionActionId: string;
  @Prop({ type: Date, default: null }) lastSyncedAt: Date | null;
  @Prop({ type: String, enum: ['success', 'failed', 'running', null], default: null })
  lastSyncStatus: 'success' | 'failed' | 'running' | null;
  @Prop({ type: String, default: null }) lastSyncError: string | null;
  @Prop({ default: false }) backfilled: boolean;
}
export type AdAccountDoc = HydratedDocument<AdAccount>;
export const AdAccountSchema = SchemaFactory.createForClass(AdAccount);
AdAccountSchema.index({ workspaceId: 1, platform: 1, externalId: 1 }, { unique: true });

@Schema({ _id: false })
export class SyncStats {
  @Prop({ default: 0 }) campaigns: number;
  @Prop({ default: 0 }) adGroups: number;
  @Prop({ default: 0 }) ads: number;
  @Prop({ default: 0 }) metricRows: number;
}
const SyncStatsSchema = SchemaFactory.createForClass(SyncStats);

@Schema({ collection: 'sync_runs' })
export class SyncRun {
  @Prop({ type: Types.ObjectId, ref: 'Workspace', required: true }) workspaceId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'AdAccount', required: true }) adAccountId: Types.ObjectId;
  @Prop({ enum: PLATFORMS, required: true }) platform: Platform;
  @Prop({ enum: ['schedule', 'manual', 'initial'], required: true }) trigger: 'schedule' | 'manual' | 'initial';
  @Prop({ enum: ['running', 'success', 'failed'], default: 'running' }) status: 'running' | 'success' | 'failed';
  @Prop({ default: () => new Date() }) startedAt: Date;
  @Prop({ type: Date, default: null }) finishedAt: Date | null;
  @Prop({ required: true }) dateFrom: string;
  @Prop({ required: true }) dateTo: string;
  @Prop({ type: SyncStatsSchema, default: () => ({}) }) stats: SyncStats;
  @Prop({ type: String, default: null }) error: string | null;
}
export type SyncRunDoc = HydratedDocument<SyncRun>;
export const SyncRunSchema = SchemaFactory.createForClass(SyncRun);
SyncRunSchema.index({ workspaceId: 1, startedAt: -1 });
// Keep 90 days of sync history.
SyncRunSchema.index({ startedAt: 1 }, { expireAfterSeconds: 90 * 86_400 });
