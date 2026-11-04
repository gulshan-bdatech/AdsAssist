import { BullModule } from '@nestjs/bullmq';
import { Body, Controller, Delete, Get, Module, Param, ParseEnumPipe, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsInt, IsMongoId, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import type { Response } from 'express';
import { CurrentUser, MinRole, Public, Ws, type AuthUser, type WorkspaceContext } from '../common/auth/decorators.js';
import { WorkspaceGuard } from '../common/auth/guards.js';
import { PLATFORMS, type Platform } from '../database/schemas/integration.schema.js';
import { QUEUES } from '../queues.js';
import { AdAccountsService } from './ad-accounts.service.js';
import { AdsSyncProcessor, SyncScheduler } from './ads-sync.processor.js';
import { AdsSyncService } from './ads-sync.service.js';
import { ConnectionsService } from './connections.service.js';
import { GoogleAdsClient } from './platforms/google-ads.client.js';
import { MetaClient } from './platforms/meta.client.js';

class AddAccountsDto {
  @IsMongoId() connectionId: string;
  @IsArray() @ArrayMinSize(1) @IsString({ each: true }) externalIds: string[];
}

class UpdateAccountDto {
  @IsOptional() @IsBoolean() syncEnabled?: boolean;
  @IsOptional() @IsBoolean() conversionsEnabled?: boolean;
  @IsOptional() @IsString() @MaxLength(40) metaPixelId?: string;
  @IsOptional() @IsString() @MaxLength(40) googleConversionActionId?: string;
}

class SyncDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(90) days?: number;
}

const platformPipe = new ParseEnumPipe(Object.fromEntries(PLATFORMS.map((p) => [p, p])));

@Controller('workspaces/:wid')
@UseGuards(WorkspaceGuard)
export class IntegrationsController {
  constructor(
    private readonly connections: ConnectionsService,
    private readonly accounts: AdAccountsService,
  ) {}

  @Get('integrations/:platform/connect')
  @MinRole('admin')
  connect(@Ws() ws: WorkspaceContext, @CurrentUser() u: AuthUser, @Param('platform', platformPipe) platform: Platform) {
    return this.connections.connectUrl(ws.workspace.id, u.id, platform);
  }

  @Get('integrations/connections')
  listConnections(@Ws() ws: WorkspaceContext) {
    return this.connections.list(ws.id);
  }

  @Delete('integrations/connections/:id')
  @MinRole('admin')
  removeConnection(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    return this.connections.remove(ws.id, id);
  }

  @Post('integrations/connections/:id/refresh-accounts')
  @MinRole('admin')
  refreshAccounts(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    return this.connections.refreshAccounts(ws.id, id);
  }

  @Get('ad-accounts')
  listAccounts(@Ws() ws: WorkspaceContext) {
    return this.accounts.list(ws.id);
  }

  @Post('ad-accounts')
  @MinRole('admin')
  addAccounts(@Ws() ws: WorkspaceContext, @Body() dto: AddAccountsDto) {
    return this.accounts.add(ws.id, dto.connectionId, dto.externalIds);
  }

  @Patch('ad-accounts/:id')
  @MinRole('admin')
  updateAccount(@Ws() ws: WorkspaceContext, @Param('id') id: string, @Body() dto: UpdateAccountDto) {
    return this.accounts.update(ws.id, id, dto);
  }

  @Delete('ad-accounts/:id')
  @MinRole('admin')
  removeAccount(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    return this.accounts.remove(ws.id, id);
  }

  @Post('ad-accounts/:id/sync')
  @MinRole('analyst')
  sync(@Ws() ws: WorkspaceContext, @Param('id') id: string, @Body() dto: SyncDto) {
    return this.accounts.syncNow(ws.id, id, dto.days);
  }

  @Get('ad-accounts/:id/meta-pixels')
  metaPixels(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    return this.accounts.metaPixels(ws.id, id);
  }

  @Get('ad-accounts/:id/google-conversion-actions')
  googleActions(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    return this.accounts.googleConversionActions(ws.id, id);
  }

  @Get('sync-runs')
  syncRuns(@Ws() ws: WorkspaceContext, @Query('adAccountId') adAccountId?: string) {
    return this.accounts.syncRuns(ws.id, adAccountId);
  }
}

@Controller('integrations')
export class OAuthCallbackController {
  constructor(private readonly connections: ConnectionsService) {}

  @Public()
  @Get(':platform/callback')
  async callback(@Param('platform', platformPipe) platform: Platform, @Query() query: Record<string, string>, @Res() res: Response) {
    res.redirect(302, await this.connections.handleCallback(platform, query));
  }
}

const workers = process.env.RUN_WORKERS === 'false' ? [] : [AdsSyncProcessor, SyncScheduler];

@Module({
  imports: [BullModule.registerQueue({ name: QUEUES.adsSync })],
  controllers: [IntegrationsController, OAuthCallbackController],
  providers: [GoogleAdsClient, MetaClient, ConnectionsService, AdAccountsService, AdsSyncService, ...workers],
  exports: [GoogleAdsClient, MetaClient, ConnectionsService, AdAccountsService],
})
export class IntegrationsModule {}
