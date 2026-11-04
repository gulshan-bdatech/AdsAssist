import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { PLATFORMS, type Platform } from './integration.schema.js';
import type { Channel } from './tracking.schema.js';

const ws = { type: Types.ObjectId, ref: 'Workspace', required: true, index: true };

// ── Audiences ───────────────────────────────────────────────────────────────

export type AudienceType = 'leads' | 'contacts' | 'upload';

@Schema({ _id: false })
export class AudienceRules {
  @Prop({ type: [String], default: undefined }) stages?: string[];
  @Prop({ type: [String], default: undefined }) excludeStages?: string[];
  @Prop({ type: [String], default: undefined }) channels?: Channel[];
  @Prop({ type: [String], default: undefined }) campaignIds?: string[];
  @Prop() createdWithinDays?: number;
  @Prop() minIntentScore?: number;
  @Prop({ type: [String], default: undefined }) contactStatus?: ('known' | 'cross_device')[];
  @Prop({ type: [String], default: undefined }) eventTypes?: string[];
}
const AudienceRulesSchema = SchemaFactory.createForClass(AudienceRules);

@Schema({ _id: false })
export class AudienceDestination {
  @Prop({ type: Types.ObjectId, ref: 'AdAccount', required: true }) adAccountId: Types.ObjectId;
  @Prop({ enum: PLATFORMS, required: true }) platform: Platform;
  @Prop({ type: String, default: null }) externalAudienceId: string | null;
  @Prop({ enum: ['pending', 'syncing', 'synced', 'failed'], default: 'pending' }) status: 'pending' | 'syncing' | 'synced' | 'failed';
  @Prop({ type: Date, default: null }) lastSyncedAt: Date | null;
  @Prop({ default: 0 }) uploadedCount: number;
  @Prop({ type: Number, default: null }) matchedCount: number | null;
  @Prop({ type: String, default: null }) error: string | null;
}
const AudienceDestinationSchema = SchemaFactory.createForClass(AudienceDestination);

@Schema({ timestamps: true, collection: 'audiences' })
export class Audience {
  @Prop(ws) workspaceId: Types.ObjectId;
  @Prop({ required: true, trim: true }) name: string;
  @Prop({ default: '' }) description: string;
  @Prop({ enum: ['leads', 'contacts', 'upload'], required: true }) type: AudienceType;
  @Prop({ type: AudienceRulesSchema, default: () => ({}) }) rules: AudienceRules;
  @Prop({ default: false }) autoSync: boolean;
  @Prop({ required: true }) consentConfirmedAt: Date;
  @Prop({ type: Types.ObjectId, ref: 'User' }) consentConfirmedBy: Types.ObjectId;
  @Prop({ default: 0 }) size: number;
  @Prop({ default: 0 }) emailCount: number;
  @Prop({ default: 0 }) phoneCount: number;
  @Prop({ type: Date, default: null }) lastComputedAt: Date | null;
  @Prop({ type: [AudienceDestinationSchema], default: [] }) destinations: AudienceDestination[];
  createdAt: Date;
}
export type AudienceDoc = HydratedDocument<Audience>;
export const AudienceSchema = SchemaFactory.createForClass(Audience);

/** Uploaded list members (type "upload"). Only hashes are kept, plus a masked hint for previews. */
@Schema({ collection: 'audience_members' })
export class AudienceMember {
  @Prop({ type: Types.ObjectId, ref: 'Audience', required: true }) audienceId: Types.ObjectId;
  @Prop({ required: true }) key: string;
  @Prop({ type: String, default: null }) emailHash: string | null;
  /** E.164 digits hashed (Meta form); Google's "+digits" hash is derived at upload. */
  @Prop({ type: String, default: null }) phoneHash: string | null;
  @Prop({ type: String, default: null }) googlePhoneHash: string | null;
  @Prop({ type: String, default: null }) firstNameHash: string | null;
  @Prop({ type: String, default: null }) lastNameHash: string | null;
  @Prop({ default: '' }) hint: string;
}
export type AudienceMemberDoc = HydratedDocument<AudienceMember>;
export const AudienceMemberSchema = SchemaFactory.createForClass(AudienceMember);
AudienceMemberSchema.index({ audienceId: 1, key: 1 }, { unique: true });

