import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { WorkspaceAccessService } from '../common/auth/guards.js';
import { generateKey, sha256 } from '../common/utils/identity.js';
import {
  Invite,
  Membership,
  PipelineStage,
  Role,
  roleRank,
  User,
  Workspace,
  WorkspaceDoc,
} from '../database/schemas/workspace.schema.js';

export interface CreateWorkspaceInput {
  name: string;
  type?: 'agency' | 'client';
  parentId?: string;
  currency?: string;
  timezone?: string;
  phoneCountryCode?: string;
}

export const workspaceView = (w: WorkspaceDoc, role: Role) => ({
  id: w.id as string,
  name: w.name,
  type: w.type,
  parentId: w.parentId ? String(w.parentId) : null,
  currency: w.currency,
  timezone: w.timezone,
  phoneCountryCode: w.phoneCountryCode,
  brandColor: w.brandColor,
  role,
  createdAt: w.createdAt,
});

const INVITE_TTL_DAYS = 7;

@Injectable()
export class WorkspacesService {
  constructor(
    @InjectModel(Workspace.name) private readonly workspaces: Model<Workspace>,
    @InjectModel(Membership.name) private readonly memberships: Model<Membership>,
    @InjectModel(Invite.name) private readonly invites: Model<Invite>,
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly access: WorkspaceAccessService,
    private readonly config: ConfigService,
  ) {}

  /** Workspaces the user belongs to, plus every client of an agency they administer. */
  async listForUser(userId: string) {
    const rows = await this.memberships.find({ userId: new Types.ObjectId(userId) });
    const roleById = new Map(rows.map((m) => [String(m.workspaceId), m.role]));
    const own = await this.workspaces.find({ _id: { $in: rows.map((m) => m.workspaceId) } });
    const adminAgencies = own.filter((w) => w.type === 'agency' && roleRank(roleById.get(w.id)!) >= roleRank('admin'));
    const clients = adminAgencies.length
      ? await this.workspaces.find({ parentId: { $in: adminAgencies.map((w) => w._id) } })
      : [];
    const out = new Map<string, ReturnType<typeof workspaceView>>();
    for (const w of own) out.set(w.id, workspaceView(w, roleById.get(w.id)!));
    for (const c of clients) {
      const inherited = roleById.get(String(c.parentId))!;
      const existing = out.get(c.id);
      if (!existing || roleRank(inherited) > roleRank(existing.role)) out.set(c.id, workspaceView(c, inherited));
    }
    return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async create(userId: string, input: CreateWorkspaceInput) {
    let parentId: Types.ObjectId | null = null;
    if (input.parentId) {
      const parent = await this.access.resolve(userId, input.parentId);
      if (!parent || parent.workspace.type !== 'agency') throw new BadRequestException('parentId must be an agency workspace');
      if (roleRank(parent.role) < roleRank('admin')) throw new ForbiddenException('Only agency admins can add clients');
      parentId = parent.workspace._id;
    }
    const ws = await this.workspaces.create({
      name: input.name.trim(),
      type: parentId ? 'client' : (input.type ?? 'client'),
      parentId,
      currency: input.currency?.toUpperCase() ?? 'INR',
      timezone: input.timezone ?? 'Asia/Kolkata',
      phoneCountryCode: input.phoneCountryCode?.replace(/\D/g, '') || '91',
      createdBy: new Types.ObjectId(userId),
    });
    await this.memberships.create({ workspaceId: ws._id, userId: new Types.ObjectId(userId), role: 'owner' });
    return workspaceView(ws, 'owner');
  }

  async update(ws: WorkspaceDoc, role: Role, patch: Partial<Pick<Workspace, 'name' | 'currency' | 'timezone' | 'phoneCountryCode' | 'brandColor'>>) {
    if (patch.timezone) {
      try {
        new Intl.DateTimeFormat('en', { timeZone: patch.timezone });
      } catch {
        throw new BadRequestException('Unknown time zone');
      }
    }
    Object.assign(ws, patch);
    if (patch.currency) ws.currency = patch.currency.toUpperCase();
    await ws.save();
    return workspaceView(ws, role);
  }

  pipeline(ws: WorkspaceDoc) {
    return [...ws.pipeline].sort((a, b) => a.order - b.order);
  }

  async setPipeline(ws: WorkspaceDoc, stages: PipelineStage[]) {
    const keys = new Set<string>();
    for (const s of stages) {
      if (!/^[a-z0-9_]{1,40}$/.test(s.key)) throw new BadRequestException(`Invalid stage key "${s.key}"`);
      if (keys.has(s.key)) throw new BadRequestException(`Duplicate stage key "${s.key}"`);
      keys.add(s.key);
    }
    if (!stages.some((s) => s.kind === 'open')) throw new BadRequestException('Pipeline needs at least one open stage');
    ws.pipeline = stages.map((s, i) => ({ ...s, order: s.order ?? i }));
    await ws.save();
    return this.pipeline(ws);
  }

  async members(workspaceId: Types.ObjectId) {
    const rows = await this.memberships.find({ workspaceId }).populate<{ userId: User & { _id: Types.ObjectId } }>('userId');
    return rows
      .filter((m) => m.userId)
      .map((m) => ({
        userId: String(m.userId._id),
        name: m.userId.name,
        email: m.userId.email,
        role: m.role,
        joinedAt: m.createdAt,
      }));
  }

  async setMemberRole(workspaceId: Types.ObjectId, actorRole: Role, userId: string, role: Role) {
    const m = await this.memberships.findOne({ workspaceId, userId: new Types.ObjectId(userId) });
    if (!m) throw new NotFoundException('Member not found');
    if (role === 'owner' && actorRole !== 'owner') throw new ForbiddenException('Only owners can grant owner');
    if (m.role === 'owner' && actorRole !== 'owner') throw new ForbiddenException('Only owners can change an owner');
    if (m.role === 'owner' && role !== 'owner') await this.assertAnotherOwner(workspaceId, userId);
    m.role = role;
    await m.save();
    return (await this.members(workspaceId)).find((x) => x.userId === userId);
  }

  async removeMember(workspaceId: Types.ObjectId, actorRole: Role, userId: string) {
    const m = await this.memberships.findOne({ workspaceId, userId: new Types.ObjectId(userId) });
    if (!m) throw new NotFoundException('Member not found');
    if (m.role === 'owner') {
      if (actorRole !== 'owner') throw new ForbiddenException('Only owners can remove an owner');
      await this.assertAnotherOwner(workspaceId, userId);
    }
    await m.deleteOne();
    return { ok: true };
  }

  private async assertAnotherOwner(workspaceId: Types.ObjectId, userId: string) {
    const others = await this.memberships.countDocuments({ workspaceId, role: 'owner', userId: { $ne: new Types.ObjectId(userId) } });
    if (others === 0) throw new BadRequestException('A workspace needs at least one owner');
  }

  async listInvites(workspaceId: Types.ObjectId) {
    return this.invites.find({ workspaceId, status: 'pending' }).sort({ createdAt: -1 });
  }

  async createInvite(workspaceId: Types.ObjectId, actorId: string, actorRole: Role, email: string, role: Role) {
    if (roleRank(role) > roleRank(actorRole)) throw new ForbiddenException('Cannot invite with a higher role than your own');
    const { key, hash } = generateKey('inv');
    const invite = await this.invites.create({
      workspaceId,
      email: email.toLowerCase().trim(),
      role,
      tokenHash: hash,
      expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000),
      invitedBy: new Types.ObjectId(actorId),
    });
    const acceptUrl = `${this.config.get('WEB_URL')}/invite/${key}`;
    return { ...invite.toJSON(), acceptUrl };
  }

