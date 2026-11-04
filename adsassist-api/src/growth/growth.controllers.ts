import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import type { Request, Response } from 'express';
import { CurrentUser, MinRole, Public, Ws, type AuthUser, type WorkspaceContext } from '../common/auth/decorators.js';
import { WorkspaceGuard } from '../common/auth/guards.js';
import { PageQuery, RangeQuery } from '../common/dto.js';
import { MailerService } from '../common/mailer/mailer.module.js';
import { resolveRange } from '../common/utils/dates.js';
import { ALERT_METRICS, WEBHOOK_EVENTS, type AlertMetric, type AudienceType, type WebhookEvent } from '../database/schemas/growth.schema.js';
import { ApiKeyGuard } from '../leads/leads.module.js';
import { AiService } from './ai.service.js';
import { AlertsService } from './alerts.service.js';
import { AudiencesService } from './audiences.service.js';
import { CompetitorsService } from './competitors.service.js';
import { DigestService } from './digest.service.js';
import { EmailTrackingService, PIXEL_GIF } from './email-tracking.service.js';
import { LeadFormsService } from './lead-forms.service.js';
import { NotificationsService } from './notifications.service.js';
import { WebhooksService } from './webhooks.service.js';

const CHANNELS = ['google', 'meta', 'organic', 'other'] as const;
const CONTACT_EVENTS = ['form_start', 'form_abandon', 'form_submit', 'conversion', 'email_open', 'email_click'] as const;
const clientMeta = (req: Request) => ({
  ip: (req.ip ?? '').replace(/^::ffff:/, ''),
  userAgent: String(req.headers['user-agent'] ?? ''),
});

// ── DTOs ────────────────────────────────────────────────────────────────────

class RulesDto {
  @IsOptional() @IsArray() @IsString({ each: true }) stages?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) excludeStages?: string[];
  @IsOptional() @IsArray() @IsIn(CHANNELS, { each: true }) channels?: (typeof CHANNELS)[number][];
  @IsOptional() @IsArray() @IsMongoId({ each: true }) campaignIds?: string[];
  @IsOptional() @IsInt() @Min(1) @Max(540) createdWithinDays?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) minIntentScore?: number;
  @IsOptional() @IsArray() @IsIn(['known', 'cross_device'], { each: true }) contactStatus?: ('known' | 'cross_device')[];
  @IsOptional() @IsArray() @IsIn(CONTACT_EVENTS, { each: true }) eventTypes?: string[];
}

class PreviewDto {
  @IsIn(['leads', 'contacts', 'upload']) type: AudienceType;
  @IsOptional() @ValidateNested() @Type(() => RulesDto) rules: RulesDto = {};
}

class CreateAudienceDto extends PreviewDto {
  @IsString() @MinLength(1) @MaxLength(100) name: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsBoolean() autoSync?: boolean;
  /** Must be true: the user confirms these people agreed to marketing use. */
  @IsIn([true], { message: 'consentConfirmed must be true' }) consentConfirmed: true;
}

class UpdateAudienceDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) name?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @ValidateNested() @Type(() => RulesDto) rules?: RulesDto;
  @IsOptional() @IsBoolean() autoSync?: boolean;
}

class UploadRowDto {
  @IsOptional() @IsString() @MaxLength(320) email?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @MaxLength(100) firstName?: string;
  @IsOptional() @IsString() @MaxLength(100) lastName?: string;
}

class UploadDto {
  @IsIn(['append', 'replace']) mode: 'append' | 'replace';
  @IsArray() @ArrayMaxSize(50_000) @ValidateNested({ each: true }) @Type(() => UploadRowDto) rows: UploadRowDto[];
}

class DestinationsDto {
  @IsArray() @ArrayMinSize(1) @IsMongoId({ each: true }) adAccountIds: string[];
}

class LookalikeDto {
  @IsMongoId() adAccountId: string;
  @Matches(/^[A-Za-z]{2}$/) country: string;
  @IsNumber() @Min(0.01) @Max(0.1) ratio: number;
}

class WebhookDto {
  @IsString() @MinLength(1) @MaxLength(100) name: string;
  @IsUrl({ require_tld: false, require_protocol: true, protocols: ['http', 'https'] }) url: string;
  @IsArray() @ArrayMinSize(1) @IsIn(WEBHOOK_EVENTS, { each: true }) events: WebhookEvent[];
}

class UpdateWebhookDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) name?: string;
  @IsOptional() @IsUrl({ require_tld: false, require_protocol: true, protocols: ['http', 'https'] }) url?: string;
  @IsOptional() @IsArray() @ArrayMinSize(1) @IsIn(WEBHOOK_EVENTS, { each: true }) events?: WebhookEvent[];
  @IsOptional() @IsBoolean() active?: boolean;
}

