import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { SlidingWindowRateLimiter } from './rate-limit.js';
import { PrismaLedgerStore } from './repositories/prisma.js';
import { GcsAttachmentStorage } from './attachments/storage.js';

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);
const store = PrismaLedgerStore.connect(config.DATABASE_URL);
const rateLimiter = new SlidingWindowRateLimiter(config.RATE_LIMIT_PER_MINUTE);

const app = createApp({
  store,
  logger,
  rateLimiter,
  adminToken: config.MUTABA3A_ADMIN_TOKEN,
  keyEnvironment: config.API_KEY_ENVIRONMENT,
  version: config.SERVICE_VERSION,
  attachments: config.ATTACHMENTS_BUCKET ? new GcsAttachmentStorage(config.ATTACHMENTS_BUCKET) : null,
  attachmentUrlTtlSeconds: config.ATTACHMENTS_URL_TTL_SECONDS,
});
if (!config.ATTACHMENTS_BUCKET) logger.warn('ATTACHMENTS_BUCKET is not set; attachments routes answer 503');

const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  logger.info({ port: info.port, env: config.NODE_ENV, keyEnvironment: config.API_KEY_ENVIRONMENT }, 'mutaba3a-api listening');
});

const pruneTimer = setInterval(() => rateLimiter.prune(new Date()), 60_000);
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
