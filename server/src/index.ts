import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { SlidingWindowRateLimiter } from './rate-limit.js';
import { PrismaLedgerStore } from './repositories/prisma.js';
import { GcsAttachmentStorage } from './attachments/storage.js';
import { SIGN_IN_POLICY, SignInThrottle } from './auth/sessions.js';
import { createArgon2Hasher } from './auth/users.js';

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);
const store = PrismaLedgerStore.connect(config.DATABASE_URL);
const rateLimiter = new SlidingWindowRateLimiter(config.RATE_LIMIT_PER_MINUTE);
const signInThrottle = new SignInThrottle();
const signInIpLimiter = new SlidingWindowRateLimiter(SIGN_IN_POLICY.ipPerMinute);

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
    // Plain-HTTP local development only; everywhere else the cookie is Secure and __Host- bound.
    secureCookie: config.NODE_ENV !== 'development',
    ...(config.PORTAL_ORIGIN ? { portalOrigin: config.PORTAL_ORIGIN } : {}),
    trustedProxyHops: config.TRUSTED_PROXY_HOPS,
  },
  signInThrottle,
  signInIpLimiter,
});
if (!config.ATTACHMENTS_BUCKET) logger.warn('ATTACHMENTS_BUCKET is not set; attachments routes answer 503');

const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  logger.info({ port: info.port, env: config.NODE_ENV, keyEnvironment: config.API_KEY_ENVIRONMENT }, 'mutaba3a-api listening');
});

const pruneTimer = setInterval(() => {
  const now = new Date();
  rateLimiter.prune(now);
  signInThrottle.prune(now);
  signInIpLimiter.prune(now);
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
