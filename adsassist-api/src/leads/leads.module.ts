import { BullModule, Processor, WorkerHost } from '@nestjs/bullmq';
import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Injectable,
  Module,
  Param,
  Patch,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { IsEmail, IsIn, IsMongoId, IsNumber, IsObject, IsOptional, IsString, Length, MaxLength, Min, ValidateNested } from 'class-validator';
import { Job } from 'bullmq';
import { Model } from 'mongoose';
import { MinRole, Public, Ws, CurrentUser, type AppRequest, type AuthUser, type WorkspaceContext } from '../common/auth/decorators.js';
import { WorkspaceGuard } from '../common/auth/guards.js';
import { PageQuery, PagedRangeQuery, RangeQuery } from '../common/dto.js';
import { resolveRange } from '../common/utils/dates.js';
import { sha256 } from '../common/utils/identity.js';
import { ApiKey } from '../database/schemas/tracking.schema.js';
import { Workspace } from '../database/schemas/workspace.schema.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { ConversionJob, QUEUES } from '../queues.js';
import { ConversionsService } from './conversions.service.js';
import { LeadsService } from './leads.service.js';

const CHANNELS = ['google', 'meta', 'organic', 'other'] as const;

class LeadListQuery extends PagedRangeQuery {
  @IsOptional() @IsString() stage?: string;
  @IsOptional() @IsIn(CHANNELS) channel?: (typeof CHANNELS)[number];
  @IsOptional() @IsMongoId() campaignId?: string;
}

class CreateLeadDto {
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsString() stage?: string;
  @IsOptional() @IsNumber() @Min(0) value?: number;
  @IsOptional() @IsIn(CHANNELS) channel?: (typeof CHANNELS)[number];
  @IsOptional() @IsMongoId() campaignId?: string;
  @IsOptional() @IsString() @MaxLength(5000) notes?: string;
}

class UpdateLeadDto {
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsString() @MaxLength(5000) notes?: string;
  @IsOptional() @IsNumber() @Min(0) value?: number;
}

class StageDto {
  @IsString() stage: string;
  @IsOptional() @IsNumber() @Min(0) value?: number;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
}

class ConversionsQuery extends PageQuery {
  @IsOptional() @IsIn(['pending', 'sent', 'failed', 'skipped']) status?: 'pending' | 'sent' | 'failed' | 'skipped';
  @IsOptional() @IsIn(['google', 'meta']) platform?: 'google' | 'meta';
}

class ApiUtmDto {
  @IsOptional() @IsString() @MaxLength(300) source?: string;
  @IsOptional() @IsString() @MaxLength(300) medium?: string;
  @IsOptional() @IsString() @MaxLength(300) campaign?: string;
  @IsOptional() @IsString() @MaxLength(300) content?: string;
  @IsOptional() @IsString() @MaxLength(300) term?: string;
  @IsOptional() @IsString() @MaxLength(100) id?: string;
}

/** Body of POST /api/v1/leads (server-to-server, CRM/LMS). */
class ApiLeadDto {
  @IsString() @Length(1, 120) externalId: string;
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsString() stage?: string;
  @IsOptional() @IsNumber() @Min(0) value?: number;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @IsOptional() @IsString() @MaxLength(300) gclid?: string;
  @IsOptional() @IsString() @MaxLength(300) fbclid?: string;
  @IsOptional() @ValidateNested() @Type(() => ApiUtmDto) utm?: ApiUtmDto;
  @IsOptional() @IsString() @MaxLength(5000) notes?: string;
  @IsOptional() @IsObject() fields?: Record<string, string>;
}

@Controller('workspaces/:wid')
@UseGuards(WorkspaceGuard)
export class LeadsController {
  constructor(
    private readonly leads: LeadsService,
    private readonly conversions: ConversionsService,
  ) {}

  @Get('leads')
  list(@Ws() ws: WorkspaceContext, @Query() q: LeadListQuery) {
    return this.leads.list(ws.workspace, resolveRange(q.from, q.to, ws.workspace.timezone), q);
  }

  @Post('leads')
  @MinRole('analyst')
  async create(@Ws() ws: WorkspaceContext, @CurrentUser() u: AuthUser, @Body() dto: CreateLeadDto) {
    const lead = await this.leads.create(ws.workspace, dto, 'manual', 'user', u.id);
    return (await this.leads.view(ws.workspace, [lead]))[0];
  }

