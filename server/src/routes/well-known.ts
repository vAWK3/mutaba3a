import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '../auth/middleware.js';
import { AndroidAssetLinksSchema, AppleAppSiteAssociationSchema } from '../schemas.js';

export interface AppAssociationConfig {
  appleTeamId: string;
  appleBundleId: string;
  androidPackageName: string;
  androidSha256Fingerprints: string[];
}

/**
 * The three portal paths iOS/Android are allowed to open natively (MUT-111).
 * Deliberately excludes /sign-in, /clients*, /documents*, /receivables*,
 * /v1/* and /assets/* — those must keep opening in Safari/Chrome, not the app.
 */
const ALLOWED_APPLINKS_PATHS = ['/p/*/expenses*', '/p/*/payments*', '/capture*'];

/**
 * iOS/Android app-association files (MUT-111, hosted-portal.md §9-adjacent):
 * unauthenticated, no redirect, registered ahead of the portal's SPA fallback
 * in app.ts. Outside /v1/*, so outside the ADR-037 route-security matrix.
 */
export function wellKnownRoutes(config: AppAssociationConfig): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();
  const appId = `${config.appleTeamId}.${config.appleBundleId}`;
  const fingerprints = config.androidSha256Fingerprints.map((fp) => fp.trim()).filter((fp) => fp.length > 0);

  app.openapi(
    createRoute({
      method: 'get',
      path: '/.well-known/apple-app-site-association',
      tags: ['App association'],
      summary: 'iOS universal links and saved-password trust (MUT-111)',
      responses: {
        200: { description: 'AASA document', content: { 'application/json': { schema: AppleAppSiteAssociationSchema } } },
      },
    }),
    (c) =>
      c.json(
        {
          applinks: { details: [{ appID: appId, paths: ALLOWED_APPLINKS_PATHS }] },
          webcredentials: { apps: [appId] },
        },
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/.well-known/assetlinks.json',
      tags: ['App association'],
      summary: 'Android App Links and credential sharing (MUT-111)',
      responses: {
        200: { description: 'Digital Asset Links document', content: { 'application/json': { schema: AndroidAssetLinksSchema } } },
      },
    }),
    (c) =>
      c.json(
        [
          {
            relation: ['delegate_permission/common.handle_all_urls', 'delegate_permission/common.get_login_creds'],
            target: {
              namespace: 'android_app' as const,
              package_name: config.androidPackageName,
              sha256_cert_fingerprints: fingerprints,
            },
          },
        ],
        200,
      ),
  );

  return app;
}
