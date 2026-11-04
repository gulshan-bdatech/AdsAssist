import { BullModule, Processor, WorkerHost } from '@nestjs/bullmq';
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Logger,
  MessageEvent,
  Module,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { SkipThrottle } from '@nestjs/throttler';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Job } from 'bullmq';
import type { Request } from 'express';
import { Model } from 'mongoose';
import { Observable } from 'rxjs';
import { MinRole, Public, Ws, type WorkspaceContext } from '../common/auth/decorators.js';
import { WorkspaceGuard } from '../common/auth/guards.js';
import { PageQuery } from '../common/dto.js';
import { RedisService } from '../common/redis/redis.module.js';
import { EVENT_TYPES } from '../database/schemas/tracking.schema.js';
import { Workspace } from '../database/schemas/workspace.schema.js';
import { LeadsModule } from '../leads/leads.module.js';
import { LeadsService } from '../leads/leads.service.js';
import { IdentifyJob, PixelConversionJob, QUEUES } from '../queues.js';
import { IdentityService } from './identity.service.js';
import { PIXEL_SOURCE } from './pixel.source.js';
import { eventsChannel, TrackingService } from './tracking.service.js';

class SiteKeyDto {
  @IsString() @MinLength(1) @MaxLength(100) name: string;
  @IsOptional() @IsBoolean() requireConsent?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) allowedDomains?: string[];
}

class UpdateSiteKeyDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) name?: string;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsBoolean() createLeadOnSubmit?: boolean;
  @IsOptional() @IsBoolean() requireConsent?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) allowedDomains?: string[];
}

class ApiKeyDto {
  @IsString() @MinLength(1) @MaxLength(100) name: string;
}

class EventsQuery extends PageQuery {
  @IsOptional() @IsIn(EVENT_TYPES) type?: string;
  @IsOptional() @IsString() siteKeyId?: string;
  @IsOptional() @IsString() contactId?: string;
}

class ContactsQuery extends PageQuery {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsIn(['anonymous', 'known', 'cross_device']) status?: string;
}

/** Country from common CDN/proxy headers (Cloudflare, Vercel, CloudFront, Fastly). */
function countryFrom(req: Request): string {
  for (const h of ['cf-ipcountry', 'x-vercel-ip-country', 'cloudfront-viewer-country', 'fastly-geo-country-code', 'x-country-code']) {
    const v = String(req.headers[h] ?? '').trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(v) && v !== 'XX' && v !== 'T1') return v;
  }
  return '';
}

