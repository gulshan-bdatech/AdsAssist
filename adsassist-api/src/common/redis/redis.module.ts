import { Global, Inject, Injectable, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

export const REDIS = Symbol('REDIS');

/**
 * Shared Redis connection for rate limiting and pub/sub publishing, plus a
 * lazily created subscriber (a subscribed connection can't run other commands).
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private subscriber: Redis | null = null;
  private readonly handlers = new Map<string, Set<(message: string) => void>>();

  constructor(
    @Inject(REDIS) readonly client: Redis,
    private readonly config: ConfigService,
  ) {}

  /** Fixed-window counter. Returns true while the caller is under `limit` per `windowSec`. */
  async allow(key: string, limit: number, windowSec = 60): Promise<boolean> {
    const bucket = `rl:${key}:${Math.floor(Date.now() / 1000 / windowSec)}`;
    const count = await this.client.incr(bucket);
    if (count === 1) await this.client.expire(bucket, windowSec + 1);
    return count <= limit;
  }

  publish(channel: string, payload: unknown) {
    return this.client.publish(channel, JSON.stringify(payload));
  }

  async subscribe(channel: string, handler: (message: string) => void): Promise<() => Promise<void>> {
    if (!this.subscriber) {
      this.subscriber = new Redis(this.config.getOrThrow('REDIS_URL'), { lazyConnect: false });
      this.subscriber.on('message', (ch: string, msg: string) => this.handlers.get(ch)?.forEach((h) => h(msg)));
      this.subscriber.on('error', (e: Error & { code?: string }) => this.logger.warn(`subscriber: ${e.message || e.code}`));
    }
    let set = this.handlers.get(channel);
    if (!set) {
      set = new Set();
      this.handlers.set(channel, set);
      await this.subscriber.subscribe(channel);
    }
    set.add(handler);
    return async () => {
      set.delete(handler);
      if (set.size === 0) {
        this.handlers.delete(channel);
        await this.subscriber?.unsubscribe(channel);
      }
    };
  }

  async onModuleDestroy() {
    await this.subscriber?.quit().catch(() => undefined);
    await this.client.quit().catch(() => undefined);
  }
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const client = new Redis(config.getOrThrow('REDIS_URL'), { maxRetriesPerRequest: 2 });
        client.on('error', (e: Error & { code?: string }) => new Logger('Redis').warn(e.message || e.code || 'connection error'));
        return client;
      },
    },
    RedisService,
  ],
  exports: [REDIS, RedisService],
})
export class RedisModule {}
