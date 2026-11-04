import { Body, Controller, Delete, Get, Global, Module, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsHexColor,
  IsIn,
  IsInt,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CurrentUser, MinRole, Public, Ws, type AuthUser, type WorkspaceContext } from '../common/auth/decorators.js';
import { WorkspaceAccessService, WorkspaceGuard } from '../common/auth/guards.js';
import { ROLES, type Role } from '../database/schemas/workspace.schema.js';
import { workspaceView, WorkspacesService } from './workspaces.service.js';

class CreateWorkspaceDto {
  @IsString() @MinLength(1) @MaxLength(100) name: string;
  @IsOptional() @IsIn(['agency', 'client']) type?: 'agency' | 'client';
  @IsOptional() @IsMongoId() parentId?: string;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @Matches(/^\+?\d{1,4}$/) phoneCountryCode?: string;
}

class UpdateWorkspaceDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) name?: string;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @Matches(/^\+?\d{1,4}$/) phoneCountryCode?: string;
  @IsOptional() @IsHexColor() brandColor?: string;
}

class StageDto {
  @IsString() key: string;
  @IsString() @MinLength(1) @MaxLength(60) label: string;
  @Type(() => Number) @IsInt() order: number;
  @IsIn(['open', 'won', 'lost']) kind: 'open' | 'won' | 'lost';
  @IsOptional() @IsNumber() value?: number;
  @IsBoolean() pushToPlatforms: boolean;
  @IsOptional() @IsString() @MaxLength(60) metaEventName?: string;
  @IsOptional() @IsString() @MaxLength(40) googleConversionActionId?: string;
}

class PipelineDto {
  @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => StageDto) stages: StageDto[];
}

class RoleDto {
  @IsIn(ROLES) role: Role;
}

class InviteDto {
  @IsEmail() email: string;
  @IsIn(ROLES) role: Role;
}

@Controller('workspaces')
@UseGuards(WorkspaceGuard)
export class WorkspacesController {
  constructor(private readonly svc: WorkspacesService) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.svc.listForUser(u.id);
  }

  @Post()
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateWorkspaceDto) {
    return this.svc.create(u.id, dto);
  }

  @Get(':wid')
  get(@Ws() ws: WorkspaceContext) {
    return workspaceView(ws.workspace, ws.role);
  }

  @Patch(':wid')
  @MinRole('admin')
  update(@Ws() ws: WorkspaceContext, @Body() dto: UpdateWorkspaceDto) {
    return this.svc.update(ws.workspace, ws.role, dto);
  }

  @Get(':wid/pipeline')
  pipeline(@Ws() ws: WorkspaceContext) {
    return this.svc.pipeline(ws.workspace);
  }

  @Put(':wid/pipeline')
  @MinRole('admin')
  setPipeline(@Ws() ws: WorkspaceContext, @Body() dto: PipelineDto) {
    return this.svc.setPipeline(ws.workspace, dto.stages);
  }

  @Get(':wid/members')
  members(@Ws() ws: WorkspaceContext) {
    return this.svc.members(ws.id);
  }

  @Patch(':wid/members/:userId')
  @MinRole('admin')
  setRole(@Ws() ws: WorkspaceContext, @Param('userId') userId: string, @Body() dto: RoleDto) {
    return this.svc.setMemberRole(ws.id, ws.role, userId, dto.role);
  }

  @Delete(':wid/members/:userId')
  @MinRole('admin')
  remove(@Ws() ws: WorkspaceContext, @Param('userId') userId: string) {
    return this.svc.removeMember(ws.id, ws.role, userId);
  }

  @Get(':wid/invites')
  @MinRole('admin')
  invites(@Ws() ws: WorkspaceContext) {
    return this.svc.listInvites(ws.id);
  }

  @Post(':wid/invites')
  @MinRole('admin')
  invite(@Ws() ws: WorkspaceContext, @CurrentUser() u: AuthUser, @Body() dto: InviteDto) {
    return this.svc.createInvite(ws.id, u.id, ws.role, dto.email, dto.role);
  }

  @Delete(':wid/invites/:id')
  @MinRole('admin')
  revoke(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    return this.svc.revokeInvite(ws.id, id);
  }
}

@Controller('invites')
export class InvitesController {
  constructor(private readonly svc: WorkspacesService) {}

  @Public()
  @Get(':token')
  describe(@Param('token') token: string) {
    return this.svc.describeInvite(token);
  }

  @Post(':token/accept')
  accept(@Param('token') token: string, @CurrentUser() u: AuthUser) {
    return this.svc.acceptInvite(token, u.id);
  }
}

@Global()
@Module({
  controllers: [WorkspacesController, InvitesController],
  providers: [WorkspacesService, WorkspaceAccessService, WorkspaceGuard],
  exports: [WorkspacesService, WorkspaceAccessService, WorkspaceGuard],
})
export class WorkspacesModule {}
