import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import mongoose from 'mongoose';
import { Ad, AdGroup, AdGroupSchema, AdSchema, Campaign, CampaignSchema, MetricDaily, MetricDailySchema } from './schemas/ads.schema.js';
import {
  AdAccount,
  AdAccountSchema,
  PlatformConnection,
  PlatformConnectionSchema,
  SyncRun,
  SyncRunSchema,
} from './schemas/integration.schema.js';
import {
  AiSummary,
  AiSummarySchema,
  AlertRule,
  AlertRuleSchema,
  Audience,
  AudienceMember,
  AudienceMemberSchema,
  AudienceSchema,
  CompetitorAd,
  CompetitorAdSchema,
  CompetitorWatch,
  CompetitorWatchSchema,
  EmailMessage,
  EmailMessageSchema,
  LeadFormSubscription,
  LeadFormSubscriptionSchema,
  Notification,
  NotificationSchema,
  ReportSettings,
  ReportSettingsSchema,
  Webhook,
  WebhookDelivery,
  WebhookDeliverySchema,
  WebhookSchema,
} from './schemas/growth.schema.js';
import { ConversionPush, ConversionPushSchema, Lead, LeadSchema } from './schemas/leads.schema.js';
import {
  ApiKey,
  ApiKeySchema,
  Contact,
  ContactSchema,
  Device,
  DeviceSchema,
  SiteKey,
  SiteKeySchema,
  TrackingEvent,
  TrackingEventSchema,
} from './schemas/tracking.schema.js';
import {
  Invite,
  InviteSchema,
  Membership,
  MembershipSchema,
  User,
  UserSchema,
  Workspace,
  WorkspaceSchema,
} from './schemas/workspace.schema.js';

// Every document serialises with `id` instead of `_id` and without `__v`.
mongoose.plugin((schema) => {
  schema.set('toJSON', {
    virtuals: true,
    versionKey: false,
    flattenMaps: true,
    transform: (_doc, ret: Record<string, unknown>) => {
      delete ret._id;
      return ret;
    },
  });
});

const models = MongooseModule.forFeature([
  { name: User.name, schema: UserSchema },
  { name: Workspace.name, schema: WorkspaceSchema },
  { name: Membership.name, schema: MembershipSchema },
  { name: Invite.name, schema: InviteSchema },
  { name: PlatformConnection.name, schema: PlatformConnectionSchema },
  { name: AdAccount.name, schema: AdAccountSchema },
  { name: SyncRun.name, schema: SyncRunSchema },
  { name: Campaign.name, schema: CampaignSchema },
  { name: AdGroup.name, schema: AdGroupSchema },
  { name: Ad.name, schema: AdSchema },
  { name: MetricDaily.name, schema: MetricDailySchema },
  { name: SiteKey.name, schema: SiteKeySchema },
  { name: ApiKey.name, schema: ApiKeySchema },
  { name: TrackingEvent.name, schema: TrackingEventSchema },
  { name: Contact.name, schema: ContactSchema },
  { name: Device.name, schema: DeviceSchema },
  { name: Lead.name, schema: LeadSchema },
  { name: ConversionPush.name, schema: ConversionPushSchema },
  { name: Audience.name, schema: AudienceSchema },
  { name: AudienceMember.name, schema: AudienceMemberSchema },
  { name: Webhook.name, schema: WebhookSchema },
  { name: WebhookDelivery.name, schema: WebhookDeliverySchema },
  { name: AlertRule.name, schema: AlertRuleSchema },
  { name: Notification.name, schema: NotificationSchema },
  { name: ReportSettings.name, schema: ReportSettingsSchema },
  { name: AiSummary.name, schema: AiSummarySchema },
  { name: EmailMessage.name, schema: EmailMessageSchema },
  { name: LeadFormSubscription.name, schema: LeadFormSubscriptionSchema },
  { name: CompetitorWatch.name, schema: CompetitorWatchSchema },
  { name: CompetitorAd.name, schema: CompetitorAdSchema },
]);

@Global()
@Module({
  imports: [
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGODB_URI'),
        autoIndex: true,
        serverSelectionTimeoutMS: 10_000,
      }),
    }),
    models,
  ],
  exports: [models],
})
export class DatabaseModule {}
