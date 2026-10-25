import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { shutdownAndFlush } from './observability/reporter.js';
import { apiRelease, createSentryReporter, serverPackageVersion } from './observability/sentry-node.js';
import { SlidingWindowRateLimiter } from './rate-limit.js';
import { PrismaLedgerStore } from './repositories/prisma.js';
import { GcsAttachmentStorage } from './attachments/storage.js';
import { LocalAttachmentStorage, requestOrigin } from './attachments/local-storage.js';
import { SIGN_IN_POLICY, SignInThrottle, sessionDigest } from './auth/sessions.js';
import { createArgon2Hasher } from './auth/users.js';
import { CachedFxRates, FrankfurterSource } from './fx-rates.js';
import { PUBLIC_FX_POLICY } from './routes/fx-rates.js';
import { createStripeGateway, RECONCILE_BUDGET, WEBHOOK_BUDGET } from './billing/stripe/gateway.js';
import { CHECKOUT_BUDGET, createCheckoutGateway } from './billing/stripe/checkout-gateway.js';
import { createAccountStripeGateway } from './billing/stripe/account-gateway.js';
import { STRIPE_WEBHOOK_POLICY } from './routes/stripe-billing.js';
import { BILLING_SESSION_POLICY } from './routes/billing.js';
import { EMAIL_WEBHOOK_POLICY } from './routes/email-webhook.js';
import { createMailer } from './email/mailer.js';
import type { MailTransport } from './email/ports.js';
import { createResendTransport } from './email/transports/resend.js';
import { createLogTransport } from './email/transports/log.js';
import { MemoryMailTransport } from './email/transports/memory.js';
import { NOOP_TRANSPORT } from './email/transports/noop.js';
import { SELF_SERVICE_POLICY } from './auth/self-service.js';
import { createTurnstileVerifier, UNCONFIGURED_TURNSTILE } from './auth/turnstile.js';
import { defaultSelfServiceOptions } from './routes/self-service.js';
import { CachedDomainChecker, createDomainScreen } from './email/domains/screen.js';
import { createDnsDomainChecker, DOMAIN_CHECK_BUDGET_MS } from './email/domains/dns-checker.js';
import { createFixtureDomainChecker } from './email/domains/fixture-checker.js';
import { createRdapClient } from './email/domains/rdap.js';
import { createReviewDigest, msUntilNextSweep } from './email/review-digest.js';
import { webauthnConfigOf } from './auth/webauthn.js';

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
      // MUT-333 (D14): the same key, which also needs Write on Subscriptions to end them when an account closes.
      accountGateway: createAccountStripeGateway({ secretKey: config.STRIPE_SECRET_KEY, ...CHECKOUT_BUDGET }),
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

// MUT-366 (ADR-159): signup and recovery. Config has refused a production server that could mail a link without a
// real Turnstile secret; with none here (production, mail off) the check fails closed and recovery mails nothing anyway.
const selfService = {
  ...defaultSelfServiceOptions(),
  // Built here (not taken from the defaults) so the timer below can prune them.
  ipLimiter: new SlidingWindowRateLimiter(SELF_SERVICE_POLICY.ipPerHour, 3_600_000),
  addressMinuteLimiter: new SlidingWindowRateLimiter(SELF_SERVICE_POLICY.addressPerMinute),
  addressDayLimiter: new SlidingWindowRateLimiter(SELF_SERVICE_POLICY.addressPerDay, 24 * 3_600_000),
  signupEnabled: config.SELF_SIGNUP_ENABLED,
  // MUT-368 (D1): GET /v1/self-service offers a door only where a link can really be mailed.
  mailsLinks: config.MAILER !== 'noop' && Boolean(config.TURNSTILE_SECRET),
  turnstile: config.TURNSTILE_SECRET ? createTurnstileVerifier({ secret: config.TURNSTILE_SECRET, logger }) : UNCONFIGURED_TURNSTILE,
  floors: { signupMs: config.SIGNUP_RESPONSE_FLOOR_MS, recoveryMs: config.RECOVERY_RESPONSE_FLOOR_MS, screenMs: DOMAIN_CHECK_BUDGET_MS },
  // MUT-367 (ADR-159 §7a): DNS and RDAP in production (config refuses the fixture there), cached per domain.
  domainScreen: createDomainScreen({
    checker: new CachedDomainChecker(
      config.EMAIL_DOMAIN_CHECKER === 'dns' ? createDnsDomainChecker({ rdap: createRdapClient({ fetch, now: () => new Date() }) }) : createFixtureDomainChecker(() => new Date()),
      { now: () => new Date() },
    ),
    now: () => new Date(),
    logger,
  }),
};
// MUT-367 (D13, D27): the operator digest, nudged by each pending signup and swept a few minutes past each UTC hour.
const reviewDigest = createReviewDigest({ store, mailer, logger, now: () => new Date(), to: config.OPERATOR_ALERT_EMAIL ?? null });
/** D9: unredeemed SIGNUP links are deleted a week after they expire; checked hourly, like the mail log. */
const SIGNUP_LINK_RETENTION_MS = SELF_SERVICE_POLICY.pruneAfterExpiryDays * 24 * 3_600_000;

// MUT-115 (D2): config has already refused an origin outside the RP ID; null = no passkeys.
const webauthn = webauthnConfigOf({ rpId: config.WEBAUTHN_RP_ID, origins: config.WEBAUTHN_ORIGINS, portalOrigin: config.PORTAL_ORIGIN });

const fxRates = new CachedFxRates({
  source: new FrankfurterSource({ url: config.FX_RATES_URL, timeoutMs: config.FX_RATES_TIMEOUT_MS }),
  ttlMs: config.FX_RATES_TTL_MINUTES * 60_000,
  logger,
});

