import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { SlidingWindowRateLimiter } from './rate-limit.js';
import { PrismaLedgerStore } from './repositories/prisma.js';
import { GcsAttachmentStorage } from './attachments/storage.js';
import { SIGN_IN_POLICY, SignInThrottle } from './auth/sessions.js';
import { createArgon2Hasher } from './auth/users.js';
import { CachedFxRates, FrankfurterSource } from './fx-rates.js';
import { PUBLIC_FX_POLICY } from './routes/fx-rates.js';

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);
const store = PrismaLedgerStore.connect(config.DATABASE_URL);
const rateLimiter = new SlidingWindowRateLimiter(config.RATE_LIMIT_PER_MINUTE);
const signInThrottle = new SignInThrottle();
const signInIpLimiter = new SlidingWindowRateLimiter(SIGN_IN_POLICY.ipPerMinute);
// MUT-287: the anonymous GET /v1/public/fx-rates keys one window per address; built here so the timer below prunes it.
const publicFxIpLimiter = new SlidingWindowRateLimiter(PUBLIC_FX_POLICY.ipPerMinute);

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
  },
  signInThrottle,
  signInIpLimiter,
  publicFxIpLimiter,
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
  minimumBuild: {
    ios: { min: config.IOS_MIN_BUILD, recommended: config.IOS_RECOMMENDED_BUILD },
    android: { min: config.ANDROID_MIN_BUILD, recommended: config.ANDROID_RECOMMENDED_BUILD },
    disabled: config.MIN_BUILD_CHECK_DISABLED,
  },
});
if (!config.ATTACHMENTS_BUCKET) logger.warn('ATTACHMENTS_BUCKET is not set; attachments routes answer 503');
if (!config.PORTAL_DIST_DIR) logger.warn('PORTAL_DIST_DIR is not set; serving API only, no hosted portal');
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
}, 60_000);
pruneTimer.unref();

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'shutting down');
  clearInterval(pruneTimer);
  server.close();
  await store.disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
