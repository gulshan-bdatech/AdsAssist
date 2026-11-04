import { BullModule } from '@nestjs/bullmq';
import { Controller, Get, Inject, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { InjectConnection } from '@nestjs/mongoose';
import { SkipThrottle, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { Redis } from 'ioredis';
import type { Connection } from 'mongoose';
import { AuthModule } from './auth/auth.module.js';
import { Public } from './common/auth/decorators.js';
import { JwtAuthGuard } from './common/auth/guards.js';
import { EventsModule } from './common/events/events.module.js';
import { MailerModule } from './common/mailer/mailer.module.js';
import { REDIS, RedisModule } from './common/redis/redis.module.js';
import { validateEnv } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';
import { GrowthModule } from './growth/growth.module.js';
import { IntegrationsModule } from './integrations/integrations.module.js';
import { LeadsModule } from './leads/leads.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { TrackingModule } from './tracking/tracking.module.js';
import { WorkspacesModule } from './workspaces/workspaces.module.js';

@Controller('health')
class HealthController {
  constructor(
    @InjectConnection() private readonly mongo: Connection,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Public()
  @SkipThrottle()
  @Get()
  async health() {
    const redisUp = await this.redis
      .ping()
      .then((r) => r === 'PONG')
      .catch(() => false);
    return { status: 'ok', mongo: this.mongo.readyState === 1 ? 'up' : 'down', redis: redisUp ? 'up' : 'down' };
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: config.get('JWT_EXPIRES_IN') ?? '7d' },
      }),
    }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 300 }]),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = new URL(config.getOrThrow<string>('REDIS_URL'));
        return {
          connection: {
            host: url.hostname,
            port: Number(url.port || 6379),
            username: url.username || undefined,
            password: url.password ? decodeURIComponent(url.password) : undefined,
            db: Number(url.pathname.slice(1) || 0),
            tls: url.protocol === 'rediss:' ? {} : undefined,
            family: 0,
          },
          prefix: 'adsassist',
        };
      },
    }),
    DatabaseModule,
    RedisModule,
    EventsModule,
    MailerModule,
    WorkspacesModule,
    AuthModule,
    IntegrationsModule,
    LeadsModule,
    TrackingModule,
    ReportsModule,
    GrowthModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
