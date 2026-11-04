import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { AnyBulkWriteOperation, Model, Types } from 'mongoose';
import { EventsBus } from '../common/events/events.module.js';
import { addDays, dayInZone } from '../common/utils/dates.js';
import { Ad, AdGroup, Campaign, MetricDaily, MetricLevel, normalizeStatus } from '../database/schemas/ads.schema.js';
import { AdAccount, AdAccountDoc, SyncRun } from '../database/schemas/integration.schema.js';
import type { AdsSyncJob } from '../queues.js';
import { ConnectionsService } from './connections.service.js';
import { GoogleAdsClient } from './platforms/google-ads.client.js';
import { PlatformError } from './platforms/http.js';
import { MetaClient } from './platforms/meta.client.js';

interface EntityRow {
  externalId: string;
  name: string;
  rawStatus: string;
  [k: string]: unknown;
}

interface MetricRow {
  entityExternalId: string;
  campaignExternalId: string;
  adGroupExternalId: string;
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
  platformLeads: number;
  reach: number;
}

interface Snapshot {
  campaigns: EntityRow[];
  adGroups: EntityRow[];
  ads: EntityRow[];
  metrics: Record<MetricLevel, MetricRow[]>;
}

/**
 * Pulls campaigns, ad groups/ad sets, ads and daily metrics for one ad
 * account and writes them idempotently. Re-running the same window replaces
 * the numbers (platforms restate the last few days as conversions settle).
 */
@Injectable()
export class AdsSyncService {
  private readonly logger = new Logger(AdsSyncService.name);

  constructor(
    @InjectModel(AdAccount.name) private readonly adAccounts: Model<AdAccount>,
    @InjectModel(SyncRun.name) private readonly runs: Model<SyncRun>,
    @InjectModel(Campaign.name) private readonly campaigns: Model<Campaign>,
    @InjectModel(AdGroup.name) private readonly adGroups: Model<AdGroup>,
    @InjectModel(Ad.name) private readonly ads: Model<Ad>,
    @InjectModel(MetricDaily.name) private readonly metrics: Model<MetricDaily>,
    private readonly connections: ConnectionsService,
    private readonly google: GoogleAdsClient,
    private readonly meta: MetaClient,
    private readonly bus: EventsBus,
  ) {}

  async run(job: AdsSyncJob) {
    const account = await this.adAccounts.findById(job.adAccountId);
    if (!account || account.status === 'disconnected') return { skipped: 'account missing or disconnected' };
    if (job.trigger === 'schedule' && (!account.syncEnabled || account.status === 'error')) return { skipped: 'sync disabled' };

    // Platforms report in the ad account's own time zone.
    const to = dayInZone(new Date(), account.timezone || 'UTC');
    const from = addDays(to, -Math.max(0, job.days - 1));
    const startedAt = new Date();
    const run = await this.runs.create({
      workspaceId: account.workspaceId,
      adAccountId: account._id,
      platform: account.platform,
      trigger: job.trigger,
      dateFrom: from,
      dateTo: to,
      startedAt,
    });
    await account.updateOne({ lastSyncStatus: 'running' });

    try {
      const token = await this.connections.accessToken(account.connectionId);
      const snap = account.platform === 'google' ? await this.fetchGoogle(account, token, from, to) : await this.fetchMeta(account, token, from, to);
      const stats = await this.persist(account, snap, from, to, startedAt);
      await run.updateOne({ status: 'success', finishedAt: new Date(), stats });
      await account.updateOne({
        lastSyncStatus: 'success',
        lastSyncError: null,
        lastSyncedAt: new Date(),
        status: 'active',
        ...(job.trigger === 'initial' ? { backfilled: true } : {}),
      });
      this.logger.log(`Synced ${account.platform} ${account.externalId} ${from}..${to}: ${JSON.stringify(stats)}`);
      return stats;
    } catch (e) {
      const message = (e as Error).message;
      await run.updateOne({ status: 'failed', finishedAt: new Date(), error: message });
      const revoked = e instanceof PlatformError && e.authRevoked;
      await account.updateOne({ lastSyncStatus: 'failed', lastSyncError: message, ...(revoked ? { status: 'error' } : {}) });
      if (revoked) await this.connections.markRevoked(account.connectionId, message);
      this.bus.emit('sync.failed', account.workspaceId, {
        adAccountId: account.id,
        platform: account.platform,
        name: account.name,
        error: message,
        reconnect: revoked,
      });
      // Auth and permission problems won't fix themselves; don't burn retries on them.
      if (revoked || (e instanceof PlatformError && (e.status === 400 || e.status === 403))) return { error: message };
      throw e;
    }
  }

