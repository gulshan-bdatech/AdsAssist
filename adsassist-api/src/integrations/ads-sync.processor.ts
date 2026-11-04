import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Job, Queue } from 'bullmq';
import { Model } from 'mongoose';
import { AdAccount } from '../database/schemas/integration.schema.js';
import { AdsSyncJob, QUEUES } from '../queues.js';
import { AdAccountsService } from './ad-accounts.service.js';
import { AdsSyncService } from './ads-sync.service.js';

@Processor(QUEUES.adsSync, { concurrency: 3 })
export class AdsSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(AdsSyncProcessor.name);

  constructor(
    private readonly sync: AdsSyncService,
    private readonly accounts: AdAccountsService,
    private readonly config: ConfigService,
    @InjectModel(AdAccount.name) private readonly adAccounts: Model<AdAccount>,
  ) {
    super();
  }

  async process(job: Job<AdsSyncJob>) {
    if (job.name === 'sync-all') return this.fanOut();
    return this.sync.run(job.data);
  }

  /** Scheduled tick: queue a short re-sync for every active account. */
  private async fanOut() {
    const days = (this.config.get<number>('SYNC_LOOKBACK_DAYS') ?? 3) + 1;
    const ids = await this.sync.dueAccounts();
    const accounts = await this.adAccounts.find({ _id: { $in: ids } });
    for (const acc of accounts) await this.accounts.enqueue(acc, 'schedule', days);
    this.logger.log(`Scheduled live sync for ${accounts.length} ad account(s)`);
    return { queued: accounts.length };
  }
}

/** Registers the repeating "sync every N minutes" tick (idempotent across restarts and replicas). */
@Injectable()
export class SyncScheduler implements OnApplicationBootstrap {
  constructor(
    @InjectQueue(QUEUES.adsSync) private readonly queue: Queue,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap() {
    const minutes = this.config.get<number>('SYNC_INTERVAL_MINUTES') ?? 15;
    await this.queue.upsertJobScheduler('sync-all', { every: minutes * 60_000 }, { name: 'sync-all', data: {} });
  }
}
