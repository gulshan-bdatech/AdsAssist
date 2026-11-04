import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import type { WebhookEvent } from '../../database/schemas/growth.schema.js';

/** Internal events are not offered as webhooks. */
export type BusEvent = WebhookEvent | 'sync.failed';

export interface DomainEvent {
  type: BusEvent;
  workspaceId: string;
  data: Record<string, unknown>;
  at: Date;
}

/**
 * In-process bus for business events (lead created, conversion failed…).
 * Producers stay unaware of who listens; webhooks and notifications
 * subscribe. Listener errors are logged and never reach the producer.
 */
@Injectable()
export class EventsBus {
  private readonly logger = new Logger(EventsBus.name);
  private readonly emitter = new EventEmitter({ captureRejections: false });

  constructor() {
    this.emitter.setMaxListeners(50);
  }

  emit(type: BusEvent, workspaceId: unknown, data: Record<string, unknown>) {
    const event: DomainEvent = { type, workspaceId: String(workspaceId), data, at: new Date() };
    this.emitter.emit('event', event);
  }

  on(handler: (event: DomainEvent) => Promise<unknown> | unknown) {
    this.emitter.on('event', (event: DomainEvent) => {
      Promise.resolve()
        .then(() => handler(event))
        .catch((e: Error) => this.logger.error(`listener failed for ${event.type}: ${e.message}`));
    });
  }
}

@Global()
@Module({ providers: [EventsBus], exports: [EventsBus] })
export class EventsModule {}
