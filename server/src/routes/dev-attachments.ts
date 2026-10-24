import { Hono } from 'hono';
import type { AppEnv } from '../auth/middleware.js';
import { LOCAL_ATTACHMENTS_PATH, LocalStorageError, type LocalAttachmentStorage } from '../attachments/local-storage.js';

/**
 * MUT-396: the signed URLs LocalAttachmentStorage hands out. Mounted only with ATTACHMENTS_DRIVER=local, which config
 * refuses in production and staging. These routes stand in for the storage service, not the API: no session or API
 * key (the token in the path is the credential, like a GCS signed URL), plain-text errors like a storage service,
 * and not in the published OpenAPI.
 *
 *   PUT /dev/attachments/:token    store the body (the phone's and portal's signed-URL upload)
 *   GET /dev/attachments/:token    the stored bytes
 *   GET /dev/attachments           {driver: "local"}: Flutter QA's env check
 *
 * The request log line includes the path and so the token. That is accepted: dev only, and each token expires with
 * ATTACHMENTS_URL_TTL_SECONDS.
 */
export function devAttachmentRoutes(storage: LocalAttachmentStorage): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const fail = (error: unknown) => {
    if (error instanceof LocalStorageError) return new Response(error.message, { status: error.status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    throw error;
  };

  app.get(LOCAL_ATTACHMENTS_PATH, (c) => c.json({ driver: 'local' }, 200));

  app.put(`${LOCAL_ATTACHMENTS_PATH}/:token`, async (c) => {
    const length = c.req.header('content-length');
    try {
      await storage.acceptUpload(
        c.req.param('token'),
        { contentType: c.req.header('content-type') ?? null, contentLength: length === undefined ? null : Number(length), body: c.req.raw.body },
        c.get('now')(),
      );
      return c.body(null, 200);
    } catch (error) {
      return fail(error);
    }
  });

  app.get(`${LOCAL_ATTACHMENTS_PATH}/:token`, async (c) => {
    try {
      // Hono routes HEAD here too: answer from the file's handle without opening a stream.
      const file = await storage.openDownload(c.req.param('token'), c.get('now')(), { withBody: c.req.method !== 'HEAD' });
      return new Response(file.body, {
        status: 200,
        headers: {
          'content-type': file.mimeType,
          'content-length': String(file.sizeBytes),
          'content-disposition': file.contentDisposition,
          // A download, not a page: no scripts, whatever the file claims to be.
          'content-security-policy': 'sandbox',
          'cache-control': 'no-store',
        },
      });
    } catch (error) {
      return fail(error);
    }
  });

  return app;
}
