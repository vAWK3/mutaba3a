import { z } from 'zod';
import { ARGON2_MINIMUMS } from './auth/users.js';

/**
 * Validated process configuration. Fails fast at boot with a readable list of
 * what is missing — a half-configured ledger service must not start.
 *
 * Nothing here is read anywhere else via `process.env`; every consumer takes
 * a `Config` so tests can construct one without touching the environment.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().url(),
  MUTABA3A_ADMIN_TOKEN: z.string().min(32, 'MUTABA3A_ADMIN_TOKEN must be at least 32 characters'),
  API_KEY_ENVIRONMENT: z.enum(['live', 'test']),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(300),
  SERVICE_VERSION: z.string().min(1).default('0.0.0-dev'),
  /** Private GCS bucket for attachments (M6). Absent = attachments routes answer 503 ATTACHMENTS_NOT_CONFIGURED. */
  ATTACHMENTS_BUCKET: z.string().min(3).optional(),
  ATTACHMENTS_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  /** argon2id cost for user passwords (MUT-37). Never below OWASP profile 1. */
  ARGON2_MEMORY_KIB: z.coerce.number().int().min(ARGON2_MINIMUMS.memoryKiB).default(ARGON2_MINIMUMS.memoryKiB),
  ARGON2_TIME_COST: z.coerce.number().int().min(ARGON2_MINIMUMS.timeCost).default(ARGON2_MINIMUMS.timeCost),
  ARGON2_PARALLELISM: z.coerce.number().int().min(ARGON2_MINIMUMS.parallelism).default(ARGON2_MINIMUMS.parallelism),
  /** HMAC key for session-token digests (MUT-38). Secret Manager; rotating it signs every user out. */
  SESSION_TOKEN_PEPPER: z.string().min(32, 'SESSION_TOKEN_PEPPER must be at least 32 characters'),
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(1440).default(120),
  SESSION_ABSOLUTE_HOURS: z.coerce.number().int().min(1).max(168).default(12),
  /** The portal's public origin; non-GET session requests must come from it. Unset = compare with the request's own origin. */
  PORTAL_ORIGIN: z.string().url().optional(),
  /** How many proxies in front of the service append to X-Forwarded-For (Cloud Run front end = 1; a load balancer adds one). */
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
});

export type Config = z.infer<typeof envSchema>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new ConfigError(`Invalid configuration:\n${lines.join('\n')}`);
  }
  return parsed.data;
}
