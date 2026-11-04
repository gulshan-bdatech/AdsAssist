import { plainToInstance, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

/**
 * Every environment variable the API reads. Validated once at boot so a
 * missing secret fails fast instead of on the first OAuth or sync call.
 */
export class Env {
  @IsIn(['development', 'production', 'test'])
  NODE_ENV: 'development' | 'production' | 'test' = 'development';

  @Type(() => Number)
  @IsInt()
  PORT = 4000;

  @IsString()
  API_URL = 'http://localhost:4000';

  @IsString()
  WEB_URL = 'http://localhost:3000';

  @IsString()
  CORS_ORIGINS = 'http://localhost:3000';

  @Type(() => Boolean)
  @IsBoolean()
  RUN_WORKERS = true;

  @IsString()
  MONGODB_URI: string;

  @IsString()
  REDIS_URL = 'redis://localhost:6379/0';

  @IsString()
  @MinLength(32)
  JWT_SECRET: string;

  @IsString()
  JWT_EXPIRES_IN = '7d';

  @IsString()
  @MinLength(32)
  TOKEN_ENCRYPTION_KEY: string;

  @Type(() => Number)
  @IsInt()
  RATE_LIMIT_PER_MIN = 120;

  @IsOptional() @IsString() GOOGLE_ADS_CLIENT_ID = '';
  @IsOptional() @IsString() GOOGLE_ADS_CLIENT_SECRET = '';
  @IsOptional() @IsString() GOOGLE_ADS_DEVELOPER_TOKEN = '';
  @IsOptional() @IsString() GOOGLE_ADS_LOGIN_CUSTOMER_ID = '';
  @IsString() GOOGLE_ADS_API_VERSION = 'v24';
  @IsOptional() @IsString() GOOGLE_OAUTH_REDIRECT_URI = '';

  @IsOptional() @IsString() META_APP_ID = '';
  @IsOptional() @IsString() META_APP_SECRET = '';
  @IsString() META_API_VERSION = 'v24.0';
  @IsOptional() @IsString() META_OAUTH_REDIRECT_URI = '';

  @IsOptional() @IsString() SMTP_HOST = '';
  @Type(() => Number) @IsInt() SMTP_PORT = 587;
  @IsOptional() @IsString() SMTP_USER = '';
  @IsOptional() @IsString() SMTP_PASS = '';
  @IsOptional() @IsString() SMTP_FROM = '';

  @IsOptional() @IsString() ANTHROPIC_API_KEY = '';
  @IsString() ANTHROPIC_MODEL = 'claude-opus-5-5';

  /** Optional token for the Meta Ad Library API; defaults to the workspace's Meta connection. */
  @IsOptional() @IsString() META_AD_LIBRARY_TOKEN = '';

  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(1440)
  SYNC_INTERVAL_MINUTES = 15;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(30)
  SYNC_LOOKBACK_DAYS = 3;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  INITIAL_BACKFILL_DAYS = 30;
}

export function validateEnv(raw: Record<string, unknown>): Env {
  // class-transformer turns "false" into true for Boolean, so normalise first.
  const input = { ...raw };
  if (typeof input.RUN_WORKERS === 'string') {
    input.RUN_WORKERS = input.RUN_WORKERS.toLowerCase() !== 'false';
  }
  for (const key of Object.keys(input)) {
    if (input[key] === '') delete input[key];
  }
  const env = plainToInstance(Env, input, { exposeDefaultValues: true });
  const errors = validateSync(env, { skipMissingProperties: false });
  if (errors.length) {
    const lines = errors.map((e) => `  ${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`);
    throw new Error(`Invalid environment:\n${lines.join('\n')}`);
  }
  return env;
}
