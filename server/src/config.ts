import { z } from 'zod';
import { ARGON2_MINIMUMS } from './auth/users.js';

/** Rates must not travel in cleartext; a local stub (tests, QA against a local server) may use plain http. */
function isHttpsOrLocalHttp(value: string): boolean {
  // zod runs a refine even after .url() has failed; a value URL can't parse is reported by .url().
  if (!URL.canParse(value)) return true;
  const url = new URL(value);
  return url.protocol === 'https:' || (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1'));
}

/** ADR-091 D5: the same EU-region rule as the Sentry module's sentry_key postcondition. */
export const SENTRY_EU_DSN =/^https:\/\/[A-Za-z0-9]+@[A-Za-z0-9.-]+\.ingest\.de\.sentry\.io\/\d+$/;

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
  /** MUT-228: the ECB reference-rate provider's `latest` endpoint, how long a snapshot is fresh, and how long to wait for it. */
  FX_RATES_URL: z
    .string()
    .url()
    .refine(isHttpsOrLocalHttp, 'must be https (plain http only for localhost or 127.0.0.1)')
    .default('https://api.frankfurter.dev/v1/latest'),
  FX_RATES_TTL_MINUTES: z.coerce.number().int().min(15).max(1440).default(240),
  FX_RATES_TIMEOUT_MS: z.coerce.number().int().min(500).max(10_000).default(3000),
  /** argon2id cost for user passwords (MUT-37). Never below OWASP profile 1. */
  ARGON2_MEMORY_KIB: z.coerce.number().int().min(ARGON2_MINIMUMS.memoryKiB).default(ARGON2_MINIMUMS.memoryKiB),
  ARGON2_TIME_COST: z.coerce.number().int().min(ARGON2_MINIMUMS.timeCost).default(ARGON2_MINIMUMS.timeCost),
  ARGON2_PARALLELISM: z.coerce.number().int().min(ARGON2_MINIMUMS.parallelism).default(ARGON2_MINIMUMS.parallelism),
  /** HMAC key for session-token digests (MUT-38). Secret Manager; rotating it signs every user out. */
  SESSION_TOKEN_PEPPER: z.string().min(32, 'SESSION_TOKEN_PEPPER must be at least 32 characters'),
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(1440).default(120),
  SESSION_ABSOLUTE_HOURS: z.coerce.number().int().min(1).max(168).default(12),
  /** Device-session (MUT-64) lifetime: longer than a browser session because capture happens days apart. */
  DEVICE_SESSION_IDLE_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  DEVICE_SESSION_ABSOLUTE_DAYS: z.coerce.number().int().min(1).max(730).default(180),
  /** The portal's public origin; non-GET session requests must come from it. Unset = compare with the request's own origin. */
  PORTAL_ORIGIN: z.string().url().optional(),
  /** How many proxies in front of the service append to X-Forwarded-For (Cloud Run front end = 1; a load balancer adds one). */
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
  /** Built hosted-portal assets (MUT-45), mounted by the Dockerfile. Unset = the server serves no portal, API-only. */
  PORTAL_DIST_DIR: z.string().min(1).optional(),
  /** iOS/Android app-association files (MUT-111): all four or none — see the superRefine below. */
  APPLE_TEAM_ID: z.string().min(1).optional(),
  APPLE_BUNDLE_ID: z.string().min(1).optional(),
  ANDROID_PACKAGE_NAME: z.string().min(1).optional(),
  /** Comma-separated SHA-256 cert fingerprints (debug + upload-key at minimum, MUT-114). Split into an array in index.ts. */
  ANDROID_SHA256_FINGERPRINTS: z.string().min(1).optional(),
  /**
   * MUT-293: the lowest phone build still served, per platform. Absent = that
   * platform is never gated. `*_RECOMMENDED_BUILD` is the softer "update
   * available" ceiling below which the phone gets a nudge, not a block.
   */
  IOS_MIN_BUILD: z.coerce.number().int().positive().optional(),
  ANDROID_MIN_BUILD: z.coerce.number().int().positive().optional(),
  IOS_RECOMMENDED_BUILD: z.coerce.number().int().positive().optional(),
  ANDROID_RECOMMENDED_BUILD: z.coerce.number().int().positive().optional(),
  /** Instant kill switch for the minimum-build gate, independent of the floor values — a misconfigured floor is undone by flipping this, not editing/redeploying the floor itself. */
  MIN_BUILD_CHECK_DISABLED: z.coerce.boolean().default(false),
  /**
   * MUT-326 (ADR-155 D3): the custom domain's front door proves itself with this secret
   * (Secret Manager, written by server/infrastructure/frontdoor). Needs PORTAL_ORIGIN.
   * Unset = no front door: every request is judged exactly as before.
   */
  FRONT_DOOR_TOKEN: z.string().min(32, 'FRONT_DOOR_TOKEN must be at least 32 characters').optional(),
  /**
   * MUT-326 stage "redirect": portal page visits that bypass the front door go to the
   * same-origin carry-over page, which sends them on to PORTAL_ORIGIN. Only "true" turns
   * it on (never z.coerce.boolean, which reads "false" as true). Needs FRONT_DOOR_TOKEN.
   */
  PORTAL_LEGACY_REDIRECT: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  /**
   * MUT-360: Stripe (Secret Manager, mounted only once stripe_enabled is applied). A restricted key, read-only on
   * billing objects; both or neither — unset, the webhook and reconcile answer 503. A live key only where
   * API_KEY_ENVIRONMENT is live, so a test server can never read the real account.
   */
  STRIPE_SECRET_KEY: z.string().regex(/^(rk|sk)_(test|live)_[A-Za-z0-9_]+$/, 'must be a Stripe secret or restricted key (sk_/rk_)').optional(),
  STRIPE_WEBHOOK_SECRET: z.string().regex(/^whsec_[A-Za-z0-9_]+$/, 'must be a Stripe webhook signing secret (whsec_)').optional(),
  /** MUT-360 D2: the nightly Scheduler job's X-Job-Token (Terraform-generated). Unset = /jobs/* answers 503. */
  MUTABA3A_JOB_TOKEN: z.string().min(32, 'MUTABA3A_JOB_TOKEN must be at least 32 characters').optional(),
  /**
   * MUT-148 (ADR-091): the api project's DSN (Secret Manager, mounted once sentry_enabled is applied). Unset = no
   * error reports. Only an EU-region DSN starts: a US one would send events outside the region ADR-091 chose (D5).
   */
  SENTRY_DSN: z.string().regex(SENTRY_EU_DSN, 'must be an https DSN on the EU region, https://<key>@<org>.ingest.de.sentry.io/<project>').optional(),
  /** The environment events are filed under. Unset = NODE_ENV. */
  SENTRY_ENVIRONMENT: z.string().min(1).max(64).optional(),
});