const clientIp = (req: Request) => (req.ip ?? req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');

/** Public endpoints hit by the browser pixel on customer sites. */
@Public()
@SkipThrottle()
@Controller()
export class PixelController {
  private readonly script: string;

  constructor(
    private readonly tracking: TrackingService,
    config: ConfigService,
  ) {
    this.script = PIXEL_SOURCE.replace('__API_ORIGIN__', config.getOrThrow<string>('API_URL').replace(/\/$/, ''));
  }

  @Get('pixel.js')
  @Header('Content-Type', 'application/javascript; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=300')
  @Header('Cross-Origin-Resource-Policy', 'cross-origin')
  async pixel(@Query('key') key = '') {
    // The key is embedded verbatim inside a JS string literal, so restrict it to the key alphabet.
    const safeKey = /^aa_[\w-]{1,64}$/.test(key) ? key : '';
    const site = safeKey ? await this.tracking.siteKey(safeKey) : null;
    return this.script
      .replace('__SITE_KEY__', safeKey)
      .replace('__REQUIRE_CONSENT__', site?.doc.requireConsent ? 'true' : 'false');
  }

  @Post('v1/events')
  @HttpCode(204)
  async ingest(@Query('key') key: string | undefined, @Req() req: Request, @Body() body: unknown) {
    await this.tracking.ingest(key ?? (req.headers['x-aa-key'] as string | undefined), body, {
      ip: clientIp(req),
      userAgent: String(req.headers['user-agent'] ?? ''),
      origin: (req.headers.origin as string | undefined) ?? (req.headers.referer as string | undefined) ?? null,
      country: countryFrom(req),
    });
  }
}

@Controller('workspaces/:wid')
@UseGuards(WorkspaceGuard)
export class TrackingController {
  constructor(
    private readonly tracking: TrackingService,
    private readonly leads: LeadsService,
    private readonly redis: RedisService,
  ) {}

  @Get('site-keys')
  siteKeys(@Ws() ws: WorkspaceContext) {
    return this.tracking.listSiteKeys(ws.id);
  }

  @Post('site-keys')
  @MinRole('admin')
  createSiteKey(@Ws() ws: WorkspaceContext, @Body() dto: SiteKeyDto) {
    return this.tracking.createSiteKey(ws.id, dto.name, dto.allowedDomains, dto.requireConsent);
  }

  @Patch('site-keys/:id')
  @MinRole('admin')
  updateSiteKey(@Ws() ws: WorkspaceContext, @Param('id') id: string, @Body() dto: UpdateSiteKeyDto) {
    return this.tracking.updateSiteKey(ws.id, id, dto);
  }

  @Delete('site-keys/:id')
  @MinRole('admin')
  deleteSiteKey(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    return this.tracking.deleteSiteKey(ws.id, id);
  }

  @Get('api-keys')
  @MinRole('admin')
  apiKeys(@Ws() ws: WorkspaceContext) {
    return this.tracking.listApiKeys(ws.id);
  }

  @Post('api-keys')
  @MinRole('admin')
  createApiKey(@Ws() ws: WorkspaceContext, @Body() dto: ApiKeyDto) {
    return this.tracking.createApiKey(ws.id, dto.name);
  }

  @Delete('api-keys/:id')
  @MinRole('admin')
  deleteApiKey(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    return this.tracking.deleteApiKey(ws.id, id);
  }

  @Get('events')
  events(@Ws() ws: WorkspaceContext, @Query() q: EventsQuery) {
    return this.tracking.listEvents(ws.id, q);
  }

  /** Live event feed (SSE). Auth via `?access_token=` because EventSource can't set headers. */
  @Sse('events/stream')
  @SkipThrottle()
  stream(@Ws() ws: WorkspaceContext): Observable<MessageEvent> {
    return new Observable<MessageEvent>((sub) => {
      let unsubscribe: (() => Promise<void>) | null = null;
      let closed = false;
      this.redis
        .subscribe(eventsChannel(ws.workspace.id), (msg) => sub.next({ data: JSON.parse(msg) }))
        .then((u) => (closed ? void u() : (unsubscribe = u)))
        .catch((e) => sub.error(e));
      // Comment-only keepalive so proxies don't close an idle stream.
      const ping = setInterval(() => sub.next({ type: 'ping', data: '' }), 25_000);
      return () => {
        closed = true;
        clearInterval(ping);
        void unsubscribe?.();
      };
    });
  }

  @Get('contacts')
  contacts(@Ws() ws: WorkspaceContext, @Query() q: ContactsQuery) {
    return this.tracking.listContacts(ws.id, q);
  }

  @Get('contacts/:id')
  async contact(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    const { leadDocs, ...rest } = await this.tracking.contactDetail(ws.id, id);
    return { ...rest, leads: await this.leads.view(ws.workspace, leadDocs) };
  }
}

@Processor(QUEUES.tracking, { concurrency: 10 })
export class TrackingProcessor extends WorkerHost {
  private readonly logger = new Logger(TrackingProcessor.name);

  constructor(
    private readonly identity: IdentityService,
    private readonly leads: LeadsService,
    @InjectModel(Workspace.name) private readonly workspaces: Model<Workspace>,
  ) {
    super();
  }

  async process(job: Job<IdentifyJob | PixelConversionJob>) {
    const ws = await this.workspaces.findById(job.data.workspaceId);
    if (!ws) return { skipped: 'workspace deleted' };
    if (job.name === 'conversion') {
      const d = job.data as PixelConversionJob;
      const lead = await this.leads.markWonFromPixel(ws, d.deviceKey, null, d.value);
      return { leadId: lead?.id ?? null };
    }
    const d = job.data as IdentifyJob;
    const contact = await this.identity.resolve(ws, d.deviceKey, d);
    if (d.lead) {
      const lead = await this.leads.captureFromPixel(ws, {
        email: d.email,
        phone: d.phone,
        name: d.name,
        fields: d.lead.fields,
        touch: d.lead.touch,
        ip: d.lead.ip,
        userAgent: d.lead.userAgent,
        contactId: contact?._id ?? null,
        deviceKey: d.deviceKey,
        consent: d.consent,
        country: d.country,
      });
      this.logger.log(`Pixel lead ${lead?.id ?? '(none)'} for device ${d.deviceKey}`);
    }
    return { contactId: contact?.id ?? null };
  }
}

const workers = process.env.RUN_WORKERS === 'false' ? [] : [TrackingProcessor];

@Module({
  imports: [LeadsModule, BullModule.registerQueue({ name: QUEUES.tracking })],
  controllers: [PixelController, TrackingController],
  providers: [TrackingService, IdentityService, ...workers],
  exports: [TrackingService],
})
export class TrackingModule {}