// ── Webhooks ────────────────────────────────────────────────────────────────

export const WEBHOOK_EVENTS = [
  'lead.created',
  'lead.stage_changed',
  'lead.won',
  'contact.identified',
  'form.submitted',
  'form.abandoned',
  'conversion.sent',
  'conversion.failed',
  'alert.triggered',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

@Schema({ timestamps: true, collection: 'webhooks' })
export class Webhook {
  @Prop(ws) workspaceId: Types.ObjectId;
  @Prop({ required: true, trim: true }) name: string;
  @Prop({ required: true }) url: string;
  @Prop({ type: [String], default: [] }) events: WebhookEvent[];
  @Prop({ default: true }) active: boolean;
  /** Encrypted with TOKEN_ENCRYPTION_KEY: the raw secret is needed to sign each request. */
  @Prop({ required: true, select: false }) secretEnc: string;
  @Prop({ required: true }) secretPrefix: string;
  @Prop({ type: Date, default: null }) lastDeliveryAt: Date | null;
  @Prop({ type: String, default: null }) lastStatus: 'sent' | 'failed' | null;
  @Prop({ default: 0 }) failureCount: number;
  createdAt: Date;
}
export type WebhookDoc = HydratedDocument<Webhook>;
export const WebhookSchema = SchemaFactory.createForClass(Webhook);

@Schema({ collection: 'webhook_deliveries' })
export class WebhookDelivery {
  @Prop(ws) workspaceId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'Webhook', required: true }) webhookId: Types.ObjectId;
  @Prop({ required: true }) event: string;
  @Prop({ enum: ['pending', 'sent', 'failed'], default: 'pending' }) status: 'pending' | 'sent' | 'failed';
  @Prop({ default: 0 }) attempts: number;
  @Prop({ type: Number, default: null }) responseStatus: number | null;
  @Prop({ type: String, default: null }) responseBody: string | null;
  @Prop({ type: String, default: null }) error: string | null;
  @Prop({ type: Number, default: null }) durationMs: number | null;
  @Prop({ type: Object, required: true }) payload: Record<string, unknown>;
  @Prop({ default: () => new Date() }) createdAt: Date;
}
export type WebhookDeliveryDoc = HydratedDocument<WebhookDelivery>;
export const WebhookDeliverySchema = SchemaFactory.createForClass(WebhookDelivery);
WebhookDeliverySchema.index({ webhookId: 1, createdAt: -1 });
WebhookDeliverySchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 86_400 });

// ── Alerts, notifications, digests ──────────────────────────────────────────

export const ALERT_METRICS = ['spend', 'leads', 'won_leads', 'cpl', 'cpc', 'ctr', 'conversions', 'roas'] as const;
export type AlertMetric = (typeof ALERT_METRICS)[number];
export type AlertWindow = 'today' | 'yesterday' | 'last_7_days';

@Schema({ timestamps: true, collection: 'alert_rules' })
export class AlertRule {
  @Prop(ws) workspaceId: Types.ObjectId;
  @Prop({ required: true, trim: true }) name: string;
  @Prop({ enum: ALERT_METRICS, required: true }) metric: AlertMetric;
  @Prop({ enum: ['gt', 'lt'], required: true }) operator: 'gt' | 'lt';
  @Prop({ required: true }) threshold: number;
  @Prop({ enum: ['today', 'yesterday', 'last_7_days'], default: 'today' }) window: AlertWindow;
  @Prop({ type: String, enum: [...PLATFORMS, null], default: null }) platform: Platform | null;
  @Prop({ type: Types.ObjectId, ref: 'Campaign', default: null }) campaignId: Types.ObjectId | null;
  @Prop({ type: [String], default: [] }) recipients: string[];
  @Prop({ default: true }) notifyInApp: boolean;
  @Prop({ default: true }) active: boolean;
  @Prop({ default: 24 }) cooldownHours: number;
  @Prop({ type: Date, default: null }) lastTriggeredAt: Date | null;
  @Prop({ type: Number, default: null }) lastValue: number | null;
  createdAt: Date;
}
export type AlertRuleDoc = HydratedDocument<AlertRule>;
export const AlertRuleSchema = SchemaFactory.createForClass(AlertRule);

