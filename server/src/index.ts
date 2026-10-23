import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { shutdownAndFlush } from './observability/reporter.js';
import { apiRelease, createSentryReporter, serverPackageVersion } from './observability/sentry-node.js';
import { SlidingWindowRateLimiter } from './rate-limit.js';
import { PrismaLedgerStore } from './repositories/prisma.js';
import { GcsAttachmentStorage } from './attachments/storage.js';
import { SIGN_IN_POLICY, SignInThrottle } from './auth/sessions.js';
import { createArgon2Hasher } from './auth/users.js';
import { CachedFxRates, FrankfurterSource } from './fx-rates.js';
import { PUBLIC_FX_POLICY } from './routes/fx-rates.js';
import { createStripeGateway, RECONCILE_BUDGET, WEBHOOK_BUDGET } from './billing/stripe/gateway.js';
import { CHECKOUT_BUDGET, createCheckoutGateway } from './billing/stripe/checkout-gateway.js';
import { STRIPE_WEBHOOK_POLICY } from './routes/stripe-billing.js';
import { BILLING_SESSION_POLICY } from './routes/billing.js';
import { EMAIL_WEBHOOK_POLICY } from './routes/email-webhook.js';
import { createMailer } from './email/mailer.js';
import type { MailTransport } from './email/ports.js';
import { createResendTransport } from './email/transports/resend.js';
import { createLogTransport } from './email/transports/log.js';
import { MemoryMailTransport } from './email/transports/memory.js';
import { NOOP_TRANSPORT } from './email/transports/noop.js';

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);
// MUT-148 (ADR-091): first, so a crash while wiring the rest is reported too.
const reporter = createSentryReporter({
  dsn: config.SENTRY_DSN,
  environment: config.SENTRY_ENVIRONMENT,
  release: apiRelease(serverPackageVersion(), config.SERVICE_VERSION),
});
const store = PrismaLedgerStore.connect(config.DATABASE_URL);
const rateLimiter = new SlidingWindowRateLimiter(config.RATE_LIMIT_PER_MINUTE);
const signInThrottle = new SignInThrottle();
const signInIpLimiter = new SlidingWindowRateLimiter(SIGN_IN_POLICY.ipPerMinute);
// MUT-287: the anonymous GET /v1/public/fx-rates keys one window per address; built here so the timer below prunes it.
const publicFxIpLimiter = new SlidingWindowRateLimiter(PUBLIC_FX_POLICY.ipPerMinute);
const stripeWebhookIpLimiter = new SlidingWindowRateLimiter(STRIPE_WEBHOOK_POLICY.ipPerMinute);
// MUT-360 D7: one gateway per budget; config refuses a key without its webhook secret, so both or neither exist.
const stripeGateway = (budget: { timeoutMs: number; maxNetworkRetries: number }) =>
  createStripeGateway({ secretKey: config.STRIPE_SECRET_KEY!, webhookSecret: config.STRIPE_WEBHOOK_SECRET!, ...budget, now: () => new Date() });
// MUT-362 (eng review D2): the same restricted key, widened with Write on Customers, Checkout Sessions and Customer portal.
const stripe = config.STRIPE_SECRET_KEY
  ? {
      webhookGateway: stripeGateway(WEBHOOK_BUDGET),
      reconcileGateway: stripeGateway(RECONCILE_BUDGET),
      checkoutGateway: createCheckoutGateway({ secretKey: config.STRIPE_SECRET_KEY, ...CHECKOUT_BUDGET, now: () => new Date() }),
    }
  : null;
const billingSessionLimiter = new SlidingWindowRateLimiter(BILLING_SESSION_POLICY.perMinute);
const emailWebhookIpLimiter = new SlidingWindowRateLimiter(EMAIL_WEBHOOK_POLICY.ipPerMinute);

// MUT-359 (ADR-159 §5): config has already refused every half-configured mailer, and log/memory in production.
const memoryOutbox = config.MAILER === 'memory' ? new MemoryMailTransport() : null;
const mailTransport: MailTransport =
  config.MAILER === 'resend' ? createResendTransport({ apiKey: config.RESEND_API_KEY! })
  : config.MAILER === 'log' ? createLogTransport(logger)
  : memoryOutbox ?? NOOP_TRANSPORT;
const mailer = createMailer({
  transport: mailTransport,
  store,
  logger,
  now: () => new Date(),
  fromAddress: config.MAIL_FROM_ADDRESS ?? 'no-reply@example.invalid',
  replyTo: config.MAIL_REPLY_TO ?? null,
  limits: { daily: config.MAIL_DAILY_CAP, securityReserve: config.MAIL_SECURITY_RESERVE, perRecipient: config.MAIL_RECIPIENT_DAILY_CAP },
});
/** MUT-359 (D2): the send log keeps 30 days; pruned hourly. */
const MAIL_LOG_RETENTION_MS = 30 * 24 * 3_600_000;
const MAIL_PRUNE_EVERY_MS = 3_600_000;

const fxRates = new CachedFxRates({
  source: new FrankfurterSource({ url: config.FX_RATES_URL, timeoutMs: config.FX_RATES_TIMEOUT_MS }),
  ttlMs: config.FX_RATES_TTL_MINUTES * 60_000,
  logger,
});

