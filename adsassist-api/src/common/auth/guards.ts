import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import {
  Membership,
  MembershipDoc,
  Role,
  roleRank,
  Workspace,
  WorkspaceDoc,
} from '../../database/schemas/workspace.schema.js';
import { AppRequest, IS_PUBLIC, MIN_ROLE } from './decorators.js';

/**
 * Global guard: every route needs a valid JWT unless marked @Public().
 * EventSource can't send headers, so `?access_token=` is accepted too.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : (req.query.access_token as string | undefined);
    if (!token) throw new UnauthorizedException('Missing access token');
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; email: string }>(token);
      req.user = { id: payload.sub, email: payload.email };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}

export interface WorkspaceAccess {
  workspace: WorkspaceDoc;
  role: Role;
}

/**
 * Resolves the caller's role in a workspace: their own membership, or the
 * role they hold in the parent agency (an agency admin manages its clients).
 */
@Injectable()
export class WorkspaceAccessService {
  constructor(
    @InjectModel(Workspace.name) private readonly workspaces: Model<Workspace>,
    @InjectModel(Membership.name) private readonly memberships: Model<Membership>,
  ) {}

  async resolve(userId: string, workspaceId: string): Promise<WorkspaceAccess | null> {
    if (!isValidObjectId(workspaceId)) return null;
    const workspace = await this.workspaces.findById(workspaceId);
    if (!workspace) return null;
    const ids = [workspace._id, ...(workspace.parentId ? [workspace.parentId] : [])];
    const rows: MembershipDoc[] = await this.memberships.find({
      userId: new Types.ObjectId(userId),
      workspaceId: { $in: ids },
    });
    let role: Role | null = null;
    for (const m of rows) {
      const own = m.workspaceId.equals(workspace._id);
      // Parent-agency members only inherit admin/owner rights.
      const effective: Role | null = own ? m.role : roleRank(m.role) >= roleRank('admin') ? m.role : null;
      if (effective && (!role || roleRank(effective) > roleRank(role))) role = effective;
    }
    return role ? { workspace, role } : null;
  }
}

/** Applied to controllers under `/workspaces/:wid`. Enforces membership and @MinRole. */
@Injectable()
export class WorkspaceGuard implements CanActivate {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const wid = req.params.wid as string | undefined;
    if (!wid || !req.user) return true;
    const found = await this.access.resolve(req.user.id, wid);
    if (!found) throw new NotFoundException('Workspace not found');
    const min = this.reflector.getAllAndOverride<Role>(MIN_ROLE, [ctx.getHandler(), ctx.getClass()]) ?? 'viewer';
    if (roleRank(found.role) < roleRank(min)) throw new ForbiddenException(`Requires ${min} role`);
    req.workspaceCtx = { workspace: found.workspace, id: found.workspace._id, role: found.role };
    return true;
  }
}
