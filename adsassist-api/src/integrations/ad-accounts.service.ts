import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Queue } from 'bullmq';
import { Model, Types } from 'mongoose';
import { AdAccount, AdAccountDoc, SyncRun } from '../database/schemas/integration.schema.js';
import { AdsSyncJob, defaultJobOptions, QUEUES } from '../queues.js';
import { ConnectionsService } from './connections.service.js';
import { GoogleAdsClient } from './platforms/google-ads.client.js';
import { MetaClient } from './platforms/meta.client.js';

export interface AdAccountPatch {
  syncEnabled?: boolean;
  conversionsEnabled?: boolean;
  metaPixelId?: string;
  googleConversionActionId?: string;
}

@Injectable()
export class AdAccountsService {
  constructor(
    @InjectModel(AdAccount.name) private readonly adAccounts: Model<AdAccount>,
    @InjectModel(SyncRun.name) private readonly runs: Model<SyncRun>,
    @InjectQueue(QUEUES.adsSync) private readonly queue: Queue<AdsSyncJob>,
    private readonly connections: ConnectionsService,
    private readonly google: GoogleAdsClient,
    private readonly meta: MetaClient,
    private readonly config: ConfigService,
  ) {}

  list(workspaceId: Types.ObjectId) {
    return this.adAccounts.find({ workspaceId, status: { $ne: 'disconnected' } }).sort({ platform: 1, name: 1 });
  }

  async get(workspaceId: Types.ObjectId, id: string): Promise<AdAccountDoc> {
    const acc = await this.adAccounts.findOne({ _id: id, workspaceId });
    if (!acc) throw new NotFoundException('Ad account not found');
    return acc;
  }

  /** Links the selected discovered accounts and starts their backfill. */
  async add(workspaceId: Types.ObjectId, connectionId: string, externalIds: string[]) {
    const conn = await this.connections.get(workspaceId, connectionId);
    if (conn.status === 'revoked') throw new BadRequestException('Connection is disconnected');
    const wanted = conn.availableAccounts.filter((a) => externalIds.includes(a.externalId));
    if (!wanted.length) throw new BadRequestException('None of the selected accounts belong to this connection');
    const out: AdAccountDoc[] = [];
    for (const a of wanted) {
      const acc = await this.adAccounts.findOneAndUpdate(
        { workspaceId, platform: conn.platform, externalId: a.externalId },
        {
          $set: {
            connectionId: conn._id,
            name: a.name,
            currency: a.currency,
            timezone: a.timezone,
            loginCustomerId: a.loginCustomerId,
            status: 'active',
            syncEnabled: true,
            lastSyncError: null,
          },
        },
        { upsert: true, returnDocument: 'after' },
      );
      out.push(acc);
      await this.enqueue(acc, acc.backfilled ? 'manual' : 'initial', this.config.get<number>('INITIAL_BACKFILL_DAYS') ?? 30);
    }
    return out;
  }

  async update(workspaceId: Types.ObjectId, id: string, patch: AdAccountPatch) {
    const acc = await this.get(workspaceId, id);
    Object.assign(acc, patch);
    await acc.save();
    return acc;
  }

  async remove(workspaceId: Types.ObjectId, id: string) {
    const acc = await this.get(workspaceId, id);
    acc.status = 'disconnected';
    acc.syncEnabled = false;
    await acc.save();
    return { ok: true };
  }

  async enqueue(acc: AdAccountDoc, trigger: AdsSyncJob['trigger'], days: number) {
    // One queued sync per account and kind; a request while one is pending is a no-op.
    // Finished jobs are removed so the id frees up (history lives in sync_runs).
    await this.queue.add(
      'sync',
      { adAccountId: acc.id, trigger, days },
      {
        ...defaultJobOptions,
        attempts: 3,
        removeOnComplete: true,
        removeOnFail: true,
        jobId: `sync-${acc.id}-${trigger === 'schedule' ? 'auto' : 'manual'}`,
      },
    );
    return { queued: true };
  }

  async syncNow(workspaceId: Types.ObjectId, id: string, days = 3) {
    const acc = await this.get(workspaceId, id);
    if (acc.status === 'disconnected') throw new BadRequestException('Account is disconnected');
    return this.enqueue(acc, 'manual', days);
  }

  async metaPixels(workspaceId: Types.ObjectId, id: string) {
    const acc = await this.get(workspaceId, id);
    if (acc.platform !== 'meta') throw new BadRequestException('Not a Meta ad account');
    return this.meta.listPixels(await this.connections.accessToken(acc.connectionId), acc.externalId);
  }

  async googleConversionActions(workspaceId: Types.ObjectId, id: string) {
    const acc = await this.get(workspaceId, id);
    if (acc.platform !== 'google') throw new BadRequestException('Not a Google Ads account');
    const accessToken = await this.connections.accessToken(acc.connectionId);
    return this.google.listConversionActions({ accessToken, customerId: acc.externalId, loginCustomerId: acc.loginCustomerId });
  }

  syncRuns(workspaceId: Types.ObjectId, adAccountId?: string) {
    const filter: Record<string, unknown> = { workspaceId };
    if (adAccountId) filter.adAccountId = new Types.ObjectId(adAccountId);
    return this.runs.find(filter).sort({ startedAt: -1 }).limit(50);
  }
}