// MUT-396: local-disk storage for the dev server and local QA (config refuses it in production and staging). Its URL
// secret is derived from the session pepper: no new secret, and stable across `tsx watch` restarts.
const localAttachments =
  config.ATTACHMENTS_DRIVER === 'local'
    ? new LocalAttachmentStorage({
        dir: config.ATTACHMENTS_DIR,
        secret: sessionDigest(config.SESSION_TOKEN_PEPPER, 'mut-396-local-attachments-v1'),
        origin: requestOrigin,
      })
    : null;

const app = createApp({
  store,
  logger,
  rateLimiter,
  adminToken: config.MUTABA3A_ADMIN_TOKEN,
  keyEnvironment: config.API_KEY_ENVIRONMENT,
  version: config.SERVICE_VERSION,
  attachments: localAttachments ?? (config.ATTACHMENTS_BUCKET ? new GcsAttachmentStorage(config.ATTACHMENTS_BUCKET) : null),
  localAttachments,
  attachmentUrlTtlSeconds: config.ATTACHMENTS_URL_TTL_SECONDS,
  receiptsLibrary: config.RECEIPTS_LIBRARY,
  billingGate: config.BILLING_GATE,
  // MUT-419 (R11): a production operator run never mails links to a local address.
  trialMail: { refuseLoopbackLinks: config.NODE_ENV === 'production' },
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
  webauthn,
  publicFxIpLimiter,
  stripe,
  jobToken: config.MUTABA3A_JOB_TOKEN ?? null,
  stripeWebhookIpLimiter,
  billingSessionLimiter,
  mailer,
  emailWebhook: config.RESEND_WEBHOOK_SECRET && config.MAIL_FROM_ADDRESS ? { secret: config.RESEND_WEBHOOK_SECRET, fromDomain: config.MAIL_FROM_ADDRESS.split('@')[1]! } : null,
  emailWebhookIpLimiter,
  devOutbox: config.NODE_ENV !== 'production' ? memoryOutbox : null,
  selfService,
  // MUT-367: a declined person may write to the reply-to address (resend requires it; elsewhere a placeholder).
  signupReview: { digest: reviewDigest, supportAddress: config.MAIL_REPLY_TO ?? config.MAIL_FROM_ADDRESS ?? 'help@example.invalid' },
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
if (localAttachments) logger.warn({ dir: config.ATTACHMENTS_DIR }, 'ATTACHMENTS_DRIVER=local: attachments are stored on this machine (dev and QA only)');
else if (!config.ATTACHMENTS_BUCKET) logger.warn('ATTACHMENTS_BUCKET is not set (nor ATTACHMENTS_DRIVER=local); attachments routes answer 503');
if (!stripe) logger.warn('STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET are not set; the Stripe webhook, reconcile and billing sessions answer 503');
if (!config.MUTABA3A_JOB_TOKEN) logger.warn('MUTABA3A_JOB_TOKEN is not set; /jobs/* answers 503');
if (config.MAILER === 'noop') logger.warn('MAILER is noop; no mail is sent (password notices included)');
if (!config.SELF_SIGNUP_ENABLED) logger.info('SELF_SIGNUP_ENABLED is off; POST /v1/signups answers 404 (recovery still works)');
if (!config.OPERATOR_ALERT_EMAIL) logger.warn('OPERATOR_ALERT_EMAIL is not set; no signup review digest is mailed');
if (config.EMAIL_DOMAIN_CHECKER === 'fixture') logger.info('EMAIL_DOMAIN_CHECKER is fixture; signup domains are judged from the .example table, not DNS');
if (!config.TURNSTILE_SECRET) logger.warn('TURNSTILE_SECRET is not set; signup and recovery fail their check (403 CHECK_FAILED)');
if (!config.RESEND_WEBHOOK_SECRET) logger.warn('RESEND_WEBHOOK_SECRET is not set; the Resend webhook answers 503');
if (!config.PORTAL_DIST_DIR) logger.warn('PORTAL_DIST_DIR is not set; serving API only, no hosted portal');
if (!reporter.enabled) logger.warn('SENTRY_DSN is not set; errors are logged but not reported');
if (!webauthn) logger.info('WEBAUTHN_RP_ID is not set; passkey routes answer 404');
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
  selfService.ipLimiter.prune(now);
  selfService.addressMinuteLimiter.prune(now);
  selfService.addressDayLimiter.prune(now);
}, 60_000);
pruneTimer.unref();
const mailPruneTimer = setInterval(() => {
  void store.email.pruneDeliveries(new Date(Date.now() - MAIL_LOG_RETENTION_MS)).catch((err: unknown) => logger.error({ err }, 'mail send log prune failed'));
  void store.accountSetup.pruneSignupLinks(new Date(Date.now() - SIGNUP_LINK_RETENTION_MS)).catch((err: unknown) => logger.error({ err }, 'signup link prune failed'));
  // MUT-115 (D5): challenges live 5 minutes; anything expired is dead weight.
  void store.passkeys.pruneChallenges(new Date()).catch((err: unknown) => logger.error({ err }, 'passkey challenge prune failed'));
}, MAIL_PRUNE_EVERY_MS);
mailPruneTimer.unref();
// MUT-367 (D27): aligned to the UTC hour, so a review waits at most about an hour to be announced.
let digestTimer: NodeJS.Timeout = setTimeout(function sweep() {
  void reviewDigest.announce();
  digestTimer = setTimeout(sweep, msUntilNextSweep(new Date()));
  digestTimer.unref();
}, msUntilNextSweep(new Date()));
digestTimer.unref();

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'shutting down');
  clearInterval(pruneTimer);
  clearInterval(mailPruneTimer);
  clearTimeout(digestTimer);
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
