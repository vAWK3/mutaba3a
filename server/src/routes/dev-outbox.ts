import { Hono } from 'hono';
import type { AppEnv } from '../auth/middleware.js';
import type { MemoryMailTransport } from '../email/transports/memory.js';

/**
 * MUT-359 (D11): GET /admin/v1/dev-outbox lists what the memory mailer "sent", so a test or a QA spec can open a
 * mail's link (MUT-368's signup and recovery specs). Mounted only when MAILER=memory, which config refuses in
 * production; behind the admin token like every /admin route. Deliberately not in the published OpenAPI: it is
 * not part of any deployed API.
 *
 *   GET /admin/v1/dev-outbox?to=<address>   oldest first, newest last; `to` filters by recipient
 */
export const DEV_OUTBOX_PATH = '/admin/v1/dev-outbox';

export function devOutboxRoutes(outbox: MemoryMailTransport): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get(DEV_OUTBOX_PATH, (c) => {
    const to = c.req.query('to');
    return c.json({ mails: outbox.list(to ? { to } : {}) }, 200);
  });
  return app;
}