const app = createApp({
  store,
  logger,
  rateLimiter,
  adminToken: config.MUTABA3A_ADMIN_TOKEN,
  keyEnvironment: config.API_KEY_ENVIRONMENT,
  version: config.SERVICE_VERSION,
  attachments: config.ATTACHMENTS_BUCKET ? new GcsAttachmentStorage(config.ATTACHMENTS_BUCKET) : null,
  attachmentUrlTtlSeconds: config.ATTACHMENTS_URL_TTL_SECONDS,
  receiptsLibrary: config.RECEIPTS_LIBRARY,
  passwordHasher: createArgon2Hasher({
    memoryKiB: config.ARGON2_MEMORY_KIB,
    timeCost: config.ARGON2_TIME_COST,
    parallelism: config.ARGON2_PARALLELISM,
  }),
  sessions: {
    pepper: config.SESSION_TOKEN_PEPPER,
    idleMinutes: config.SESSION_IDLE_MINUTES,
    absoluteHours: config.SESSION_ABSOLUTE_HOURS,
    deviceIdleDays: config.DEVICE_SESSION_IDLE_DAYS,
    deviceAbsoluteDays: config.DEVICE_SESSION_ABSOLUTE_DAYS,
    // Plain-HTTP local development only; everywhere else the cookie is Secure and __Host- bound.
    secureCookie: config.NODE_ENV !== 'development',
    ...(config.PORTAL_ORIGIN ? { portalOrigin: config.PORTAL_ORIGIN } : {}),
    trustedProxyHops: config.TRUSTED_PROXY_HOPS,
    ...(config.FRONT_DOOR_TOKEN ? { frontDoorToken: config.FRONT_DOOR_TOKEN } : {}),
    legacyRedirect: config.PORTAL_LEGACY_REDIRECT,
  },
  signInThrottle,
  signInIpLimiter,
  publicFxIpLimiter,
  stripe,
  jobToken: config.MUTABA3A_JOB_TOKEN ?? null,
  stripeWebhookIpLimiter,
  billingSessionLimiter,
  mailer,
  emailWebhook: config.RESEND_WEBHOOK_SECRET && config.MAIL_FROM_ADDRESS ? { secret: config.RESEND_WEBHOOK_SECRET, fromDomain: config.MAIL_FROM_ADDRESS.split('@')[1]! } : null,
  emailWebhookIpLimiter,
  devOutbox: config.NODE_ENV !== 'production' ? memoryOutbox : null,
  portal: config.PORTAL_DIST_DIR ? { distDir: config.PORTAL_DIST_DIR } : null,
  appAssociation:
    config.APPLE_TEAM_ID && config.APPLE_BUNDLE_ID && config.ANDROID_PACKAGE_NAME && config.ANDROID_SHA256_FINGERPRINTS
      ? {
          appleTeamId: config.APPLE_TEAM_ID,
          appleBundleId: config.APPLE_BUNDLE_ID,
          androidPackageName: config.ANDROID_PACKAGE_NAME,
          androidSha256Fingerprints: config.ANDROID_SHA256_FINGERPRINTS.split(','),
        }
      : null,
  fxRates,
  reporter,
  minimumBuild: {
    ios: { min: config.IOS_MIN_BUILD, recommended: config.IOS_RECOMMENDED_BUILD },
    android: { min: config.ANDROID_MIN_BUILD, recommended: config.ANDROID_RECOMMENDED_BUILD },
    disabled: config.MIN_BUILD_CHECK_DISABLED,
  },
});
if (!config.ATTACHMENTS_BUCKET) logger.warn('ATTACHMENTS_BUCKET is not set; attachments routes answer 503');
if (!stripe) logger.warn('STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET are not set; the Stripe webhook, reconcile and billing sessions answer 503');
if (!config.MUTABA3A_JOB_TOKEN) logger.warn('MUTABA3A_JOB_TOKEN is not set; /jobs/* answers 503');
if (config.MAILER === 'noop') logger.warn('MAILER is noop; no mail is sent (password notices included)');
if (!config.RESEND_WEBHOOK_SECRET) logger.warn('RESEND_WEBHOOK_SECRET is not set; the Resend webhook answers 503');
if (!config.PORTAL_DIST_DIR) logger.warn('PORTAL_DIST_DIR is not set; serving API only, no hosted portal');
if (!reporter.enabled) logger.warn('SENTRY_DSN is not set; errors are logged but not reported');
if (!config.APPLE_TEAM_ID) logger.warn('APPLE_TEAM_ID/APPLE_BUNDLE_ID/ANDROID_PACKAGE_NAME/ANDROID_SHA256_FINGERPRINTS are not set; no app-association files served');

const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  logger.info({ port: info.port, env: config.NODE_ENV, keyEnvironment: config.API_KEY_ENVIRONMENT }, 'mutaba3a-api listening');
});
// MUT-228: production runs one instance, so every deploy starts with an empty rate cache. Fill it now
// rather than on the first phone's request; a failure is logged and the first request tries again.
void fxRates.warm();

const pruneTimer = setInterval(() => {
  const now = new Date();
  rateLimiter.prune(now);
  signInThrottle.prune(now);
  signInIpLimiter.prune(now);
  publicFxIpLimiter.prune(now);
  stripeWebhookIpLimiter.prune(now);
  billingSessionLimiter.prune(now);
  emailWebhookIpLimiter.prune(now);
}, 60_000);
pruneTimer.unref();
const mailPruneTimer = setInterval(() => {
  void store.email.pruneDeliveries(new Date(Date.now() - MAIL_LOG_RETENTION_MS)).catch((err: unknown) => logger.error({ err }, 'mail send log prune failed'));
}, MAIL_PRUNE_EVERY_MS);
mailPruneTimer.unref();

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'shutting down');
  clearInterval(pruneTimer);
  clearInterval(mailPruneTimer);
  await shutdownAndFlush({
    stopAccepting: () => server.close(),
    disconnect: () => store.disconnect(),
    reporter,
    exit: (code) => process.exit(code),
    logError: (message, error) => logger.error({ err: error }, String(message)),
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