class AlertDto {
  @IsString() @MinLength(1) @MaxLength(100) name: string;
  @IsIn(ALERT_METRICS) metric: AlertMetric;
  @IsIn(['gt', 'lt']) operator: 'gt' | 'lt';
  @IsNumber() threshold: number;
  @IsIn(['today', 'yesterday', 'last_7_days']) window: 'today' | 'yesterday' | 'last_7_days';
  @IsOptional() @IsIn(['google', 'meta', null]) platform?: 'google' | 'meta' | null;
  @IsOptional() @IsMongoId() campaignId?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsEmail({}, { each: true }) recipients?: string[];
  @IsOptional() @IsBoolean() notifyInApp?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(720) cooldownHours?: number;
}

class UpdateAlertDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) name?: string;
  @IsOptional() @IsIn(ALERT_METRICS) metric?: AlertMetric;
  @IsOptional() @IsIn(['gt', 'lt']) operator?: 'gt' | 'lt';
  @IsOptional() @IsNumber() threshold?: number;
  @IsOptional() @IsIn(['today', 'yesterday', 'last_7_days']) window?: 'today' | 'yesterday' | 'last_7_days';
  @IsOptional() @IsIn(['google', 'meta', null]) platform?: 'google' | 'meta' | null;
  @IsOptional() @IsMongoId() campaignId?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsEmail({}, { each: true }) recipients?: string[];
  @IsOptional() @IsBoolean() notifyInApp?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(720) cooldownHours?: number;
}

class NotificationsQuery extends PageQuery {
  @IsOptional() @IsIn(['true', 'false']) unread?: string;
}

class MarkReadDto {
  @IsOptional() @IsArray() @IsMongoId({ each: true }) ids?: string[];
}

class ReportSettingsDto {
  @IsBoolean() weeklyDigest: boolean;
  @IsArray() @ArrayMaxSize(20) @IsEmail({}, { each: true }) digestRecipients: string[];
  @IsInt() @Min(0) @Max(6) digestDay: number;
  @IsBoolean() aiInDigest: boolean;
}

class EmailListQuery extends PageQuery {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsString() campaign?: string;
}

class RegisterEmailDto {
  @IsEmail() to: string;
  @IsOptional() @IsString() @MaxLength(300) subject?: string;
  @IsOptional() @IsString() @MaxLength(120) campaign?: string;
  @IsOptional() @IsString() @Length(1, 120) messageId?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) links?: string[];
}

class FormSelectionDto {
  @IsMongoId() connectionId: string;
  @IsString() pageId: string;
  @IsString() @MaxLength(200) pageName: string;
  @IsString() formId: string;
  @IsString() @MaxLength(200) formName: string;
  @IsBoolean() enabled: boolean;
}

class SaveFormsDto {
  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => FormSelectionDto) forms: FormSelectionDto[];
}

class CompetitorDto {
  @IsString() @MinLength(1) @MaxLength(100) name: string;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) pageIds?: string[];
  @IsOptional() @IsString() @MaxLength(100) searchTerms?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @Matches(/^[A-Za-z]{2}$/, { each: true }) countries: string[];
}

class CompetitorAdsQuery extends PageQuery {
  @IsOptional() @IsIn(['true', 'false']) active?: string;
}

// ── Controllers ─────────────────────────────────────────────────────────────

@Controller('system')
export class SystemController {
  constructor(
    private readonly mailer: MailerService,
    private readonly ai: AiService,
  ) {}

  @Get('capabilities')
  capabilities() {
    return { email: this.mailer.configured, ai: this.ai.configured, aiModel: this.ai.configured ? this.ai.model : null };
  }
}

@Controller('workspaces/:wid')
@UseGuards(WorkspaceGuard)
export class GrowthController {
  constructor(
    private readonly audiences: AudiencesService,
    private readonly webhooks: WebhooksService,
    private readonly alerts: AlertsService,
    private readonly notifications: NotificationsService,
    private readonly digests: DigestService,
    private readonly ai: AiService,
    private readonly email: EmailTrackingService,
    private readonly forms: LeadFormsService,
    private readonly competitors: CompetitorsService,
  ) {}

  // Audiences
  @Get('audiences')
  listAudiences(@Ws() ws: WorkspaceContext) {
    return this.audiences.list(ws.id);
  }

  @Post('audiences/preview')
  preview(@Ws() ws: WorkspaceContext, @Body() dto: PreviewDto) {
    return this.audiences.preview(ws.id, dto.type, dto.rules);
  }

