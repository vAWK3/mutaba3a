import { isIP } from 'node:net';
import { dirname, isAbsolute, resolve } from 'node:path';
import { webauthnConfigOf } from './auth/webauthn.js';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { ARGON2_MINIMUMS } from './auth/users.js';
import { isUnownedDomain } from './email/ports.js';
import { isTurnstileTestSecret, TURNSTILE_TEST_SECRETS } from './auth/turnstile.js';
import { SELF_SERVICE_POLICY } from './auth/self-service.js';

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
  /**
   * MUT-463: the address to listen on; local QA servers set 127.0.0.1. Unset = Node's default, every interface (Cloud
   * Run). IP addresses only: a name binds to its first resolved address, and localhost resolves to ::1 first on macOS.
   */
  HOST: z.string().refine((value) => isIP(value) !== 0, 'must be an IP address, such as 127.0.0.1').optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().url(),
  MUTABA3A_ADMIN_TOKEN: z.string().min(32, 'MUTABA3A_ADMIN_TOKEN must be at least 32 characters'),
  API_KEY_ENVIRONMENT: z.enum(['live', 'test']),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(300),
  SERVICE_VERSION: z.string().min(1).default('0.0.0-dev'),
  /** Private GCS bucket for attachments (M6). Absent = attachments routes answer 503 ATTACHMENTS_NOT_CONFIGURED. */
  ATTACHMENTS_BUCKET: z.string().min(3).optional(),
  ATTACHMENTS_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  /**
   * MUT-396: where attachment bytes live. Unset = GCS when ATTACHMENTS_BUCKET is set, else none (503). `local` keeps
   * them on disk under ATTACHMENTS_DIR and serves their signed URLs at /dev/attachments: for the dev server and local
   * QA only, refused in production and staging.
   */
  ATTACHMENTS_DRIVER: z.enum(['gcs', 'local']).optional(),
  /** MUT-396: the local driver's folder; relative paths are resolved against the server package, not the cwd. */
  ATTACHMENTS_DIR: z.string().min(1).default('.data/attachments'),
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
  /**
   * MUT-115 (ADR-190, D2): the WebAuthn relying-party ID, the apex domain (Terraform sets it from config/hosts.json at
   * stages live/redirect). Unset = no passkeys: every passkey route answers 404. WEBAUTHN_ORIGINS (comma list)
   * replaces the derived origins (PORTAL_ORIGIN and https://<rp id>) for local development; each must be the RP ID or
   * a subdomain of it.
   */
  WEBAUTHN_RP_ID: z.string().min(1).optional(),
  WEBAUTHN_ORIGINS: z.string().min(1).optional(),
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
   * MUT-255/389: the receipts library (/v1/receipts*, and deleting an expense keeps its receipts To review). Off,
   * the server behaves as before MUT-255, so main can deploy before any screen shows the library (decision P4: on
   * when MUT-260 or MUT-258 ships, Terraform receipts_library_enabled). Only "true" turns it on, as above.
   */
  RECEIPTS_LIBRARY: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  // MUT-436 (review D3/D5): an agent may add to the inbox only once the phone decodes 'mcp' and its minimum build is raised.
  MCP_INBOX_WRITES: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  /**
   * MUT-361 (ADR-181 D7): the lapse gate — a READ_ONLY profile refuses session writes and a LOCKED one everything but
   * the records export (billing/gate.ts). On unless exactly "false": the operator's kill switch, e.g. while a pilot user
   * found by `npm run billing:uncovered` still waits for a grant, or until the phone build that reads the refusal ships.
   */
  BILLING_GATE: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  /**
   * MUT-360: Stripe (Secret Manager, mounted only once stripe_enabled is applied). A restricted key, read-only on
   * billing objects except, from MUT-362 (eng review D2), Write on Customers, Checkout Sessions and Customer portal;
   * both or neither — unset, the webhook, reconcile and billing sessions answer 503. A live key only where
   * API_KEY_ENVIRONMENT is live, so a test server can never read the real account.
   */
  STRIPE_SECRET_KEY: z.string().regex(/^(rk|sk)_(test|live)_[A-Za-z0-9_]+$/, 'must be a Stripe secret or restricted key (sk_/rk_)').optional(),
  STRIPE_WEBHOOK_SECRET: z.string().regex(/^whsec_[A-Za-z0-9_]+$/, 'must be a Stripe webhook signing secret (whsec_)').optional(),
  /** MUT-360 D2: the nightly Scheduler job's X-Job-Token (Terraform-generated). Unset = /jobs/* answers 503. */
  MUTABA3A_JOB_TOKEN: z.string().min(32, 'MUTABA3A_JOB_TOKEN must be at least 32 characters').optional(),
  /**
   * MUT-434 (D19): the secret an agent's renewed tokens are derived under, so a retried refresh gets the same pair.
   * Secret Manager. Needs PORTAL_ORIGIN (the issuer). Unset = the OAuth endpoints and /mcp answer 503. Rotating it
   * breaks only retries inside the 30-second window; rotating SESSION_TOKEN_PEPPER is what signs agents out.
   */
  OAUTH_DERIVE_KEY: z.string().min(32, 'OAUTH_DERIVE_KEY must be at least 32 characters').optional(),
  /**
   * MUT-148 (ADR-091): the api project's DSN (Secret Manager, mounted once sentry_enabled is applied). Unset = no
   * error reports. Only an EU-region DSN starts: a US one would send events outside the region ADR-091 chose (D5).
   */
  SENTRY_DSN: z.string().regex(SENTRY_EU_DSN, 'must be an https DSN on the EU region, https://<key>@<org>.ingest.de.sentry.io/<project>').optional(),
  /** The environment events are filed under. Unset = NODE_ENV. */
  SENTRY_ENVIRONMENT: z.string().min(1).max(64).optional(),
  /**
   * MUT-359 (ADR-159 §5): which transport sends mail. `noop` (default) sends nothing; `log` and `memory` are for
   * development and tests only (refused in production, D14); `resend` needs every RESEND_/MAIL_ value below.
   */
  MAILER: z.enum(['resend', 'log', 'memory', 'noop']).default('noop'),
  /** MUT-366: POST /v1/signups answers 404 until this is "true"; the server refuses to start with it on and no mailer. Recovery is never behind it. */
  SELF_SIGNUP_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  /**
   * MUT-366 (D7): Cloudflare Turnstile's secret (Secret Manager). Outside production, unset = Cloudflare's published
   * always-pass test secret (2x… always fails, for QA), answered without a network call. Production needs a real
   * one once mail or signup is on, and refuses a test one.
   */
  TURNSTILE_SECRET: z.string().min(1).max(200).optional(),
  /** MUT-366 (ADR-159 §5): signup and recovery answer no earlier than this many ms after the request began. */
  SIGNUP_RESPONSE_FLOOR_MS: z.coerce.number().int().min(0).max(10_000).default(SELF_SERVICE_POLICY.signupFloorMs),
  RECOVERY_RESPONSE_FLOOR_MS: z.coerce.number().int().min(0).max(10_000).default(SELF_SERVICE_POLICY.recoveryFloorMs),
  /** no-reply@<apex>, written by Terraform from config/hosts.json. One plain address; the display name is the product's. */
  MAIL_FROM_ADDRESS: z.string().email().max(254).optional(),
  /** Where replies go (D6). */
  MAIL_REPLY_TO: z.string().email().max(254).optional(),
  /** Mutaba3a's sending key, restricted to its domain (Secret Manager). */
  RESEND_API_KEY: z.string().regex(/^re_[A-Za-z0-9_]+$/, 'must be a Resend API key (re_…)').optional(),
  /** The Resend webhook's signing secret (Secret Manager). Alone, it turns the bounce webhook on (D20). */
  RESEND_WEBHOOK_SECRET: z.string().regex(/^whsec_[A-Za-z0-9+/=]+$/, 'must be a Resend/Svix signing secret (whsec_…)').optional(),
  /** Sends in any rolling 24 h. Required with resend, set below the shared Resend plan's limit (D18); 500 elsewhere. */
  MAIL_DAILY_CAP: z.coerce.number().int().min(1).optional(),
  /** The part of the daily cap only recovery mail (reset, finish setup) may use. Default: 10 % of the cap, rounded up. */
  MAIL_SECURITY_RESERVE: z.coerce.number().int().min(0).optional(),
  /** Sends to one address in any rolling 24 h (D17). */
  MAIL_RECIPIENT_DAILY_CAP: z.coerce.number().int().min(1).default(10),
  /** MUT-367's review digest goes here (at most one an hour while signups wait). Unset = no digest. */
  OPERATOR_ALERT_EMAIL: z.string().email().max(254).optional(),
  /**
   * MUT-367 (ADR-159 §7a, D3): how the signup screen checks a domain. `dns` asks DNS and RDAP; `fixture` answers from
   * a fixed table of `.example` domains (tests, QA, development) and is refused in production. Unset = `dns` in
   * production, `fixture` elsewhere.
   */
  EMAIL_DOMAIN_CHECKER: z.enum(['dns', 'fixture']).optional(),
});