  @Get('leads/:id')
  detail(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    return this.leads.detail(ws.workspace, id);
  }

  @Patch('leads/:id')
  @MinRole('analyst')
  async update(@Ws() ws: WorkspaceContext, @Param('id') id: string, @Body() dto: UpdateLeadDto) {
    const lead = await this.leads.update(ws.workspace, await this.leads.get(ws.id, id), dto);
    return (await this.leads.view(ws.workspace, [lead]))[0];
  }

  @Post('leads/:id/stage')
  @MinRole('analyst')
  async stage(@Ws() ws: WorkspaceContext, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: StageDto) {
    const lead = await this.leads.changeStage(ws.workspace, await this.leads.get(ws.id, id), dto.stage, dto.value, 'user', u.id);
    return (await this.leads.view(ws.workspace, [lead]))[0];
  }

  @Get('conversions')
  listConversions(@Ws() ws: WorkspaceContext, @Query() q: ConversionsQuery) {
    return this.conversions.list(ws.id, q);
  }

  @Get('conversions/stats')
  stats(@Ws() ws: WorkspaceContext, @Query() q: RangeQuery) {
    return this.conversions.stats(ws.workspace, resolveRange(q.from, q.to, ws.workspace.timezone));
  }

  @Post('conversions/:id/retry')
  @MinRole('analyst')
  retry(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    return this.conversions.retry(ws.id, id);
  }
}

/** Authenticates server-to-server calls with a workspace API key (`X-API-Key: aak_…`). */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    @InjectModel(ApiKey.name) private readonly apiKeys: Model<ApiKey>,
    @InjectModel(Workspace.name) private readonly workspaces: Model<Workspace>,
  ) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const key = String(req.headers['x-api-key'] ?? '');
    if (!key.startsWith('aak_')) throw new UnauthorizedException('Missing or malformed X-API-Key');
    const apiKey = await this.apiKeys.findOneAndUpdate({ keyHash: sha256(key) }, { lastUsedAt: new Date() });
    const workspace = apiKey && (await this.workspaces.findById(apiKey.workspaceId));
    if (!workspace) throw new UnauthorizedException('Invalid API key');
    req.workspaceCtx = { workspace, id: workspace._id, role: 'analyst' };
    return true;
  }
}

@Public()
@UseGuards(ApiKeyGuard)
@Throttle({ default: { limit: 600, ttl: 60_000 } })
@Controller('v1/leads')
export class PublicLeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Post()
  async upsert(@Ws() ws: WorkspaceContext, @Body() dto: ApiLeadDto) {
    const lead = await this.leads.upsertFromApi(ws.workspace, {
      ...dto,
      touch: dto.gclid || dto.fbclid || dto.utm ? { gclid: dto.gclid, fbclid: dto.fbclid, utm: dto.utm } : undefined,
    });
    return (await this.leads.view(ws.workspace, [lead]))[0];
  }

  @Patch(':externalId/stage')
  async stage(@Ws() ws: WorkspaceContext, @Param('externalId') externalId: string, @Body() dto: StageDto) {
    const lead = await this.leads.getByExternalId(ws.id, externalId);
    if (dto.currency) lead.currency = dto.currency.toUpperCase();
    const updated = await this.leads.changeStage(ws.workspace, lead, dto.stage, dto.value, 'api');
    return (await this.leads.view(ws.workspace, [updated]))[0];
  }
}

@Processor(QUEUES.conversions, { concurrency: 5 })
export class ConversionsProcessor extends WorkerHost {
  constructor(private readonly conversions: ConversionsService) {
    super();
  }

  process(job: Job<ConversionJob>) {
    return this.conversions.send(job.data.pushId);
  }
}

const workers = process.env.RUN_WORKERS === 'false' ? [] : [ConversionsProcessor];

@Module({
  imports: [IntegrationsModule, BullModule.registerQueue({ name: QUEUES.conversions })],
  controllers: [LeadsController, PublicLeadsController],
  providers: [LeadsService, ConversionsService, ApiKeyGuard, ...workers],
  exports: [LeadsService, ApiKeyGuard],
})
export class LeadsModule {}
