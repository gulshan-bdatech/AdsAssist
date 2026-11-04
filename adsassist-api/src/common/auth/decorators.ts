import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { Types } from 'mongoose';
import type { Role, WorkspaceDoc } from '../../database/schemas/workspace.schema.js';

export interface AuthUser {
  id: string;
  email: string;
}

export interface WorkspaceContext {
  workspace: WorkspaceDoc;
  id: Types.ObjectId;
  role: Role;
}

export type AppRequest = Request & { user?: AuthUser; workspaceCtx?: WorkspaceContext };

export const IS_PUBLIC = 'isPublic';
/** Skips the global JWT guard. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const MIN_ROLE = 'minRole';
/** Minimum workspace role for a route under `/workspaces/:wid`. Defaults to `viewer`. */
export const MinRole = (role: Role) => SetMetadata(MIN_ROLE, role);

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AppRequest>().user!,
);

/** The workspace resolved and access-checked by WorkspaceGuard. */
export const Ws = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AppRequest>().workspaceCtx!,
);