const APP_ASSOCIATION_KEYS = ['APPLE_TEAM_ID', 'APPLE_BUNDLE_ID', 'ANDROID_PACKAGE_NAME', 'ANDROID_SHA256_FINGERPRINTS'] as const;
const MIN_BUILD_PLATFORMS = [
  { min: 'IOS_MIN_BUILD', recommended: 'IOS_RECOMMENDED_BUILD' },
  { min: 'ANDROID_MIN_BUILD', recommended: 'ANDROID_RECOMMENDED_BUILD' },
] as const;

/** `loadConfig` fills SENTRY_ENVIRONMENT in from NODE_ENV and the mail caps from their defaults, so they are always set. */
export type Config = Omit<z.infer<typeof envSchema>, 'SENTRY_ENVIRONMENT' | 'MAIL_DAILY_CAP' | 'MAIL_SECURITY_RESERVE' | 'EMAIL_DOMAIN_CHECKER'> & {
  SENTRY_ENVIRONMENT: string;
  EMAIL_DOMAIN_CHECKER: 'dns' | 'fixture';
  MAIL_DAILY_CAP: number;
  MAIL_SECURITY_RESERVE: number;
};

/** MUT-359: the cap outside `resend`, where nothing real is sent. */
export const DEFAULT_MAIL_DAILY_CAP = 500;
const RESEND_REQUIRED = ['MAIL_FROM_ADDRESS', 'MAIL_REPLY_TO', 'RESEND_API_KEY', 'RESEND_WEBHOOK_SECRET', 'MAIL_DAILY_CAP'] as const;

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
  const attachments = attachmentsConfig(config);
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
  if (config.OAUTH_DERIVE_KEY && !config.PORTAL_ORIGIN) {
    throw new ConfigError('Invalid configuration:\n  OAUTH_DERIVE_KEY: needs PORTAL_ORIGIN, the OAuth issuer and the origin /mcp is served on');
  }
  try {
    webauthnConfigOf({ rpId: config.WEBAUTHN_RP_ID, origins: config.WEBAUTHN_ORIGINS, portalOrigin: config.PORTAL_ORIGIN });
  } catch (err) {
    throw new ConfigError(`Invalid configuration:\n  ${(err as Error).message}`);
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
  return { ...config, ...attachments, SENTRY_ENVIRONMENT: config.SENTRY_ENVIRONMENT ?? config.NODE_ENV, ...mailConfig(config), TURNSTILE_SECRET: turnstileSecret(config), EMAIL_DOMAIN_CHECKER: domainChecker(config) };
}

