import { randomBytes, randomUUID } from 'node:crypto';
import { OpenAPIHono } from '@hono/zod-openapi';
import { contextStorage } from 'hono/context-storage';
import { serveStatic } from '@hono/node-server/serve-static';
import type { ApiKeyEnvironment } from './auth/api-key.js';
import { authenticate, buildRouteAccessIndex, type AppEnv, type RouteAccessIndex, type SessionSettings } from './auth/middleware.js';
import { DEFAULT_DEVICE_ABSOLUTE_DAYS, DEFAULT_DEVICE_IDLE_DAYS, SIGN_IN_POLICY, SignInThrottle } from './auth/sessions.js';
import { SCOPES } from './auth/scopes.js';
import { requestScopedStore } from './auth/store-guard.js';
import { ARGON2_MINIMUMS, createArgon2Hasher, type PasswordHasher } from './auth/users.js';
import { ApiError, ERROR_CODES } from './errors.js';
import type { Logger } from './logger.js';
import { SlidingWindowRateLimiter, type RateLimiter } from './rate-limit.js';
import type { LedgerStore } from './repositories/ports.js';
import type { AttachmentStorage } from './attachments/storage.js';
import { adminAuth, adminRoutes } from './routes/admin.js';
import { adminUserRoutes } from './routes/admin-users.js';
import { ORGANIZATION_INDEPENDENT_ROUTES, sessionRoutes } from './routes/sessions.js';
import { DEVICE_SESSION_ORGANIZATION_INDEPENDENT_ROUTES, deviceSessionRoutes } from './routes/device-sessions.js';
import { attachmentRoutes } from './routes/attachments.js';
import { auditRoutes } from './routes/audit.js';
import { summaryRoutes } from './routes/summaries.js';
import { expenseCategoryRoutes } from './routes/expense-categories.js';
import { expenseRoutes } from './routes/expenses.js';
import { incomeRoutes } from './routes/income.js';
import { INBOX_ORGANIZATION_INDEPENDENT_ROUTES } from './inbox/routes-keys.js';
import { inboxRoutes } from './routes/inbox.js';
import { agreementRoutes } from './routes/agreements.js';
import { customerRoutes } from './routes/customers.js';
import { feeProposalRoutes } from './routes/fee-proposals.js';
import { installmentRoutes } from './routes/installments.js';
import { operationRoutes } from './routes/operations.js';
import { paymentRoutes } from './routes/payments.js';
import { receivableRoutes } from './routes/receivables.js';
import { retainerRoutes } from './routes/retainers.js';
import { vatRoutes } from './routes/vat.js';
import { healthRoutes } from './routes/health.js';
import { importRoutes } from './routes/import.js';
import { integrationRoutes } from './routes/integration.js';
import { projectRoutes } from './routes/projects.js';
import { CaptureSourceSchema, CONFLICT_REASONS, VALIDATION_REASONS } from './schemas.js';

export interface AppDependencies {
  store: LedgerStore;
  logger: Logger;
  rateLimiter: RateLimiter;
  adminToken: string;
  keyEnvironment: ApiKeyEnvironment;
  version: string;
  /** Injectable clock so tests can control expiry and rate windows. */
  now?: () => Date;
  /** Attachment bytes store (M6); null or absent = attachments routes answer 503 ATTACHMENTS_NOT_CONFIGURED. */
  attachments?: AttachmentStorage | null;
  attachmentUrlTtlSeconds?: number;
  /** argon2id hasher for user passwords (MUT-37). Defaults to the OWASP minimum profile; production passes the configured one. */
  passwordHasher?: PasswordHasher;
  /** Browser sessions (MUT-38). Production passes the configured pepper and limits; tests get a random pepper and the defaults. */
  sessions?: SessionSettings;
  /** Sign-in lockout state (in process, one instance until TD-017). */
  signInThrottle?: SignInThrottle;
  /** Per-IP sign-in attempt budget. */
  signInIpLimiter?: RateLimiter;
  /** Hosted-portal static build (MUT-45). Null or absent = API-only, today's behavior. */
  portal?: { distDir: string } | null;
}

/**
 * Paths the hosted-portal SPA fallback must never catch (hosted-portal.md
 * §9): everything else GET answers the portal shell for client-side routing.
 */
