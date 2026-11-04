import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Queue } from 'bullmq';
import { isValidObjectId, Model, Types } from 'mongoose';
import { Campaign } from '../database/schemas/ads.schema.js';
import { LeadFormSubscription, LeadFormSubscriptionDoc } from '../database/schemas/growth.schema.js';
import { PlatformConnection } from '../database/schemas/integration.schema.js';
import { Lead } from '../database/schemas/leads.schema.js';
import { Workspace } from '../database/schemas/workspace.schema.js';
import { ConnectionsService } from '../integrations/connections.service.js';
import { PlatformError } from '../integrations/platforms/http.js';
import { MetaClient } from '../integrations/platforms/meta.client.js';
import { LeadsService } from '../leads/leads.service.js';
import { AutomationJob, QUEUES } from '../queues.js';

export interface FormSelection {
  connectionId: string;
  pageId: string;
  pageName: string;
  formId: string;
  formName: string;
  enabled: boolean;
}

const EMAIL_FIELDS = ['email', 'work_email'];
const PHONE_FIELDS = ['phone_number', 'phone', 'mobile_number', 'work_phone_number'];

/** Imports Meta Lead Ads (instant form) leads into the pipeline, polling each enabled form. */
@Injectable()
export class LeadFormsService {
  private readonly logger = new Logger(LeadFormsService.name);

  constructor(
    @InjectModel(LeadFormSubscription.name) private readonly subs: Model<LeadFormSubscription>,
    @InjectModel(PlatformConnection.name) private readonly connectionsModel: Model<PlatformConnection>,
    @InjectModel(Campaign.name) private readonly campaigns: Model<Campaign>,
    @InjectModel(Lead.name) private readonly leadsModel: Model<Lead>,
    @InjectModel(Workspace.name) private readonly workspaces: Model<Workspace>,
    @InjectQueue(QUEUES.automation) private readonly queue: Queue,
    private readonly connections: ConnectionsService,
    private readonly meta: MetaClient,
    private readonly leads: LeadsService,
  ) {}

  private permissionHint(e: unknown): never {
    if (e instanceof PlatformError && (e.status === 403 || e.status === 400 || e.authRevoked)) {
      throw new BadRequestException(
        `Meta did not allow reading lead forms (${e.message}). Reconnect Meta under Integrations to grant the new Lead Ads permissions.`,
      );
    }
    throw e;
  }

  /** Every lead form on every Page the workspace's Meta logins manage. */
  async available(workspaceId: Types.ObjectId) {
    const conns = await this.connectionsModel.find({ workspaceId, platform: 'meta', status: 'active' });
    if (!conns.length) throw new BadRequestException('Connect a Meta account first');
    const enabled = new Set((await this.subs.find({ workspaceId, enabled: true }, { formId: 1 })).map((s) => s.formId));
    const out = [];
    for (const c of conns) {
      try {
        const token = await this.connections.accessToken(c._id);
        for (const page of await this.meta.listPages(token)) {
          for (const form of await this.meta.listLeadForms(page.access_token, page.id)) {
            out.push({
              connectionId: c.id as string,
              pageId: page.id,
              pageName: page.name,
              formId: form.id,
              formName: form.name,
              status: form.status,
              enabled: enabled.has(form.id),
            });
          }
        }
      } catch (e) {
        this.permissionHint(e);
      }
    }
    return out;
  }

  list(workspaceId: Types.ObjectId) {
    return this.subs.find({ workspaceId }).sort({ pageName: 1, formName: 1 });
  }

  async save(workspaceId: Types.ObjectId, forms: FormSelection[]) {
    const connIds = new Set(
      (await this.connectionsModel.find({ workspaceId, platform: 'meta' }, { _id: 1 })).map((c) => String(c._id)),
    );
    for (const f of forms) {
      if (!connIds.has(f.connectionId)) throw new BadRequestException(`Unknown Meta connection ${f.connectionId}`);
      const sub = await this.subs.findOneAndUpdate(
        { workspaceId, formId: f.formId },
        {
          $set: {
            connectionId: new Types.ObjectId(f.connectionId),
            pageId: f.pageId,
            pageName: f.pageName,
            formName: f.formName,
            enabled: f.enabled,
          },
        },
        { upsert: true, returnDocument: 'after' },
      );
      if (f.enabled && !sub.lastImportedAt) await this.enqueue(sub);
    }
    return this.list(workspaceId);
  }

