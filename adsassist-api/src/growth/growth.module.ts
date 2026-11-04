import { BullModule, InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, Module, OnApplicationBootstrap } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { LeadsModule } from '../leads/leads.module.js';
import { AutomationJob, QUEUES } from '../queues.js';
import { ReportsModule } from '../reports/reports.module.js';
import { TrackingModule } from '../tracking/tracking.module.js';
import { AiService } from './ai.service.js';
import { AlertsService } from './alerts.service.js';
import { AudiencesService } from './audiences.service.js';
import { CompetitorsService } from './competitors.service.js';
import { DigestService } from './digest.service.js';
import { EmailTrackingService } from './email-tracking.service.js';
import { EmailTrackingController, GrowthController, SystemController } from './growth.controllers.js';
import { LeadFormsService } from './lead-forms.service.js';
import { NotificationsService } from './notifications.service.js';
import { WebhooksService } from './webhooks.service.js';

@Processor(QUEUES.automation, { concurrency: 5 })
export class AutomationProcessor extends WorkerHost {
  private readonly logger = new Logger(AutomationProcessor.name);

  constructor(
    private readonly audiences: AudiencesService,
    private readonly webhooks: WebhooksService,
    private readonly alerts: AlertsService,
    private readonly digests: DigestService,
    private readonly forms: LeadFormsService,
    private readonly competitors: CompetitorsService,
  ) {
    super();
  }

  async process(job: Job) {
    const j = { name: job.name, data: job.data } as AutomationJob;
    switch (j.name) {
      case 'audience-sync':
        return this.audiences.sync(j.data.audienceId);
      case 'webhook-deliver':
        // The last BullMQ attempt marks the delivery failed instead of pending.
        return this.webhooks.deliver(j.data.deliveryId, job.attemptsMade + 1 >= (job.opts.attempts ?? 1));
      case 'leadform-import':
        return this.forms.import(j.data.subscriptionId);
      case 'competitor-refresh':
        return this.competitors.refresh(j.data.watchId);
      case 'tick-alerts':
        return this.alerts.tick();
      case 'tick-digests':
        return this.digests.tick();
      case 'tick-audiences':
        return this.audiences.tick();
      case 'tick-leadforms':
        return this.forms.tick();
      case 'tick-competitors':
        return this.competitors.tick();
      default:
        this.logger.warn(`Unknown automation job ${job.name}`);
        return null;
    }
  }
}

const MIN = 60_000;
const SCHEDULE: [AutomationJob['name'], number][] = [
  ['tick-alerts', 15 * MIN],
  ['tick-leadforms', 15 * MIN],
  ['tick-digests', 60 * MIN],
  ['tick-audiences', 6 * 60 * MIN],
  ['tick-competitors', 24 * 60 * MIN],
];

@Injectable()
export class AutomationScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue(QUEUES.automation) private readonly queue: Queue) {}

  async onApplicationBootstrap() {
    for (const [name, every] of SCHEDULE) await this.queue.upsertJobScheduler(name, { every }, { name, data: {} });
  }
}

const workers = process.env.RUN_WORKERS === 'false' ? [] : [AutomationProcessor, AutomationScheduler];

@Module({
  imports: [IntegrationsModule, LeadsModule, ReportsModule, TrackingModule, BullModule.registerQueue({ name: QUEUES.automation })],
  controllers: [SystemController, GrowthController, EmailTrackingController],
  providers: [
    NotificationsService,
    AlertsService,
    AiService,
    DigestService,
    WebhooksService,
    AudiencesService,
    EmailTrackingService,
    LeadFormsService,
    CompetitorsService,
    ...workers,
  ],
})
export class GrowthModule {}