  @Post('audiences')
  @MinRole('admin')
  createAudience(@Ws() ws: WorkspaceContext, @CurrentUser() u: AuthUser, @Body() dto: CreateAudienceDto) {
    return this.audiences.create(ws.id, u.id, dto);
  }

  @Get('audiences/:id')
  audience(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    return this.audiences.detail(ws.id, id);
  }

  @Patch('audiences/:id')
  @MinRole('admin')
  updateAudience(@Ws() ws: WorkspaceContext, @Param('id') id: string, @Body() dto: UpdateAudienceDto) {
    return this.audiences.update(ws.id, id, dto);
  }

  @Delete('audiences/:id')
  @MinRole('admin')
  deleteAudience(@Ws() ws: WorkspaceContext, @Param('id') id: string, @Query('removeFromPlatforms') remove?: string) {
    return this.audiences.remove(ws.id, id, remove === 'true');
  }

  @Post('audiences/:id/upload')
  @MinRole('admin')
  upload(@Ws() ws: WorkspaceContext, @Param('id') id: string, @Body() dto: UploadDto) {
    return this.audiences.upload(ws.workspace, id, dto.mode, dto.rows);
  }

  @Post('audiences/:id/destinations')
  @MinRole('admin')
  addDestinations(@Ws() ws: WorkspaceContext, @Param('id') id: string, @Body() dto: DestinationsDto) {
    return this.audiences.addDestinations(ws.id, id, dto.adAccountIds);
  }

  @Delete('audiences/:id/destinations/:adAccountId')
  @MinRole('admin')
  removeDestination(@Ws() ws: WorkspaceContext, @Param('id') id: string, @Param('adAccountId') adAccountId: string) {
    return this.audiences.removeDestination(ws.id, id, adAccountId);
  }

  @Post('audiences/:id/sync')
  @MinRole('analyst')
  syncAudience(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    return this.audiences.syncNow(ws.id, id);
  }

  @Post('audiences/:id/lookalike')
  @MinRole('admin')
  lookalike(@Ws() ws: WorkspaceContext, @Param('id') id: string, @Body() dto: LookalikeDto) {
    return this.audiences.lookalike(ws.id, id, dto.adAccountId, dto.country, dto.ratio);
  }

  // Webhooks
  @Get('webhooks')
  @MinRole('admin')
  listWebhooks(@Ws() ws: WorkspaceContext) {
    return this.webhooks.list(ws.id);
  }

  @Post('webhooks')
  @MinRole('admin')
  createWebhook(@Ws() ws: WorkspaceContext, @Body() dto: WebhookDto) {
    return this.webhooks.create(ws.id, dto);
  }

  @Patch('webhooks/:id')
  @MinRole('admin')
  updateWebhook(@Ws() ws: WorkspaceContext, @Param('id') id: string, @Body() dto: UpdateWebhookDto) {
    return this.webhooks.update(ws.id, id, dto);
  }

  @Delete('webhooks/:id')
  @MinRole('admin')
  deleteWebhook(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    return this.webhooks.remove(ws.id, id);
  }

  @Post('webhooks/:id/rotate-secret')
  @MinRole('admin')
  rotate(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    return this.webhooks.rotate(ws.id, id);
  }

  @Post('webhooks/:id/test')
  @MinRole('admin')
  testWebhook(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    return this.webhooks.test(ws.id, id);
  }

  @Get('webhooks/:id/deliveries')
  @MinRole('admin')
  deliveries(@Ws() ws: WorkspaceContext, @Param('id') id: string, @Query() q: PageQuery) {
    return this.webhooks.listDeliveries(ws.id, id, q.page, q.pageSize);
  }

  @Post('webhooks/deliveries/:deliveryId/redeliver')
  @MinRole('admin')
  redeliver(@Ws() ws: WorkspaceContext, @Param('deliveryId') deliveryId: string) {
    return this.webhooks.redeliver(ws.id, deliveryId);
  }

  // Alerts & notifications
  @Get('alerts')
  listAlerts(@Ws() ws: WorkspaceContext) {
    return this.alerts.list(ws.id);
  }

  @Post('alerts')
  @MinRole('analyst')
  createAlert(@Ws() ws: WorkspaceContext, @Body() dto: AlertDto) {
    return this.alerts.create(ws.id, dto);
  }

  @Patch('alerts/:id')
  @MinRole('analyst')
  updateAlert(@Ws() ws: WorkspaceContext, @Param('id') id: string, @Body() dto: UpdateAlertDto) {
    return this.alerts.update(ws.id, id, dto);
  }

  @Delete('alerts/:id')
  @MinRole('analyst')
  deleteAlert(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    return this.alerts.remove(ws.id, id);
  }

