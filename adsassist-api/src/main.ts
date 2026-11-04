import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import express from 'express';
import helmet from 'helmet';

// Load .env before any module reads process.env (e.g. RUN_WORKERS when modules are declared).
try {
  process.loadEnvFile();
} catch {
  // no .env file: rely on the real environment
}

const { preflight } = await import('./preflight.js');
await preflight();

const { AppModule } = await import('./app.module.js');

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });
  const origins = (process.env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);

  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  // The pixel posts text/plain (CORS simple request) from any site.
  app.use('/api/v1/events', express.text({ type: 'text/plain', limit: '64kb' }));
  app.enableCors({
    origin: (origin, cb) => cb(null, !origin || origins.includes(origin) ? true : false),
    credentials: true,
  });
  app.use('/api/v1/events', (_req: express.Request, res: express.Response, next: express.NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    next();
  });
  app.setGlobalPrefix('api', { exclude: ['pixel.js'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidUnknownValues: false }));
  app.enableShutdownHooks();

  const docs = new DocumentBuilder()
    .setTitle('AdsAssist API')
    .setDescription('Live Google Ads + Meta reporting, tracking pixel, identity, leads and conversion push. See API.md.')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, docs));

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  Logger.log(`AdsAssist API on http://localhost:${port}  (docs: /docs)`, 'Bootstrap');
}

await bootstrap();