  private async fetchGoogle(account: AdAccountDoc, accessToken: string, from: string, to: string): Promise<Snapshot> {
    const ctx = { accessToken, customerId: account.externalId, loginCustomerId: account.loginCustomerId };
    const [campaigns, adGroups, ads, metrics] = await Promise.all([
      this.google.fetchCampaigns(ctx),
      this.google.fetchAdGroups(ctx),
      this.google.fetchAds(ctx),
      this.google.fetchMetrics(ctx, from, to),
    ]);
    return { campaigns, adGroups, ads, metrics };
  }

  private async fetchMeta(account: AdAccountDoc, accessToken: string, from: string, to: string): Promise<Snapshot> {
    const id = account.externalId;
    const [campaigns, adGroups, ads, metrics] = await Promise.all([
      this.meta.fetchCampaigns(accessToken, id),
      this.meta.fetchAdSets(accessToken, id),
      this.meta.fetchAds(accessToken, id),
      this.meta.fetchMetrics(accessToken, id, from, to),
    ]);
    return { campaigns, adGroups, ads, metrics };
  }

  private entityOps<T extends EntityRow>(account: AdAccountDoc, rows: T[]): AnyBulkWriteOperation<any>[] {
    return rows.map(({ externalId, rawStatus, ...rest }) => ({
      updateOne: {
        filter: { adAccountId: account._id, externalId },
        update: {
          $set: { ...rest, rawStatus, status: normalizeStatus(rawStatus) },
          $setOnInsert: { workspaceId: account.workspaceId, platform: account.platform },
        },
        upsert: true,
      },
    }));
  }

  private async persist(account: AdAccountDoc, snap: Snapshot, from: string, to: string, syncedAt: Date) {
    const write = async (model: Model<any>, ops: AnyBulkWriteOperation<any>[]) => {
      for (let i = 0; i < ops.length; i += 1000) await model.bulkWrite(ops.slice(i, i + 1000), { ordered: false });
    };
    await write(this.campaigns, this.entityOps(account, snap.campaigns));
    await write(this.adGroups, this.entityOps(account, snap.adGroups));
    await write(this.ads, this.entityOps(account, snap.ads));

    let metricRows = 0;
    for (const level of ['campaign', 'ad_group', 'ad'] as MetricLevel[]) {
      const rows = snap.metrics[level].filter((r) => r.entityExternalId && r.date);
      metricRows += rows.length;
      await write(
        this.metrics,
        rows.map((r) => ({
          updateOne: {
            filter: { adAccountId: account._id, level, entityExternalId: r.entityExternalId, date: r.date },
            update: {
              $set: { ...r, syncedAt },
              $setOnInsert: { workspaceId: account.workspaceId, platform: account.platform, level },
            },
            upsert: true,
          },
        })),
      );
      // Rows in this window that the platform no longer reports (e.g. spend reversed to zero).
      await this.metrics.deleteMany({ adAccountId: account._id, level, date: { $gte: from, $lte: to }, syncedAt: { $lt: syncedAt } });
    }
    return { campaigns: snap.campaigns.length, adGroups: snap.adGroups.length, ads: snap.ads.length, metricRows };
  }

  /** Accounts the scheduler should refresh. */
  async dueAccounts(): Promise<Types.ObjectId[]> {
    const rows = await this.adAccounts.find({ syncEnabled: true, status: 'active' }, { _id: 1 });
    return rows.map((r) => r._id as Types.ObjectId);
  }
}
