import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { personSession, type AppEnv } from '../auth/middleware.js';
import { ApiError } from '../errors.js';
import type { LedgerStore } from '../repositories/ports.js';
import { ErrorEnvelopeSchema, RegisterPushDeviceRequestSchema } from '../schemas.js';

/**
 * MUT-780 (ADR-351): a signed-in phone registers the push token its session holds, and removes it. The token is never
 * read back. Without push keys on the server (`enabled` false) both answer 404 and the phone treats that as "off".
 */
export const PUSH_DEVICE_ORGANIZATION_INDEPENDENT_ROUTES: ReadonlySet<string> = new Set(['POST /v1/push-devices', 'DELETE /v1/push-devices']);

const OWN = [{ session: [] }, { deviceSession: [] }];
const errorResponse = (description: string) => ({ description, content: { 'application/json': { schema: ErrorEnvelopeSchema } } });

export function pushDeviceRoutes(options: { store: LedgerStore; enabled: boolean }): OpenAPIHono<AppEnv> {
  const { store } = options;
  const app = new OpenAPIHono<AppEnv>();
  const configured = (): void => {
    if (!options.enabled) throw new ApiError('NOT_FOUND', 'Push is not available on this server');
  };

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/push-devices',
      tags: ['Push'],
      summary: 'Register this phone’s push token (MUT-780)',
      description:
        'Stores the FCM token for the signed-in session, replacing the session’s earlier token and any other row holding the same token (a phone handed to another person). Idempotent. A session signed out or revoked never receives a push. Additive since 1.216.0-mut780.',
      security: OWN,
      request: { body: { required: true, content: { 'application/json': { schema: RegisterPushDeviceRequestSchema } } } },
      responses: {
        204: { description: 'Registered' },
        401: errorResponse('No valid session'),
        403: errorResponse('PRINCIPAL_NOT_ACCEPTED, CROSS_SITE_REQUEST or ACCOUNT_CLOSING'),
        404: errorResponse('NOT_FOUND: push is not configured on this server'),
        422: errorResponse('Validation failed'),
      },
    }),
    async (c) => {
      configured();
      const { user, session } = personSession(c);
      const { platform, token, environment } = c.req.valid('json');
      await store.pushDevices.register({ userId: user.id, sessionId: session.id, platform, token, environment: environment ?? 'production', at: c.get('now')() });
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/v1/push-devices',
      tags: ['Push'],
      summary: 'Remove this phone’s push token (MUT-780)',
      description: 'Removes the signed-in session’s token. 204 also when there was none. Signing out (DELETE /v1/device-sessions/current) does the same.',
      security: OWN,
      responses: {
        204: { description: 'Removed, or none was held' },
        401: errorResponse('No valid session'),
        403: errorResponse('PRINCIPAL_NOT_ACCEPTED, CROSS_SITE_REQUEST or ACCOUNT_CLOSING'),
        404: errorResponse('NOT_FOUND: push is not configured on this server'),
      },
    }),
    async (c) => {
      configured();
      await store.pushDevices.removeForSession(personSession(c).session.id);
      return c.body(null, 204);
    },
  );

  return app;
}