export type NotificationKind = 'alert' | 'sync_error' | 'conversion_failed' | 'ai_summary' | 'system';
export type Severity = 'critical' | 'warning' | 'info' | 'success';

@Schema({ collection: 'notifications' })
export class Notification {
  @Prop(ws) workspaceId: Types.ObjectId;
  @Prop({ required: true }) kind: NotificationKind;
  @Prop({ required: true }) severity: Severity;
  @Prop({ required: true }) title: string;
  @Prop({ default: '' }) body: string;
  @Prop({ type: String, default: null }) link: string | null;
  /** Same-key notifications within a day are collapsed (e.g. a failing sync every 15 minutes). */
  @Prop({ type: String, default: null }) dedupeKey: string | null;
  @Prop({ default: false }) read: boolean;
  @Prop({ default: () => new Date() }) createdAt: Date;
}
export type NotificationDoc = HydratedDocument<Notification>;
export const NotificationSchema = SchemaFactory.createForClass(Notification);
NotificationSchema.index({ workspaceId: 1, createdAt: -1 });
NotificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 86_400 });

@Schema({ timestamps: true, collection: 'report_settings' })
export class ReportSettings {
  @Prop({ type: Types.ObjectId, ref: 'Workspace', required: true, unique: true }) workspaceId: Types.ObjectId;
  @Prop({ default: false }) weeklyDigest: boolean;
  @Prop({ type: [String], default: [] }) digestRecipients: string[];
  @Prop({ default: 1 }) digestDay: number;
  @Prop({ default: true }) aiInDigest: boolean;
  @Prop({ type: Date, default: null }) lastDigestAt: Date | null;
}
export type ReportSettingsDoc = HydratedDocument<ReportSettings>;
export const ReportSettingsSchema = SchemaFactory.createForClass(ReportSettings);

// ── AI summaries ────────────────────────────────────────────────────────────

@Schema({ _id: false })
export class AiAction {
  @Prop({ required: true }) title: string;
  @Prop({ default: '' }) detail: string;
  @Prop({ type: String, default: null }) campaignId: string | null;
  @Prop({ enum: ['high', 'medium', 'low'], default: 'medium' }) priority: 'high' | 'medium' | 'low';
}
const AiActionSchema = SchemaFactory.createForClass(AiAction);

@Schema({ collection: 'ai_summaries' })
export class AiSummary {
  @Prop(ws) workspaceId: Types.ObjectId;
  @Prop({ required: true }) from: string;
  @Prop({ required: true }) to: string;
  @Prop({ required: true }) markdown: string;
  @Prop({ type: [String], default: [] }) highlights: string[];
  @Prop({ type: [AiActionSchema], default: [] }) actions: AiAction[];
  @Prop({ required: true }) model: string;
  @Prop({ type: Types.ObjectId, ref: 'User', default: null }) createdBy: Types.ObjectId | null;
  @Prop({ default: () => new Date() }) createdAt: Date;
}
export type AiSummaryDoc = HydratedDocument<AiSummary>;
export const AiSummarySchema = SchemaFactory.createForClass(AiSummary);
AiSummarySchema.index({ workspaceId: 1, createdAt: -1 });

// ── Email tracking ──────────────────────────────────────────────────────────