/** MUT-367 (D3): the fixture would let anyone choose their own verdict, so production always asks DNS and RDAP. */
function domainChecker(config: z.infer<typeof envSchema>): 'dns' | 'fixture' {
  const production = config.NODE_ENV === 'production';
  if (production && config.EMAIL_DOMAIN_CHECKER === 'fixture') {
    throw new ConfigError('Invalid configuration:\n  EMAIL_DOMAIN_CHECKER: the fixture checker is for tests and QA; production checks real domains (dns)');
  }
  return config.EMAIL_DOMAIN_CHECKER ?? (production ? 'dns' : 'fixture');
}

/**
 * MUT-366 (D7, review #6): a server that really mails links (MAILER=resend, any environment) or opens signup in
 * production must name its secret, and production never takes a test secret, which would let every bot through.
 * Development and tests fall back to the always-pass test secret.
 */
function turnstileSecret(config: z.infer<typeof envSchema>): string | undefined {
  const secret = config.TURNSTILE_SECRET;
  const production = config.NODE_ENV === 'production';
  if (production && secret && isTurnstileTestSecret(secret)) {
    throw new ConfigError('Invalid configuration:\n  TURNSTILE_SECRET: a Cloudflare test secret would let every request through in production');
  }
  const mailsLinks = config.MAILER === 'resend' || (production && (config.MAILER !== 'noop' || config.SELF_SIGNUP_ENABLED));
  if (!secret && mailsLinks) {
    throw new ConfigError('Invalid configuration:\n  TURNSTILE_SECRET: signup and recovery mail links, so a server that sends mail needs the Turnstile secret');
  }
  return secret ?? (production ? undefined : TURNSTILE_TEST_SECRETS.pass);
}

