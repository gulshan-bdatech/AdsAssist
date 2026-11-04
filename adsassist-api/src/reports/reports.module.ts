import { Controller, Get, Module, Param, Query, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { Ws, type WorkspaceContext } from '../common/auth/decorators.js';
import { WorkspaceGuard } from '../common/auth/guards.js';
import { RangeQuery } from '../common/dto.js';
import { resolveRange } from '../common/utils/dates.js';
import { LeadsModule } from '../leads/leads.module.js';
import { TrackingModule } from '../tracking/tracking.module.js';
import { ReportsService } from './reports.service.js';

class CampaignsQuery extends RangeQuery {
  @IsOptional() @IsIn(['active', 'paused', 'all']) status?: 'active' | 'paused' | 'all';
  @IsOptional() @IsString() search?: string;
}

@Controller('workspaces/:wid')
@UseGuards(WorkspaceGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  private range(ws: WorkspaceContext, q: RangeQuery) {
    return resolveRange(q.from, q.to, ws.workspace.timezone);
  }

  @Get('dashboard/overview')
  overview(@Ws() ws: WorkspaceContext, @Query() q: RangeQuery) {
    return this.reports.overview(ws.workspace, this.range(ws, q), q);
  }

  @Get('campaigns')
  campaigns(@Ws() ws: WorkspaceContext, @Query() q: CampaignsQuery) {
    return this.reports.campaignRows(ws.workspace, this.range(ws, q), q, q);
  }

  @Get('campaigns/:id')
  campaign(@Ws() ws: WorkspaceContext, @Param('id') id: string, @Query() q: RangeQuery) {
    return this.reports.campaignDetail(ws.workspace, id, this.range(ws, q));
  }

  @Get('live')
  live(@Ws() ws: WorkspaceContext) {
    return this.reports.live(ws.workspace);
  }

  @Get('insights')
  insights(@Ws() ws: WorkspaceContext, @Query() q: RangeQuery) {
    return this.reports.insights(ws.workspace, this.range(ws, q));
  }
}

@Module({
  imports: [LeadsModule, TrackingModule],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