  private enqueue(sub: LeadFormSubscriptionDoc) {
    const job: AutomationJob = { name: 'leadform-import', data: { subscriptionId: sub.id } };
    return this.queue.add(job.name, job.data, { jobId: `leadform-${sub.id}`, attempts: 2, removeOnComplete: true, removeOnFail: true });
  }

  async importNow(workspaceId: Types.ObjectId, id: string) {
    const sub = isValidObjectId(id) ? await this.subs.findOne({ _id: id, workspaceId }) : null;
    if (!sub) throw new NotFoundException('Lead form not found');
    await this.enqueue(sub);
    return { queued: true };
  }

  async tick() {
    const subs = await this.subs.find({ enabled: true });
    for (const s of subs) await this.enqueue(s);
    return { queued: subs.length };
  }

  /** Worker: fetch leads newer than the cursor and create pipeline leads. */
  async import(subscriptionId: string) {
    const sub = await this.subs.findById(subscriptionId);
    if (!sub || !sub.enabled) return { skipped: true };
    const ws = await this.workspaces.findById(sub.workspaceId);
    if (!ws) return { skipped: true };
    let imported = 0;
    try {
      const token = await this.connections.accessToken(sub.connectionId);
      const page = (await this.meta.listPages(token)).find((p) => p.id === sub.pageId);
      if (!page) throw new Error('The connected Meta user no longer manages this Page');
      const rows = await this.meta.fetchFormLeads(page.access_token, sub.formId, sub.cursorTime);
      for (const r of rows) {
        if (await this.leadsModel.exists({ workspaceId: ws._id, metaLeadId: r.id })) continue;
        const fields: Record<string, string> = {};
        let email: string | null = null;
        let phone: string | null = null;
        let first = '';
        let last = '';
        let full = '';
        for (const f of r.field_data ?? []) {
          const v = (f.values ?? []).join(', ').trim();
          if (!v) continue;
          const name = f.name.toLowerCase();
          if (EMAIL_FIELDS.includes(name)) email ??= v;
          else if (PHONE_FIELDS.includes(name)) phone ??= v;
          else if (name === 'full_name') full = v;
          else if (name === 'first_name') first = v;
          else if (name === 'last_name') last = v;
          else fields[name.slice(0, 60)] = v.slice(0, 500);
        }
        fields.meta_form = sub.formName || sub.formId;
        if (r.platform) fields.meta_platform = r.platform;
        const campaign = r.campaign_id ? await this.campaigns.findOne({ workspaceId: ws._id, platform: 'meta', externalId: r.campaign_id }) : null;
        const lead = await this.leads.create(
          ws,
          {
            externalId: `mf_${r.id}`,
            metaLeadId: r.id,
            name: full || [first, last].filter(Boolean).join(' ') || null,
            email,
            phone,
            fields,
            channel: 'meta',
            campaignId: campaign?.id,
            touch: r.campaign_id ? { utm: { source: 'facebook', medium: 'lead_ad', id: r.campaign_id } } : undefined,
          },
          'meta_form',
          'api',
        );
        // Keep Meta's submission time so reports put the lead on the right day.
        await this.leadsModel.updateOne({ _id: lead._id }, { $set: { createdAt: new Date(r.created_time) } }, { timestamps: false });
        imported++;
        const at = new Date(r.created_time);
        if (!sub.cursorTime || at > sub.cursorTime) sub.cursorTime = at;
      }
      Object.assign(sub, { lastImportedAt: new Date(), lastError: null, importedCount: sub.importedCount + imported });
    } catch (e) {
      sub.lastError = (e as Error).message;
      this.logger.warn(`Lead form ${sub.formId} import failed: ${sub.lastError}`);
    }
    await sub.save();
    return { imported };
  }
}
