import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Queue } from 'bullmq';
import { isValidObjectId, Model, Types } from 'mongoose';
import { CompetitorAd, CompetitorWatch, CompetitorWatchDoc } from '../database/schemas/growth.schema.js';
import { PlatformConnection } from '../database/schemas/integration.schema.js';
import { ConnectionsService } from '../integrations/connections.service.js';
import { MetaClient } from '../integrations/platforms/meta.client.js';
import { AutomationJob, QUEUES } from '../queues.js';

/**
 * Competitor ads from the official Meta Ad Library API. Meta only returns
 * every ad for EU/UK delivery; elsewhere the API is limited to
 * political/issue ads, which the UI explains.
 */
@Injectable()
export class CompetitorsService {
  constructor(
    @InjectModel(CompetitorWatch.name) private readonly watches: Model<CompetitorWatch>,
    @InjectModel(CompetitorAd.name) private readonly ads: Model<CompetitorAd>,
    @InjectModel(PlatformConnection.name) private readonly connectionsModel: Model<PlatformConnection>,
    @InjectQueue(QUEUES.automation) private readonly queue: Queue,
    private readonly connections: ConnectionsService,
    private readonly meta: MetaClient,
    private readonly config: ConfigService,
  ) {}

  private async view(w: CompetitorWatchDoc) {
    const [adCount, activeAdCount] = await Promise.all([
      this.ads.countDocuments({ watchId: w._id }),
      this.ads.countDocuments({ watchId: w._id, active: true }),
    ]);
    return { ...w.toJSON(), adCount, activeAdCount };
  }

  async list(workspaceId: Types.ObjectId) {
    const rows = await this.watches.find({ workspaceId }).sort({ createdAt: -1 });
    return Promise.all(rows.map((w) => this.view(w)));
  }

  private async get(workspaceId: Types.ObjectId, id: string) {
    const w = isValidObjectId(id) ? await this.watches.findOne({ _id: id, workspaceId }) : null;
    if (!w) throw new NotFoundException('Competitor not found');
    return w;
  }

  async create(workspaceId: Types.ObjectId, input: { name: string; pageIds?: string[]; searchTerms?: string; countries: string[] }) {
    const pageIds = (input.pageIds ?? []).map((p) => p.trim()).filter((p) => /^\d{5,20}$/.test(p));
    const searchTerms = input.searchTerms?.trim() ?? '';
    if (!pageIds.length && !searchTerms) throw new BadRequestException('Give at least one numeric Facebook Page ID or search terms');
    const w = await this.watches.create({
      workspaceId,
      name: input.name.trim(),
      pageIds,
      searchTerms,
      countries: input.countries.map((c) => c.toUpperCase()),
    });
    await this.enqueue(w);
    return this.view(w);
  }

  async remove(workspaceId: Types.ObjectId, id: string) {
    const w = await this.get(workspaceId, id);
    await this.ads.deleteMany({ watchId: w._id });
    await w.deleteOne();
    return { ok: true };
  }

  private enqueue(w: CompetitorWatchDoc) {
    const job: AutomationJob = { name: 'competitor-refresh', data: { watchId: w.id } };
    return this.queue.add(job.name, job.data, { jobId: `competitor-${w.id}`, attempts: 2, removeOnComplete: true, removeOnFail: true });
  }

  async refreshNow(workspaceId: Types.ObjectId, id: string) {
    await this.enqueue(await this.get(workspaceId, id));
    return { queued: true };
  }

  async listAds(workspaceId: Types.ObjectId, id: string, q: { active?: boolean; page: number; pageSize: number }) {
    const w = await this.get(workspaceId, id);
    const filter: Record<string, unknown> = { watchId: w._id };
    if (q.active) filter.active = true;
    const [items, total] = await Promise.all([
      this.ads.find(filter).sort({ active: -1, startedAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize),
      this.ads.countDocuments(filter),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  private async token(workspaceId: Types.ObjectId) {
    const override = this.config.get<string>('META_AD_LIBRARY_TOKEN');
    if (override) return override;
    const conn = await this.connectionsModel.findOne({ workspaceId, platform: 'meta', status: 'active' });
    if (!conn) throw new Error('Connect a Meta account (or set META_AD_LIBRARY_TOKEN) to read the Ad Library');
    return this.connections.accessToken(conn._id);
  }

  async refresh(watchId: string) {
    const w = await this.watches.findById(watchId);
    if (!w) return { skipped: true };
    try {
      const rows = await this.meta.adsArchive(await this.token(w.workspaceId), { pageIds: w.pageIds, searchTerms: w.searchTerms, countries: w.countries });
      const ops = rows.map((r) => ({
        updateOne: {
          filter: { watchId: w._id, adArchiveId: String(r.id) },
          update: {
            $set: {
              workspaceId: w.workspaceId,
              pageId: String(r.page_id ?? ''),
              pageName: r.page_name ?? '',
              bodies: r.ad_creative_bodies ?? [],
              titles: r.ad_creative_link_titles ?? [],
              descriptions: r.ad_creative_link_descriptions ?? [],
              snapshotUrl: r.ad_snapshot_url ?? '',
              platforms: r.publisher_platforms ?? [],
              startedAt: r.ad_delivery_start_time ?? null,
              stoppedAt: r.ad_delivery_stop_time ?? null,
              active: !r.ad_delivery_stop_time,
            },
            $setOnInsert: { firstSeenAt: new Date() },
          },
          upsert: true,
        },
      }));
      if (ops.length) await this.ads.bulkWrite(ops, { ordered: false });
      await w.updateOne({ lastFetchedAt: new Date(), lastError: null });
      return { ads: rows.length };
    } catch (e) {
      await w.updateOne({ lastError: (e as Error).message });
      return { error: (e as Error).message };
    }
  }

  async tick() {
    const rows = await this.watches.find({});
    for (const w of rows) await this.enqueue(w);
    return { queued: rows.length };
  }
}