const PORTAL_EXCLUDED_PREFIXES = ['/v1/', '/admin/'];
const PORTAL_EXCLUDED_EXACT = new Set(['/health', '/ready', '/openapi.json']);

function isPortalExcludedPath(path: string): boolean {
  return PORTAL_EXCLUDED_EXACT.has(path) || PORTAL_EXCLUDED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

// connect-src includes the GCS signed-URL host: receipt uploads (MUT-44) PUT
// bytes directly to it via fetch(), which connect-src governs. Downloads are
// top-level navigations instead, so they need no entry here.
const PORTAL_CSP =
  "default-src 'self'; connect-src 'self' https://storage.googleapis.com; img-src 'self' data:; frame-ancestors 'none'; form-action 'self'";

function defaultSessionSettings(): SessionSettings {
  return {
    pepper: randomBytes(32).toString('hex'),
    idleMinutes: 120,
    absoluteHours: 12,
    secureCookie: true,
    trustedProxyHops: 1,
    deviceIdleDays: DEFAULT_DEVICE_IDLE_DAYS,
    deviceAbsoluteDays: DEFAULT_DEVICE_ABSOLUTE_DAYS,
  };
}

export const API_TITLE = 'Mutaba3a Financial API';
export const API_VERSION = '1.14.0-mut61';

/**
 * Composes the HTTP application. No I/O happens here; everything it needs is
 * injected, which is what lets the route tests run against MemoryLedgerStore
 * and the contract tests against Postgres with the same app.
 */
export function createApp(deps: AppDependencies): OpenAPIHono<AppEnv> {
  const now = deps.now ?? (() => new Date());

  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        const err = new ApiError('VALIDATION_FAILED', 'Request validation failed', result.error.issues);
        return c.json(err.toEnvelope(c.get('requestId')), err.status);
      }
      return undefined;
    },
  });

  // The store guard reads the request it runs in from here (store-guard.ts).
  app.use('*', contextStorage());
  app.use('*', async (c, next) => {
    const requestId = c.req.header('x-request-id') ?? randomUUID();
    c.set('requestId', requestId);
    c.set('now', now);
    c.header('X-Request-Id', requestId);
    c.header('Cache-Control', 'no-store');
    c.header('Content-Security-Policy', PORTAL_CSP);
    const started = Date.now();
    await next();
    deps.logger.info(
      { requestId, method: c.req.method, path: c.req.path, status: c.res.status, durationMs: Date.now() - started },
      'request',
    );
  });

  app.onError((err, c) => {
    const requestId = c.get('requestId') ?? 'unknown';
    if (err instanceof ApiError) {
      if (err.status >= 500) deps.logger.error({ requestId, err }, err.message);
      return c.json(err.toEnvelope(requestId), err.status);
    }
    deps.logger.error({ requestId, err }, 'unhandled error');
    const internal = new ApiError('INTERNAL', 'Unexpected server error');
    return c.json(internal.toEnvelope(requestId), internal.status);
  });

  app.notFound((c) => {
    const err = new ApiError('NOT_FOUND', `No route for ${c.req.method} ${c.req.path}`);
    return c.json(err.toEnvelope(c.get('requestId')), err.status);
  });

  const passwordHasher = deps.passwordHasher ?? createArgon2Hasher(ARGON2_MINIMUMS);
  // Every route reaches the ledger through the guard authenticate() sets (ADR-037 decision 7); authenticate itself reads the base store.
  const store = requestScopedStore(deps.store);
  const sessions = deps.sessions ?? defaultSessionSettings();
  // Shared by the cookie and device-session sign-in routes (MUT-64): one throttle/IP-budget per email or address, whichever surface it comes from.
  const signInThrottle = deps.signInThrottle ?? new SignInThrottle();
  const signInIpLimiter = deps.signInIpLimiter ?? new SlidingWindowRateLimiter(SIGN_IN_POLICY.ipPerMinute);
  let routeAccess: RouteAccessIndex | undefined;
  app.use(
    '/v1/*',
    authenticate({
      store: deps.store,
      environment: deps.keyEnvironment,
      rateLimiter: deps.rateLimiter,
      sessions,
      // Built on first request, after every route below has registered its OpenAPI definition.
      routeAccess: () => (routeAccess ??= buildRouteAccessIndex(app.openAPIRegistry.definitions, app.routes)),
      organizationIndependent: new Set([...ORGANIZATION_INDEPENDENT_ROUTES, ...DEVICE_SESSION_ORGANIZATION_INDEPENDENT_ROUTES, ...INBOX_ORGANIZATION_INDEPENDENT_ROUTES]),
    }),
  );
  app.use('/admin/*', adminAuth(deps.adminToken));

  // MUT-61: register CaptureSource as itself before any route references it. The generator otherwise takes the first
  // use it meets as the component; Payment's nullable response field made the shared component nullable, and every
  // request body that $refs it (income, settle, expense, inbox) advertised a null the server rejects.
  app.openAPIRegistry.register('CaptureSource', CaptureSourceSchema);
  app.route('/', healthRoutes(store, deps.version));
  app.route(
    '/',
    sessionRoutes({
      store,
      passwordHasher,
      settings: sessions,
      throttle: signInThrottle,
      ipLimiter: signInIpLimiter,
    }),
  );
  app.route(
    '/',
    deviceSessionRoutes({
      store,
      passwordHasher,
      settings: sessions,
      throttle: signInThrottle,
      ipLimiter: signInIpLimiter,
    }),
  );
  app.route('/', integrationRoutes(store, deps.version));
  app.route('/', customerRoutes(store));
  app.route('/', projectRoutes(store));
  app.route('/', importRoutes(store));
  app.route('/', vatRoutes(store));
  app.route('/', feeProposalRoutes(store));
  app.route('/', agreementRoutes(store));
  app.route('/', installmentRoutes(store));
  app.route('/', retainerRoutes(store));
  app.route('/', receivableRoutes(store));
  app.route('/', paymentRoutes(store));
  app.route('/', operationRoutes(store));
  app.route('/', summaryRoutes(store));
  app.route('/', auditRoutes(store));
  app.route('/', attachmentRoutes(store, { storage: deps.attachments ?? null, urlTtlSeconds: deps.attachmentUrlTtlSeconds ?? 900 }));
  app.route('/', expenseRoutes(store, { storage: deps.attachments ?? null, urlTtlSeconds: deps.attachmentUrlTtlSeconds ?? 900 }));
  app.route('/', expenseCategoryRoutes(store));
  app.route('/', incomeRoutes(store));
  app.route('/', inboxRoutes(store));
  app.route('/', adminRoutes({ store, adminToken: deps.adminToken, keyEnvironment: deps.keyEnvironment }));
  app.route('/', adminUserRoutes({ store, passwordHasher, logger: deps.logger }));

  app.openAPIRegistry.registerComponent('securitySchemes', 'apiKey', {
    type: 'http',
    scheme: 'bearer',
    description: 'Organization API key: `Authorization: Bearer mut_live_<prefix>_<secret>`',
  });
  app.openAPIRegistry.registerComponent('securitySchemes', 'session', {
    type: 'apiKey',
    in: 'cookie',
    name: '__Host-mut_session',
    description: 'Hosted-portal session (MUT-38). Set by POST /v1/sessions; httpOnly, SameSite=Strict, same origin only. Organization-scoped calls add X-Mutaba3a-Profile: <organizationId> naming one of the user\'s memberships.',
  });
  app.openAPIRegistry.registerComponent('securitySchemes', 'deviceSession', {
    type: 'http',
    scheme: 'bearer',
    description:
      'Native-app device session (MUT-64): `Authorization: Bearer mds_<secret>`. ' +
      'Set by POST /v1/device-sessions. Same session principal and writability as the portal cookie session — ' +
      'organization-scoped calls add X-Mutaba3a-Profile: <organizationId> naming one of the user\'s memberships.',
  });
  app.openAPIRegistry.registerComponent('securitySchemes', 'adminToken', {
    type: 'apiKey',
    in: 'header',
    name: 'X-Admin-Token',
    description: 'Operator token (MUTABA3A_ADMIN_TOKEN). Provisioning only.',
  });

  app.doc('/openapi.json', {
    openapi: '3.1.0',
    info: {
      title: API_TITLE,
      version: API_VERSION,
      description: [
        'Organization-scoped financial ledger API (MUT/MAL Money v1, Milestones 1–8).',
        '',
        `Scopes: ${SCOPES.join(', ')}.`,
        '',
        `Error codes: ${Object.keys(ERROR_CODES).join(', ')}. Every error is {"error":{"code","message","details?","requestId"}}.`,
        '',
        'Financial writes require an `Idempotency-Key` header (8–128 chars). Same key + same body replays the stored outcome; same key + different body is rejected with IDEMPOTENCY_KEY_REUSED.',
        '',
        'PATCH routes require `If-Match: <version>` (optimistic concurrency).',
        '',
        `409 CONFLICT responses carry details.reason, one of: ${CONFLICT_REASONS.join(', ')}.`,
        '',
        `422 VALIDATION_FAILED responses raised by business rules carry details.reason, one of: ${VALIDATION_REASONS.join(', ')} (schema failures carry the zod issues in details instead).`,
        '',
        'Amounts are canonical decimal strings in the project currency; dates are YYYY-MM-DD in the organization timezone. VAT rates are basis points (1800 = 18 %).',
        '',
        'Payments (M4): a receivable\'s outstanding = gross − paid − credited. Allocations never cross a customer or a currency. GET /v1/operations/{key} reconciles a lost response: COMPLETED with the stored body, PENDING, or 404 (never completed; retry with the same key is safe).',
        '',
        'Lists paginate with ?limit= (1–200, default 50) and an opaque ?cursor= from the previous page\'s nextCursor.',
        '',
        'Fee proposals (M7, lifecycle revised in M8) hold the negotiation before a fixed-fee agreement: PROPOSED → APPROVED (POST /v1/fee-proposals/{id}/approve creates the agreement, dated approvedOn, in the same transaction; the first installment posts at once, later ones on their dates) or WITHDRAWN. One open proposal per project; archiving a project is refused while one is open. Project summaries carry the current proposal; the organization summary carries each customer\'s open proposals and their per-currency total (proposed).',
        '',
        'Users (MUT-37) are operator-provisioned through /admin/v1/users*: no signup, invite or self-service password reset exists in any environment. A user reaches organizations through memberships.',
        '',
        'Writability (MUT-39): a session may read a hosted profile\'s ledger but not write it. A session calling an operation that writes customers, projects, agreements, payments or attachments gets 403 READ_ONLY_PROFILE with details { domain, writerOfRecord } (writerOfRecord is MALAFAT when the profile\'s Malafat integration is connected, otherwise null); other operations it may not use answer 403 PRINCIPAL_NOT_ACCEPTED.',
        '',
        'Expenses (MUT-42) are a hosted profile\'s own record, written by the signed-in person: /v1/expenses*, /v1/expense-categories* and /v1/summaries/expenses accept sessions only, never an API key, and nothing about them appears in any operation an API key can call (audit and operations included). Each expense keeps its original amount and currency; summaries are per currency. Receipts use the attachments bucket and signed-URL lifetime. The expenses:read / expenses:write scopes are session-only and cannot be issued to a key.',
        '',
        'Sessions (MUT-38): POST /v1/sessions signs in and sets an httpOnly same-origin cookie. Each operation declares the principals it accepts in `security` (apiKey, session, or both); a request carrying both credentials is refused. Session requests to organization-scoped operations send X-Mutaba3a-Profile; a non-member organization answers 404, like any cross-organization id.',
        '',
        'Income (MUT-65): on a personal profile (no CONNECTED Malafat integration), a session may write customers, projects and payments — the three rows hosted-portal.md §5 marks "read-write on a personal profile" — through the same routes a Malafat-fed profile only reads, plus two new ones: POST /v1/income (kind: received|owed; Owed requires a customerId, explicit or resolved from projectId) and DELETE /v1/income/{id} (undo, 404 for anything not this session\'s own ADJUSTMENT receivable or unallocated payment). POST /v1/receivables/{id}/settle records a payment against one receivable without the preview/allocation dance. A Malafat-fed profile keeps today\'s read-only behaviour on all of it (403 READ_ONLY_PROFILE) except what MUT-61 opens below.',
        '',
        'Capture on a Malafat-fed profile (MUT-61): a session may POST /v1/income kind received — never owed (403 READ_ONLY_PROFILE) — for a client this integration has linked (customer.externalReference set; else 422 CUSTOMER_REQUIRED / CUSTOMER_NOT_LINKED), with an optional matter of that client whose currency it must match (422 CURRENCY_MISMATCH). The payment is POSTED, unallocated and origin `capture`; GET /v1/payments?customerId=…&origin=capture&allocationState=unallocated lists what still needs allocating, through the usual allocation preview and POST /v1/payments/{id}/allocations. The person may undo it (DELETE /v1/income/{id}) until any of it is allocated (409 ALREADY_ALLOCATED); once the integration reverses it, their undo answers 409 REVERSED_BY_MALAFAT. GET /v1/me publishes each profile\'s rules as `income`.',
        '',
        'Summaries (M6) are computed on read: outstanding = overdue + dueToday + notYetDue over OPEN receivables; statuses are Mutaba3a\'s. Attachments are reached only through short-lived signed URLs; 503 ATTACHMENTS_NOT_CONFIGURED when the deployment has no bucket.',
      ].join('\n'),
    },
    tags: [
      { name: 'Operations', description: 'Liveness and readiness' },
      { name: 'Integration', description: 'Credential validation and tenant binding' },
      { name: 'Customers', description: 'The parties money is owed by' },
      { name: 'Projects', description: 'Single-currency containers for agreements, receivables and payments' },
      { name: 'Import', description: 'Batch linking of an external system\'s customers and projects' },
      { name: 'VAT', description: 'The firm\'s effective-dated standard rate' },
      { name: 'Fee proposals', description: 'The negotiation before a fixed-fee agreement: proposed, then approved (which creates the agreement) or withdrawn' },
      { name: 'Agreements', description: 'Fixed-fee agreements, installments, supplements' },
      { name: 'Installments', description: 'Manual triggers' },
      { name: 'Retainers', description: 'Recurring agreements and their monthly charges' },
      { name: 'Receivables', description: 'What is owed, and credits against it' },
      { name: 'Payments', description: 'Money received, its allocations, reversals, and the operations lookup' },
      { name: 'Sessions', description: 'Hosted-portal sign-in, sign-out and the signed-in person' },
      { name: 'Expenses', description: 'A hosted profile\'s expenses, categories, receipts and expense summary (sessions only)' },
      { name: 'Income', description: 'Received or Owed, captured directly by the signed-in person on a personal profile (sessions only)' },
      { name: 'Admin', description: 'Operator provisioning: organizations, API keys, users and memberships' },
    ],
  });

  // Hosted portal (MUT-45, hosted-portal.md §9): registered after every API
  // route so a real route always wins; the handler itself still excludes API
  // prefixes for paths no route matched, so a bad /v1 or /admin path keeps
  // answering JSON, never the portal shell.
  if (deps.portal) {
    const { distDir } = deps.portal;

    // Any real file in the build (hashed assets, favicon, manifest, …); a miss
    // falls through to the SPA-shell handler below via Hono's own next().
    // Immutable caching applies only to an actual hit under /assets/* —
    // onFound fires only when serveStatic found and is serving the file, so a
    // stale/nonexistent hashed filename (after a deploy rotates them) still
    // falls through to the SPA shell with the default no-store header,
    // instead of being cached as a broken response for a year.
    app.use('*', async (c, next) => {
      if (isPortalExcludedPath(c.req.path)) return next();
      let foundUnderAssets = false;
      const result = await serveStatic({
        root: distDir,
        onFound: (_path, c) => {
          if (c.req.path.startsWith('/assets/')) foundUnderAssets = true;
        },
      })(c, next);
      // c.header() cannot reach this response: serveStatic already built it
      // with c.body() before onFound ran, which bakes in a header snapshot
      // decoupled from the context's own headers. Mutate the Response's own
      // Headers object directly instead.
      if (foundUnderAssets && result instanceof Response) {
        result.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
      }
      return result;
    });

    app.get('*', async (c, next) => {
      if (isPortalExcludedPath(c.req.path)) return next();
      return serveStatic({ root: distDir, path: '/index.html' })(c, next);
    });
  }

  return app;
}
