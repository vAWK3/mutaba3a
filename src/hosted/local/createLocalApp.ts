import { createApiShell } from '../../../server/src/app-shell.js';
import { authenticate, buildRouteAccessIndex, type RouteAccessIndex, type SessionSettings } from '../../../server/src/auth/middleware.js';
import { requestScopedStore } from '../../../server/src/auth/store-guard.js';
import type { Logger } from '../../../server/src/logger.js';
import { SlidingWindowRateLimiter } from '../../../server/src/rate-limit.js';
import type { LedgerStore } from '../../../server/src/repositories/ports.js';
import { FX_ORGANIZATION_INDEPENDENT_ROUTES } from '../../../server/src/routes/fx-rates.js';
import { ME_ORGANIZATION_INDEPENDENT_ROUTES } from '../../../server/src/routes/me.js';
import { PORTAL_ROUTES, type PortalRouteDependencies } from '../../../server/src/routes/portal-routes.js';
import { PROFILE_ORGANIZATION_INDEPENDENT_ROUTES } from '../../../server/src/routes/profiles.js';
import { LOCAL_PEPPER } from './mintLocalSession.js';

export interface CreateLocalAppOptions {
  store: LedgerStore;
  now: () => Date;
}

/**
 * `@hono/zod-openapi` lives only in `server/node_modules` (it is a server
 * dependency, not a hosted-bundle one); a file under `src/hosted/local/`
 * importing it directly would resolve node_modules from *this* file's own
 * location and fail (`Cannot find module '@hono/zod-openapi'`). Deriving the
 * type from `createApiShell`'s own return value — a function physically
 * inside `server/src`, which resolves `@hono/zod-openapi` from `server/node_modules`
 * correctly — sidesteps the problem instead of adding a package resolution.
 */
type LocalApp = ReturnType<typeof createApiShell>['app'];

/** No rate limit meaningfully applies to one local person's one tab; generous enough that normal use never trips it. Present only because `authenticate()`'s options require a `RateLimiter`. */
const LOCAL_RATE_LIMIT_PER_MINUTE = 10_000;

/**
 * `createApiShell` only ever calls `.error(...)` on this (its `onError`
 * handler, for a 5xx or an unhandled exception). Signed out there is no
 * Sentry (ADR-091 carried over) and no server log, so a route failure goes to
 * the browser console, where the person's own devtools are the only reader.
 * A minimal stub, not pino's `Logger` surface — the cast is the point.
 */
export function consoleLogger(): Logger {
  return { error: (...args: unknown[]) => console.error('[mutaba3a local]', ...args) } as unknown as Logger;
}

/**
 * The server's own route modules, run in the page (MUT-286 Phase B; brief
 * §2.1, §2.2). Same `createApiShell`, same `PORTAL_ROUTES` + `meRoutes`, same
 * `authenticate()` middleware the Node server runs for a cookie or device
 * session — local mode only ever presents a device session (`mintLocalSession`
 * mints `Authorization: Bearer mds_…`, never a cookie). The only two
 * differences from `createApp` are structural, not behavioral:
 *
 *  - no `contextStorage()`: layer 3 of the store guard (`auth/store-guard.ts`)
 *    reads Hono's context storage and no-ops when it is absent, which is safe
 *    here because the local person owns every local profile (ADR-097 §2.2) —
 *    there is no second principal for the inactive guard to have mattered for;
 *  - no CSP / `no-store` / access-logging middleware: meaningless for an
 *    in-page `fetch`-shaped call that never leaves the tab.
 *
 * `attachments: null` and `fxRates: null` degrade exactly like an
 * unconfigured hosted deployment (503 `ATTACHMENTS_NOT_CONFIGURED` / 503
 * `FX_RATES_UNAVAILABLE`) — MUT-287 wires both for local mode.
 */
export function createLocalApp(options: CreateLocalAppOptions): LocalApp {
  const { store, now } = options;
  const { app } = createApiShell({ now, logger: consoleLogger() });

  const scopedStore = requestScopedStore(store);
  const rateLimiter = new SlidingWindowRateLimiter(LOCAL_RATE_LIMIT_PER_MINUTE);
  // Never a cookie locally, so secureCookie/trustedProxyHops/idleMinutes/absoluteHours govern nothing a local request
  // exercises; they exist only because every AuthenticateOptions needs a SessionSettings. The pepper is the one field
  // that matters: it must be the same LOCAL_PEPPER mintLocalSession used to digest the token it minted.
  const sessions: SessionSettings = { pepper: LOCAL_PEPPER, idleMinutes: 60, absoluteHours: 24, secureCookie: false, trustedProxyHops: 0 };

  // Resolved lazily (authenticate()'s own contract): built from the OpenAPI registry only after every route below
  // has registered, on the first request, exactly like createApp's identical `routeAccess ??= ...` pattern.
  let routeAccess: RouteAccessIndex | undefined;
  app.use(
    '/v1/*',
    authenticate({
      // The raw store, not scopedStore: authenticate() resolves identity before any guard applies, same as createApp.
      store,
      environment: 'live',
      rateLimiter,
      sessions,
      routeAccess: () => (routeAccess ??= buildRouteAccessIndex(app.openAPIRegistry.definitions, app.routes)),
      organizationIndependent: new Set([...ME_ORGANIZATION_INDEPENDENT_ROUTES, ...PROFILE_ORGANIZATION_INDEPENDENT_ROUTES, ...FX_ORGANIZATION_INDEPENDENT_ROUTES]),
    }),
  );

  const deps: PortalRouteDependencies = { store: scopedStore, attachments: { storage: null, urlTtlSeconds: 900 }, fxRates: null };
  for (const route of PORTAL_ROUTES) app.route('/', route(deps));

  return app;
}