  async revokeInvite(workspaceId: Types.ObjectId, id: string) {
    const res = await this.invites.updateOne({ _id: id, workspaceId, status: 'pending' }, { status: 'revoked' });
    if (!res.matchedCount) throw new NotFoundException('Invite not found');
    return { ok: true };
  }

  private async findInvite(token: string) {
    const invite = await this.invites.findOne({ tokenHash: sha256(token) });
    if (!invite) throw new NotFoundException('Invite not found');
    return invite;
  }

  async describeInvite(token: string) {
    const invite = await this.findInvite(token);
    const ws = await this.workspaces.findById(invite.workspaceId);
    const status = invite.status === 'pending' && invite.expiresAt < new Date() ? 'expired' : invite.status;
    return { workspaceName: ws?.name ?? '', email: invite.email, role: invite.role, status };
  }

  async acceptInvite(token: string, userId: string) {
    const invite = await this.findInvite(token);
    if (invite.status !== 'pending' || invite.expiresAt < new Date()) throw new BadRequestException('This invite is no longer valid');
    const user = await this.users.findById(userId);
    if (!user || user.email !== invite.email) throw new ForbiddenException(`This invite was sent to ${invite.email}`);
    const ws = await this.workspaces.findById(invite.workspaceId);
    if (!ws) throw new NotFoundException('Workspace no longer exists');
    const existing = await this.memberships.findOne({ workspaceId: ws._id, userId: user._id });
    if (!existing) await this.memberships.create({ workspaceId: ws._id, userId: user._id, role: invite.role });
    else if (roleRank(invite.role) > roleRank(existing.role)) await existing.updateOne({ role: invite.role });
    invite.status = 'accepted';
    await invite.save();
    const role = existing && roleRank(existing.role) > roleRank(invite.role) ? existing.role : invite.role;
    return workspaceView(ws, role);
  }
}