const APP_ASSOCIATION_KEYS = ['APPLE_TEAM_ID', 'APPLE_BUNDLE_ID', 'ANDROID_PACKAGE_NAME', 'ANDROID_SHA256_FINGERPRINTS'] as const;
const MIN_BUILD_PLATFORMS = [
  { min: 'IOS_MIN_BUILD', recommended: 'IOS_RECOMMENDED_BUILD' },
  { min: 'ANDROID_MIN_BUILD', recommended: 'ANDROID_RECOMMENDED_BUILD' },
] as const;

/** `loadConfig` fills SENTRY_ENVIRONMENT in from NODE_ENV, so it is always set. */
export type Config = Omit<z.infer<typeof envSchema>, 'SENTRY_ENVIRONMENT'> & { SENTRY_ENVIRONMENT: string };

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
  const config = parsed.data;
  const setKeys = APP_ASSOCIATION_KEYS.filter((key) => config[key] !== undefined);
  if (setKeys.length > 0 && setKeys.length < APP_ASSOCIATION_KEYS.length) {
    const missing = APP_ASSOCIATION_KEYS.filter((key) => !setKeys.includes(key));
    throw new ConfigError(
      `Invalid configuration:\n  app association (${APP_ASSOCIATION_KEYS.join(', ')}): all four or none must be set; missing ${missing.join(', ')}`,
    );
  }
  // A string like "," passes the schema's min(1), but every entry is blank
  // once well-known.ts trims and filters it — refuse at boot rather than
  // silently serving assetlinks.json with an empty fingerprint list.
  if (config.ANDROID_SHA256_FINGERPRINTS && !config.ANDROID_SHA256_FINGERPRINTS.split(',').some((fp) => fp.trim().length > 0)) {
    throw new ConfigError('Invalid configuration:\n  ANDROID_SHA256_FINGERPRINTS: must contain at least one non-blank fingerprint');
  }
  if (config.FRONT_DOOR_TOKEN && !config.PORTAL_ORIGIN) {
    throw new ConfigError('Invalid configuration:\n  FRONT_DOOR_TOKEN: needs PORTAL_ORIGIN, the origin the front door serves the portal on');
  }
  if (config.PORTAL_LEGACY_REDIRECT && !config.FRONT_DOOR_TOKEN) {
    throw new ConfigError('Invalid configuration:\n  PORTAL_LEGACY_REDIRECT: needs FRONT_DOOR_TOKEN, or every visit would be redirected, the new host\'s included');
  }
  if ((config.STRIPE_SECRET_KEY === undefined) !== (config.STRIPE_WEBHOOK_SECRET === undefined)) {
    const missing = config.STRIPE_SECRET_KEY === undefined ? 'STRIPE_SECRET_KEY' : 'STRIPE_WEBHOOK_SECRET';
    throw new ConfigError(`Invalid configuration:\n  ${missing}: STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are set together or not at all`);
  }
  if (config.STRIPE_SECRET_KEY && /^(rk|sk)_live_/.test(config.STRIPE_SECRET_KEY) && config.API_KEY_ENVIRONMENT !== 'live') {
    throw new ConfigError('Invalid configuration:\n  STRIPE_SECRET_KEY: a live Stripe key needs API_KEY_ENVIRONMENT=live');
  }
  // MUT-360 review: the live server reads billing objects only, so a full-access key (or a test key, whose test-mode
  // subscriptions would then cover real people) is refused there.
  if (config.STRIPE_SECRET_KEY && config.API_KEY_ENVIRONMENT === 'live' && !/^rk_live_/.test(config.STRIPE_SECRET_KEY)) {
    throw new ConfigError('Invalid configuration:\n  STRIPE_SECRET_KEY: a live server needs a restricted live key (rk_live_…), never sk_ or a test key');
  }
  for (const { min, recommended } of MIN_BUILD_PLATFORMS) {
    const floor = config[min];
    const target = config[recommended];
    if (floor !== undefined && target !== undefined && target < floor) {
      throw new ConfigError(`Invalid configuration:\n  ${recommended}: must be >= ${min} (${target} < ${floor})`);
    }
  }
  return { ...config, SENTRY_ENVIRONMENT: config.SENTRY_ENVIRONMENT ?? config.NODE_ENV };
}