@Schema({ timestamps: true, collection: 'email_messages' })
export class EmailMessage {
  @Prop(ws) workspaceId: Types.ObjectId;
  @Prop({ required: true }) messageId: string;
  @Prop({ required: true }) to: string;
  @Prop({ required: true }) toHash: string;
  @Prop({ default: '' }) subject: string;
  @Prop({ default: '' }) campaign: string;
  @Prop({ type: [String], default: [] }) links: string[];
  @Prop({ type: Types.ObjectId, ref: 'Contact', default: null }) contactId: Types.ObjectId | null;
  @Prop({ default: 0 }) opens: number;
  @Prop({ default: 0 }) clicks: number;
  @Prop({ type: Date, default: null }) firstOpenedAt: Date | null;
  @Prop({ type: Date, default: null }) lastClickedAt: Date | null;
  createdAt: Date;
}
export type EmailMessageDoc = HydratedDocument<EmailMessage>;
export const EmailMessageSchema = SchemaFactory.createForClass(EmailMessage);
EmailMessageSchema.index({ workspaceId: 1, messageId: 1 }, { unique: true });
EmailMessageSchema.index({ workspaceId: 1, createdAt: -1 });

// ── Meta Lead Ads ───────────────────────────────────────────────────────────

@Schema({ timestamps: true, collection: 'lead_form_subscriptions' })
export class LeadFormSubscription {
  @Prop(ws) workspaceId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'PlatformConnection', required: true }) connectionId: Types.ObjectId;
  @Prop({ required: true }) pageId: string;
  @Prop({ default: '' }) pageName: string;
  @Prop({ required: true }) formId: string;
  @Prop({ default: '' }) formName: string;
  @Prop({ default: true }) enabled: boolean;
  @Prop({ type: Date, default: null }) lastImportedAt: Date | null;
  /** Newest lead time seen; next poll asks Meta only for leads after it. */
  @Prop({ type: Date, default: null }) cursorTime: Date | null;
  @Prop({ default: 0 }) importedCount: number;
  @Prop({ type: String, default: null }) lastError: string | null;
}
export type LeadFormSubscriptionDoc = HydratedDocument<LeadFormSubscription>;
export const LeadFormSubscriptionSchema = SchemaFactory.createForClass(LeadFormSubscription);
LeadFormSubscriptionSchema.index({ workspaceId: 1, formId: 1 }, { unique: true });

// ── Competitors (Meta Ad Library) ───────────────────────────────────────────

@Schema({ timestamps: true, collection: 'competitor_watches' })
export class CompetitorWatch {
  @Prop(ws) workspaceId: Types.ObjectId;
  @Prop({ required: true, trim: true }) name: string;
  @Prop({ type: [String], default: [] }) pageIds: string[];
  @Prop({ default: '' }) searchTerms: string;
  @Prop({ type: [String], default: [] }) countries: string[];
  @Prop({ type: Date, default: null }) lastFetchedAt: Date | null;
  @Prop({ type: String, default: null }) lastError: string | null;
  createdAt: Date;
}
export type CompetitorWatchDoc = HydratedDocument<CompetitorWatch>;
export const CompetitorWatchSchema = SchemaFactory.createForClass(CompetitorWatch);

@Schema({ collection: 'competitor_ads' })
export class CompetitorAd {
  @Prop(ws) workspaceId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'CompetitorWatch', required: true }) watchId: Types.ObjectId;
  @Prop({ required: true }) adArchiveId: string;
  @Prop({ default: '' }) pageId: string;
  @Prop({ default: '' }) pageName: string;
  @Prop({ type: [String], default: [] }) bodies: string[];
  @Prop({ type: [String], default: [] }) titles: string[];
  @Prop({ type: [String], default: [] }) descriptions: string[];
  @Prop({ default: '' }) snapshotUrl: string;
  @Prop({ type: [String], default: [] }) platforms: string[];
  @Prop({ type: String, default: null }) startedAt: string | null;
  @Prop({ type: String, default: null }) stoppedAt: string | null;
  @Prop({ default: true }) active: boolean;
  @Prop({ default: () => new Date() }) firstSeenAt: Date;
}
export type CompetitorAdDoc = HydratedDocument<CompetitorAd>;
export const CompetitorAdSchema = SchemaFactory.createForClass(CompetitorAd);
CompetitorAdSchema.index({ watchId: 1, adArchiveId: 1 }, { unique: true });
CompetitorAdSchema.index({ watchId: 1, active: 1, startedAt: -1 });