/** The server package directory (config.ts sits in src/ or dist/, one level below it). */
const SERVER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * MUT-396: the storage refusals. The local driver serves files to anyone holding a URL from a server whose secret
 * is the session pepper, with no CMEK or lifecycle rules: never on a deployed service.
 */
function attachmentsConfig(config: z.infer<typeof envSchema>): { ATTACHMENTS_DIR: string } {
  const refuse = (why: string): never => {
    throw new ConfigError(`Invalid configuration:\n  ATTACHMENTS_DRIVER: ${why}`);
  };
  if (config.ATTACHMENTS_DRIVER === 'local') {
    if (config.NODE_ENV === 'production' || config.NODE_ENV === 'staging') refuse(`local storage is for the dev server and local QA only, never ${config.NODE_ENV}`);
    if (config.ATTACHMENTS_BUCKET) refuse('local with ATTACHMENTS_BUCKET set is ambiguous; unset one of them');
  }
  if (config.ATTACHMENTS_DRIVER === 'gcs' && !config.ATTACHMENTS_BUCKET) refuse('gcs needs ATTACHMENTS_BUCKET');
  return { ATTACHMENTS_DIR: isAbsolute(config.ATTACHMENTS_DIR) ? config.ATTACHMENTS_DIR : resolve(SERVER_DIR, config.ATTACHMENTS_DIR) };
}

/** MUT-359: the mail refusals (ticket, D7, D14, D18, D20) and the caps' defaults. */
function mailConfig(config: z.infer<typeof envSchema>): { MAIL_DAILY_CAP: number; MAIL_SECURITY_RESERVE: number } {
  const refuse = (name: string, why: string): never => {
    throw new ConfigError(`Invalid configuration:\n  ${name}: ${why}`);
  };
  if (config.MAILER === 'noop' && config.SELF_SIGNUP_ENABLED) refuse('SELF_SIGNUP_ENABLED', 'signup mails a link, so it needs a MAILER other than noop');
  if (config.NODE_ENV === 'production' && (config.MAILER === 'log' || config.MAILER === 'memory')) {
    refuse('MAILER', `${config.MAILER} is for development and tests only: in production it would ${config.MAILER === 'log' ? 'write setup links into the logs' : 'keep mail in memory and send nothing'}`);
  }
  if (config.MAILER === 'resend') {
    for (const name of RESEND_REQUIRED) if (config[name] === undefined) refuse(name, 'MAILER=resend needs it');
  }
  if (config.RESEND_WEBHOOK_SECRET && !config.MAIL_FROM_ADDRESS) refuse('MAIL_FROM_ADDRESS', 'the Resend webhook keeps only events sent from this address\'s domain, so it needs it');
  for (const name of ['MAIL_FROM_ADDRESS', 'MAIL_REPLY_TO'] as const) {
    const address = config[name];
    if (address && isUnownedDomain(address)) refuse(name, `${address.split('@')[1]} is not a domain we own; mail there reaches whoever registers it`);
  }
  const daily = config.MAIL_DAILY_CAP ?? DEFAULT_MAIL_DAILY_CAP;
  // 10 % rounded up, but never the whole cap: a cap of 1 leaves no reserve rather than refusing to start.
  const reserve = config.MAIL_SECURITY_RESERVE ?? Math.min(Math.ceil(daily / 10), daily - 1);
  if (reserve >= daily) refuse('MAIL_SECURITY_RESERVE', `must be below MAIL_DAILY_CAP (${reserve} >= ${daily})`);
  return { MAIL_DAILY_CAP: daily, MAIL_SECURITY_RESERVE: reserve };
}
