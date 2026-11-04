import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export const ROLES = ['viewer', 'analyst', 'admin', 'owner'] as const;
export type Role = (typeof ROLES)[number];
export const roleRank = (r: Role) => ROLES.indexOf(r);

@Schema({ timestamps: true, collection: 'users' })
export class User {
  @Prop({ required: true, trim: true }) name: string;
  @Prop({ required: true, unique: true, lowercase: true, trim: true }) email: string;
  @Prop({ required: true, select: false }) passwordHash: string;
  @Prop({ type: Date, default: null }) lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
export type UserDoc = HydratedDocument<User>;
export const UserSchema = SchemaFactory.createForClass(User);

@Schema({ _id: false })
export class PipelineStage {
  @Prop({ required: true }) key: string;
  @Prop({ required: true }) label: string;
  @Prop({ required: true }) order: number;
  @Prop({ enum: ['open', 'won', 'lost'], default: 'open' }) kind: 'open' | 'won' | 'lost';
  @Prop() value?: number;
  @Prop({ default: false }) pushToPlatforms: boolean;
  @Prop() metaEventName?: string;
  @Prop() googleConversionActionId?: string;
}
export const PipelineStageSchema = SchemaFactory.createForClass(PipelineStage);

export const DEFAULT_PIPELINE: PipelineStage[] = [
  { key: 'new', label: 'New lead', order: 0, kind: 'open', pushToPlatforms: true, metaEventName: 'Lead' },
  { key: 'qualified', label: 'Qualified', order: 1, kind: 'open', pushToPlatforms: false, metaEventName: 'QualifiedLead' },
  { key: 'application', label: 'Application', order: 2, kind: 'open', pushToPlatforms: false, metaEventName: 'SubmitApplication' },
  { key: 'approved', label: 'Approved', order: 3, kind: 'open', pushToPlatforms: false },
  { key: 'won', label: 'Won', order: 4, kind: 'won', pushToPlatforms: true, metaEventName: 'Purchase' },
  { key: 'lost', label: 'Lost', order: 5, kind: 'lost', pushToPlatforms: false },
];

@Schema({ timestamps: true, collection: 'workspaces' })
export class Workspace {
  @Prop({ required: true, trim: true }) name: string;
  @Prop({ enum: ['agency', 'client'], default: 'client' }) type: 'agency' | 'client';
  @Prop({ type: Types.ObjectId, ref: 'Workspace', default: null, index: true }) parentId: Types.ObjectId | null;
  @Prop({ default: 'INR' }) currency: string;
  @Prop({ default: 'Asia/Kolkata' }) timezone: string;
  @Prop({ default: '91' }) phoneCountryCode: string;
  @Prop({ default: '#2563eb' }) brandColor: string;
  @Prop({ type: [PipelineStageSchema], default: () => DEFAULT_PIPELINE }) pipeline: PipelineStage[];
  @Prop({ type: Types.ObjectId, ref: 'User' }) createdBy: Types.ObjectId;
  createdAt: Date;
}
export type WorkspaceDoc = HydratedDocument<Workspace>;
export const WorkspaceSchema = SchemaFactory.createForClass(Workspace);

@Schema({ timestamps: true, collection: 'memberships' })
export class Membership {
  @Prop({ type: Types.ObjectId, ref: 'Workspace', required: true }) workspaceId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true }) userId: Types.ObjectId;
  @Prop({ enum: ROLES, required: true }) role: Role;
  createdAt: Date;
}
export type MembershipDoc = HydratedDocument<Membership>;
export const MembershipSchema = SchemaFactory.createForClass(Membership);
MembershipSchema.index({ workspaceId: 1, userId: 1 }, { unique: true });

@Schema({ timestamps: true, collection: 'invites' })
export class Invite {
  @Prop({ type: Types.ObjectId, ref: 'Workspace', required: true, index: true }) workspaceId: Types.ObjectId;
  @Prop({ required: true, lowercase: true, trim: true }) email: string;
  @Prop({ enum: ROLES, required: true }) role: Role;
  @Prop({ required: true, unique: true, select: false }) tokenHash: string;
  @Prop({ enum: ['pending', 'accepted', 'revoked'], default: 'pending' }) status: 'pending' | 'accepted' | 'revoked';
  @Prop({ required: true }) expiresAt: Date;
  @Prop({ type: Types.ObjectId, ref: 'User' }) invitedBy: Types.ObjectId;
  createdAt: Date;
}
export type InviteDoc = HydratedDocument<Invite>;
export const InviteSchema = SchemaFactory.createForClass(Invite);