  @Post('alerts/:id/test')
  testAlert(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    return this.alerts.test(ws.workspace, id);
  }

  @Get('notifications')
  @SkipThrottle()
  listNotifications(@Ws() ws: WorkspaceContext, @Query() q: NotificationsQuery) {
    return this.notifications.list(ws.id, { unread: q.unread === 'true', page: q.page, pageSize: q.pageSize });
  }

  @Post('notifications/read')
  markRead(@Ws() ws: WorkspaceContext, @Body() dto: MarkReadDto) {
    return this.notifications.markRead(ws.id, dto.ids);
  }

  @Get('report-settings')
  reportSettings(@Ws() ws: WorkspaceContext) {
    return this.digests.get(ws.id);
  }

  @Put('report-settings')
  @MinRole('admin')
  saveReportSettings(@Ws() ws: WorkspaceContext, @Body() dto: ReportSettingsDto) {
    return this.digests.put(ws.id, dto);
  }

  // AI
  @Post('ai/summary')
  @MinRole('analyst')
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  summary(@Ws() ws: WorkspaceContext, @CurrentUser() u: AuthUser, @Body() dto: RangeQuery) {
    const range = dto.from || dto.to ? resolveRange(dto.from, dto.to, ws.workspace.timezone) : this.ai.defaultRange(ws.workspace);
    return this.ai.generate(ws.workspace, range, u.id);
  }

  @Get('ai/summaries')
  summaries(@Ws() ws: WorkspaceContext) {
    return this.ai.list(ws.id);
  }

  // Email tracking
  @Get('email/messages')
  emailMessages(@Ws() ws: WorkspaceContext, @Query() q: EmailListQuery) {
    return this.email.list(ws.id, q);
  }

  @Get('email/stats')
  emailStats(@Ws() ws: WorkspaceContext, @Query() q: RangeQuery) {
    return this.email.stats(ws.workspace, resolveRange(q.from, q.to, ws.workspace.timezone));
  }

  // Meta Lead Ads
  @Get('lead-forms/available')
  @MinRole('admin')
  availableForms(@Ws() ws: WorkspaceContext) {
    return this.forms.available(ws.id);
  }

  @Get('lead-forms')
  listForms(@Ws() ws: WorkspaceContext) {
    return this.forms.list(ws.id);
  }

  @Put('lead-forms')
  @MinRole('admin')
  saveForms(@Ws() ws: WorkspaceContext, @Body() dto: SaveFormsDto) {
    return this.forms.save(ws.id, dto.forms);
  }

  @Post('lead-forms/:id/import')
  @MinRole('analyst')
  importForm(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    return this.forms.importNow(ws.id, id);
  }

  // Competitors
  @Get('competitors')
  listCompetitors(@Ws() ws: WorkspaceContext) {
    return this.competitors.list(ws.id);
  }

  @Post('competitors')
  @MinRole('analyst')
  createCompetitor(@Ws() ws: WorkspaceContext, @Body() dto: CompetitorDto) {
    return this.competitors.create(ws.id, dto);
  }

  @Delete('competitors/:id')
  @MinRole('analyst')
  deleteCompetitor(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    return this.competitors.remove(ws.id, id);
  }

  @Post('competitors/:id/refresh')
  @MinRole('analyst')
  refreshCompetitor(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    return this.competitors.refreshNow(ws.id, id);
  }

  @Get('competitors/:id/ads')
  competitorAds(@Ws() ws: WorkspaceContext, @Param('id') id: string, @Query() q: CompetitorAdsQuery) {
    return this.competitors.listAds(ws.id, id, { active: q.active === 'true', page: q.page, pageSize: q.pageSize });
  }
}

/** Email tracking endpoints: register (API key) and the public open/click hits. */
@Public()
@Controller('v1')
export class EmailTrackingController {
  constructor(private readonly email: EmailTrackingService) {}

  @Post('email/messages')
  @UseGuards(ApiKeyGuard)
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  register(@Ws() ws: WorkspaceContext, @Body() dto: RegisterEmailDto) {
    return this.email.register(ws.workspace, dto);
  }

  @Get('e/o/:token')
  @SkipThrottle()
  @Header('Content-Type', 'image/gif')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, private')
  async open(@Param('token') token: string, @Req() req: Request) {
    await this.email.open(token, clientMeta(req)).catch(() => undefined);
    return PIXEL_GIF;
  }

  @Get('e/c/:token')
  @SkipThrottle()
  async click(@Param('token') token: string, @Req() req: Request, @Res() res: Response) {
    const url = await this.email.click(token, clientMeta(req)).catch(() => null);
    if (!url) {
      res.status(404).send('Link not found');
      return;
    }
    res.redirect(302, url);
  }
}
