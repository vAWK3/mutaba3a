import { randomBytes } from 'node:crypto';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { contextStorage } from 'hono/context-storage';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApiShell } from './app-shell.js';
import type { ApiKeyEnvironment } from './auth/api-key.js';
import { authenticate, buildRouteAccessIndex, type AppEnv, type RouteAccessIndex, type SessionSettings } from './auth/middleware.js';
import { requireMinimumBuild, type MinimumBuildConfig } from './auth/minimum-build.js';
import { DEFAULT_DEVICE_ABSOLUTE_DAYS, DEFAULT_DEVICE_IDLE_DAYS, LEGACY_CARRY_OVER_PATH, SIGN_IN_POLICY, SignInThrottle, isViaFrontDoor } from './auth/sessions.js';
import { SCOPES } from './auth/scopes.js';
import { requestScopedStore } from './auth/store-guard.js';
import { ARGON2_MINIMUMS, createArgon2Hasher, type PasswordHasher } from './auth/users.js';
import { ERROR_CODES } from './errors.js';
import { CURRENT_TERMS, type CurrentTerms } from './legal.js';
import type { CachedFxRates } from './fx-rates.js';
import type { Logger } from './logger.js';
import { NOOP_REPORTER, type ErrorReporter } from './observability/reporter.js';
import { SENTRY_INGEST_ORIGIN } from './observability/sentry-ingest.js';
import { SlidingWindowRateLimiter, type RateLimiter } from './rate-limit.js';
import type { LedgerStore } from './repositories/ports.js';
import type { AttachmentStorage } from './attachments/storage.js';
import { adminAuth, adminRoutes, jobAuth } from './routes/admin.js';
import { adminBillingRoutes } from './routes/admin-billing.js';
import { STRIPE_WEBHOOK_POLICY, stripeBillingRoutes } from './routes/stripe-billing.js';
import type { StripeGateway } from './billing/stripe/gateway.js';
import type { CheckoutGateway } from './billing/stripe/checkout-gateway.js';
import { BILLING_COUNTRIES, type BillingCountries } from './billing/checkout.js';
import { createStripeSync } from './billing/stripe/sync.js';
import { BILLING_ORGANIZATION_INDEPENDENT_ROUTES, BILLING_SESSION_POLICY, billingRoutes } from './routes/billing.js';
import { adminUserRoutes } from './routes/admin-users.js';
import { ORGANIZATION_INDEPENDENT_ROUTES, sessionRoutes } from './routes/sessions.js';
import { ME_ORGANIZATION_INDEPENDENT_ROUTES } from './routes/me.js';
import { DEVICE_SESSION_ORGANIZATION_INDEPENDENT_ROUTES, deviceSessionRoutes } from './routes/device-sessions.js';
import { accountSetupRoutes } from './routes/account-setup.js';
import { auditRoutes } from './routes/audit.js';
import { PROFILE_ORGANIZATION_INDEPENDENT_ROUTES } from './routes/profiles.js';
import { FX_ORGANIZATION_INDEPENDENT_ROUTES, PUBLIC_FX_POLICY, publicFxRateRoutes } from './routes/fx-rates.js';
import { INBOX_ORGANIZATION_INDEPENDENT_ROUTES } from './inbox/routes-keys.js';
import { inboxRoutes } from './routes/inbox.js';
import { ENTRIES_ORGANIZATION_INDEPENDENT_ROUTES, entriesRoutes } from './routes/entries.js';
import { agreementRoutes } from './routes/agreements.js';
import { contingencyRoutes } from './routes/contingency.js';
import { feeProposalRoutes } from './routes/fee-proposals.js';
import { installmentRoutes } from './routes/installments.js';
import { operationRoutes } from './routes/operations.js';
import { PORTAL_ROUTES, type PortalRouteDependencies } from './routes/portal-routes.js';
import { recordsExportRoutes } from './routes/records-export.js';
import { RECEIPT_UPLOAD_POLICY, receiptRoutes } from './routes/receipts.js';
import { retainerRoutes } from './routes/retainers.js';
import { vatRoutes } from './routes/vat.js';
import { healthRoutes } from './routes/health.js';
import { importRoutes } from './routes/import.js';
import { integrationRoutes } from './routes/integration.js';
import { wellKnownRoutes, type AppAssociationConfig } from './routes/well-known.js';
import { CaptureSourceSchema, CONFLICT_REASONS, TermsStatusSchema, VALIDATION_REASONS } from './schemas.js';
import { DAYS_IN_PAST_LIMIT } from './agreements/compose.js';

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
  /** MUT-324: the terms people accept. Defaults to CURRENT_TERMS; a test passes a later version to act out a release that bumps them. */
  terms?: CurrentTerms;
  /** Browser sessions (MUT-38). Production passes the configured pepper and limits; tests get a random pepper and the defaults. */
  sessions?: SessionSettings;
  /** Sign-in lockout state (in process, one instance until TD-017). */
  signInThrottle?: SignInThrottle;
  /** Per-IP sign-in attempt budget. */
  signInIpLimiter?: RateLimiter;
  /** Hosted-portal static build (MUT-45). Null or absent = API-only, today's behavior. */
  portal?: { distDir: string } | null;
  /** iOS/Android app-association files (MUT-111). Null or absent = neither well-known path exists. */
  appAssociation?: AppAssociationConfig | null;
  /** Reference exchange rates (MUT-228), cached per instance. Null or absent = GET /v1/fx-rates answers 503 FX_RATES_UNAVAILABLE. */
  fxRates?: CachedFxRates | null;
  /** Per-IP budget for the anonymous GET /v1/public/fx-rates (MUT-287). Defaults to PUBLIC_FX_POLICY. */
  publicFxIpLimiter?: RateLimiter;
  /** MUT-293 minimum app version gate. Null or absent = no platform gated (every floor/recommended undefined, check not disabled). */
  minimumBuild?: MinimumBuildConfig | null;
  /**
   * MUT-360: Stripe, one gateway per budget (D7: the webhook answers fast, reconcile is patient). Null or absent = the
   * webhook and both reconcile routes answer 503 BILLING_NOT_CONFIGURED. MUT-362: `checkoutGateway` is the write door
   * for Settings › Billing; absent = GET /v1/billing says `configured: false` and its two POSTs answer 503.
   */
  stripe?: { webhookGateway: StripeGateway; reconcileGateway: StripeGateway; checkoutGateway?: CheckoutGateway } | null;
  /** MUT-362: the consumer-country rules. Defaults to the shipped billing-countries.json. */
  billingCountries?: BillingCountries;
  /** MUT-362: per-person budget for billing session requests. Defaults to BILLING_SESSION_POLICY. */
  billingSessionLimiter?: RateLimiter;
  /** MUT-360 D2: the nightly Scheduler job's token. Null or absent = /jobs/* answers 503 JOBS_NOT_CONFIGURED. */
  jobToken?: string | null;
  /** Per-IP budget for the Stripe webhook. Defaults to STRIPE_WEBHOOK_POLICY. */
  stripeWebhookIpLimiter?: RateLimiter;
  /** MUT-255: per-person budget for starting receipts-library uploads. Defaults to RECEIPT_UPLOAD_POLICY. */
  receiptUploadLimiter?: RateLimiter;
  /**
   * MUT-389 (RECEIPTS_LIBRARY): mounts the receipts library and makes deleting an expense keep its READY receipts To
   * review. Absent or false = no /v1/receipts* routes, and a deleted expense takes its receipts with it (pre-MUT-255).
   */
  receiptsLibrary?: boolean;
  /** MUT-148 (ADR-091): where 5xx and unknown errors are reported. Absent = nowhere; /health says "off". */
  reporter?: ErrorReporter;
}

const NO_MINIMUM_BUILD_CONFIG: MinimumBuildConfig = { ios: {}, android: {}, disabled: false };

/**
 * Paths the hosted-portal SPA fallback must never catch (hosted-portal.md
 * §9): everything else GET answers the portal shell for client-side routing.
 * The two well-known paths are included even though a real route registered
 * earlier already wins regardless (MUT-111): this is the same belt-and-
 * suspenders reasoning as /health, /ready and /openapi.json — if an operator
 * deploys the portal without appAssociation configured, these paths must
 * still 404 as JSON, never silently serve the SPA shell to an Apple/Google
 * crawler.
 */
const PORTAL_EXCLUDED_PREFIXES = ['/v1/', '/admin/', '/jobs/'];
const PORTAL_EXCLUDED_EXACT = new Set([
  '/health',
  '/ready',
  '/openapi.json',
  '/.well-known/apple-app-site-association',
  '/.well-known/assetlinks.json',
]);

function isPortalExcludedPath(path: string): boolean {
  return PORTAL_EXCLUDED_EXACT.has(path) || PORTAL_EXCLUDED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * MUT-326 (ADR-155 D5): a portal page visit the legacy-host redirect may move. Never
 * the API, admin, health or association paths, never a static file (an old cached
 * page's script must still load from 'self'), never a write, and never the carry-over
 * page itself, which has to read this origin's local records.
 */
function isLegacyPageVisit(method: string, path: string): boolean {
  if (method !== 'GET' && method !== 'HEAD') return false;
  if (isPortalExcludedPath(path) || path.startsWith('/.well-known/') || path.startsWith('/assets/')) return false;
  if (path === LEGACY_CARRY_OVER_PATH) return false;
  return !(path.split('/').pop() ?? '').includes('.');
}

// connect-src includes the GCS signed-URL host: receipt uploads (MUT-44) PUT
// bytes directly to it via fetch(), which connect-src governs. Downloads are
// top-level navigations instead, so they need no entry here. It also names
// PostHog's EU ingestion host for the portal's opt-in usage counts (MUT-155,
// ADR-090): the SDK loads from the portal's own bundle, so script-src stays 'self'.
// And the Sentry org's EU ingest host, for the portal's crash reports (MUT-149 AC5).
const PORTAL_CSP = `default-src 'self'; connect-src 'self' https://storage.googleapis.com https://eu.i.posthog.com ${SENTRY_INGEST_ORIGIN}; img-src 'self' data:; frame-ancestors 'none'; form-action 'self'`;

/** A source map: uploaded to Sentry at build time, never served (MUT-149 AC4, D6 layer 3). */
const isSourceMap = (path: string) => path.endsWith('.map');

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

export const API_TITLE = 'MTB3A Financial API';
export const API_VERSION = '1.54.0-mut340';

/**
 * Composes the HTTP application. No I/O happens here; everything it needs is
 * injected, which is what lets the route tests run against MemoryLedgerStore
 * and the contract tests against Postgres with the same app.
 */
export function createApp(deps: AppDependencies): OpenAPIHono<AppEnv> {
  const now = deps.now ?? (() => new Date());

  const reporter = deps.reporter ?? NOOP_REPORTER;
  const { app } = createApiShell({ now, logger: deps.logger, reporter });

  // The store guard reads the request it runs in from here (store-guard.ts).
  app.use('*', contextStorage());
  app.use('*', async (c, next) => {
    c.header('X-Request-Id', c.get('requestId'));
    c.header('Cache-Control', 'no-store');
    c.header('Content-Security-Policy', PORTAL_CSP);
    const started = Date.now();
    await next();
    deps.logger.info(
      { requestId: c.get('requestId'), method: c.req.method, path: c.req.path, status: c.res.status, durationMs: Date.now() - started },
      'request',
    );
  });

  const passwordHasher = deps.passwordHasher ?? createArgon2Hasher(ARGON2_MINIMUMS);
  const terms = deps.terms ?? CURRENT_TERMS;
  // Every route reaches the ledger through the guard authenticate() sets (ADR-037 decision 7); authenticate itself reads the base store.
  const store = requestScopedStore(deps.store);
  const sessions = deps.sessions ?? defaultSessionSettings();
  // Shared by the cookie and device-session sign-in routes (MUT-64): one throttle/IP-budget per email or address, whichever surface it comes from.
  const signInThrottle = deps.signInThrottle ?? new SignInThrottle();
  const signInIpLimiter = deps.signInIpLimiter ?? new SlidingWindowRateLimiter(SIGN_IN_POLICY.ipPerMinute);
  let routeAccess: RouteAccessIndex | undefined;
  // Built on first request, after every route below has registered its OpenAPI definition. Shared with requireMinimumBuild (MUT-293) so both answer "is this route public" from the one index.
  const resolveRouteAccess = (): RouteAccessIndex => (routeAccess ??= buildRouteAccessIndex(app.openAPIRegistry.definitions, app.routes));
  app.use(
    '/v1/*',
    requireMinimumBuild({
      config: deps.minimumBuild ?? NO_MINIMUM_BUILD_CONFIG,
      routeAccess: resolveRouteAccess,
      logger: deps.logger,
    }),
  );
  app.use(
    '/v1/*',
    authenticate({
      store: deps.store,
      environment: deps.keyEnvironment,
      rateLimiter: deps.rateLimiter,
      sessions,
      routeAccess: resolveRouteAccess,
      organizationIndependent: new Set([...ORGANIZATION_INDEPENDENT_ROUTES, ...ME_ORGANIZATION_INDEPENDENT_ROUTES, ...DEVICE_SESSION_ORGANIZATION_INDEPENDENT_ROUTES, ...INBOX_ORGANIZATION_INDEPENDENT_ROUTES, ...PROFILE_ORGANIZATION_INDEPENDENT_ROUTES, ...FX_ORGANIZATION_INDEPENDENT_ROUTES, ...ENTRIES_ORGANIZATION_INDEPENDENT_ROUTES, ...BILLING_ORGANIZATION_INDEPENDENT_ROUTES]),
    }),
  );
  app.use('/admin/*', adminAuth(deps.adminToken));
  app.use('/jobs/*', jobAuth(deps.jobToken ?? null));

  // MUT-61: register CaptureSource as itself before any route references it. The generator otherwise takes the first
  // use it meets as the component; Payment's nullable response field made the shared component nullable, and every
  // request body that $refs it (income, settle, expense, inbox) advertised a null the server rejects.
  app.openAPIRegistry.register('CaptureSource', CaptureSourceSchema);
  // MUT-324 review: the same for TermsStatus. Me.terms is nullable; the accept route's 200 is not.
  app.openAPIRegistry.register('TermsStatus', TermsStatusSchema);
  app.route('/', healthRoutes(store, deps.version, reporter.enabled));
  app.route(
    '/',
    sessionRoutes({
      store,
      passwordHasher,
      settings: sessions,
      throttle: signInThrottle,
      ipLimiter: signInIpLimiter,
      terms,
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
      terms,
    }),
  );
  // MUT-235: the setup-link routes share the sign-in IP limiter, under their own key.
  app.route('/', accountSetupRoutes({ store, passwordHasher, settings: sessions, ipLimiter: signInIpLimiter, throttle: signInThrottle, terms }));
  app.route('/', integrationRoutes(store, deps.version));
  app.route('/', importRoutes(store));
  app.route('/', vatRoutes(store));
  app.route('/', feeProposalRoutes(store));
  app.route('/', agreementRoutes(store));
  app.route('/', contingencyRoutes(store));
  app.route('/', installmentRoutes(store));
  app.route('/', retainerRoutes(store));
  app.route('/', operationRoutes(store));
  app.route('/', auditRoutes(store));
  app.route('/', inboxRoutes(store));
  app.route('/', entriesRoutes(store));
  const portalRouteDeps: PortalRouteDependencies = {
    store,
    attachments: { storage: deps.attachments ?? null, urlTtlSeconds: deps.attachmentUrlTtlSeconds ?? 900 },
    fxRates: deps.fxRates ?? null,
    terms,
    billing: true,
    receiptsLibrary: deps.receiptsLibrary ?? false,
  };
  for (const route of PORTAL_ROUTES) app.route('/', route(portalRouteDeps));
  // MUT-325: signed in only, so outside PORTAL_ROUTES; signed out, Your data writes the same file from this device.
  app.route('/', recordsExportRoutes(store, { storage: deps.attachments ?? null, logger: deps.logger }));
  // MUT-362: signed in only and person-level, so outside PORTAL_ROUTES (the signed-out portal has no billing).
  app.route(
    '/',
    billingRoutes(store, {
      checkout: deps.stripe?.checkoutGateway ?? null,
      countries: deps.billingCountries ?? BILLING_COUNTRIES,
      limiter: deps.billingSessionLimiter ?? new SlidingWindowRateLimiter(BILLING_SESSION_POLICY.perMinute),
      portalOrigin: sessions.portalOrigin,
      logger: deps.logger,
    }),
  );
  // MUT-255 (decision P1): the receipts library is hosted only, so outside PORTAL_ROUTES; signed-out local mode has none.
  // MUT-389: and only where RECEIPTS_LIBRARY turns it on.
  if (deps.receiptsLibrary) {
    app.route(
      '/',
      receiptRoutes(store, {
        storage: deps.attachments ?? null,
        urlTtlSeconds: deps.attachmentUrlTtlSeconds ?? 900,
        uploadLimiter: deps.receiptUploadLimiter ?? new SlidingWindowRateLimiter(RECEIPT_UPLOAD_POLICY.perMinute),
      }),
    );
  }
  // Outside PORTAL_ROUTES on purpose: the signed-out portal's backend fetches it over the network, and must never serve it itself.
  app.route('/', publicFxRateRoutes({ rates: deps.fxRates ?? null, ipLimiter: deps.publicFxIpLimiter ?? new SlidingWindowRateLimiter(PUBLIC_FX_POLICY.ipPerMinute), trustedProxyHops: sessions.trustedProxyHops, ...(sessions.frontDoorToken ? { frontDoorToken: sessions.frontDoorToken } : {}) }));
  app.route('/', adminRoutes({ store, adminToken: deps.adminToken, keyEnvironment: deps.keyEnvironment }));
  app.route('/', adminUserRoutes({ store, logger: deps.logger, sessions, terms }));
  app.route('/', adminBillingRoutes(store, { checkout: deps.stripe?.checkoutGateway ?? null, countries: deps.billingCountries ?? BILLING_COUNTRIES }));
  // MUT-360: outside PORTAL_ROUTES (the local app has no Stripe); the sync writes on the unguarded store (ADR-162 decision 6).
  const stripe = deps.stripe
    ? {
        webhookGateway: deps.stripe.webhookGateway,
        sync: createStripeSync({ store: deps.store, webhookGateway: deps.stripe.webhookGateway, reconcileGateway: deps.stripe.reconcileGateway, ...(deps.stripe.checkoutGateway ? { invoiceTaxNumbers: deps.stripe.checkoutGateway } : {}), logger: deps.logger, now }),
      }
    : null;
  app.route(
    '/',
    stripeBillingRoutes({
      stripe,
      ipLimiter: deps.stripeWebhookIpLimiter ?? new SlidingWindowRateLimiter(STRIPE_WEBHOOK_POLICY.ipPerMinute),
      trustedProxyHops: sessions.trustedProxyHops,
      ...(sessions.frontDoorToken ? { frontDoorToken: sessions.frontDoorToken } : {}),
    }),
  );
  if (deps.appAssociation) app.route('/', wellKnownRoutes(deps.appAssociation));

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
  app.openAPIRegistry.registerComponent('securitySchemes', 'jobToken', {
    type: 'apiKey',
    in: 'header',
    name: 'X-Job-Token',
    description: 'The nightly Cloud Scheduler job (MUTABA3A_JOB_TOKEN, MUT-360). Opens /jobs/* only.',
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
        'Financial writes require an `Idempotency-Key` header (8–128 chars). Same key + same body replays the stored outcome; same key + different body is rejected with IDEMPOTENCY_KEY_REUSED. A JSON body is compared by meaning: key order, whitespace and escaping (`\\/`, `\\u00e9`) do not count; array order and values do.',
        '',
        'PATCH routes require `If-Match: <version>` (optimistic concurrency).',
        '',
        'Minimum app version (MUT-293): a phone client sends `X-App-Platform: ios|android` and `X-App-Build: <int>` on every request. Below the configured floor for that platform, every endpoint except sign-in (`POST /v1/sessions`, `POST /v1/device-sessions`) and `/health` answers 426 APP_UPDATE_REQUIRED with `details: { platform, minimumBuild }`. Between the floor and the configured recommended build, the request still succeeds but carries `X-Update-Available: true` and `X-Recommended-Build: <int>`. A request with no `X-App-Platform` header (the portal, or any build older than this contract version) is untouched — this is scoped to the phone API only, not enforced against it.',
        '',
        `409 CONFLICT responses carry details.reason, one of: ${CONFLICT_REASONS.join(', ')}.`,
        '',
        `422 VALIDATION_FAILED responses raised by business rules carry details.reason, one of: ${VALIDATION_REASONS.join(', ')} (schema failures carry the zod issues in details instead).`,
        `A DATE_INVALID on a range check also carries details.bound: past when the date is more than ten years (${DAYS_IN_PAST_LIMIT} days) before the organization's today (the floor on every money date, MUT-227), future when it is later than allowed.`,
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
        'Capture on a Malafat-fed profile (MUT-61): a session may POST /v1/income kind received — never owed (403 READ_ONLY_PROFILE) — for a client this integration has linked (customer.externalReference set; else 422 CUSTOMER_REQUIRED / CUSTOMER_NOT_LINKED), with an optional matter of that client whose currency it must match (422 CURRENCY_MISMATCH). The payment is POSTED, unallocated and origin `capture`; GET /v1/payments?customerId=…&origin=capture&allocationState=unallocated lists what still needs allocating, through the usual allocation preview and POST /v1/payments/{id}/allocations. The person may undo it (DELETE /v1/income/{id}) until any of it is allocated (409 ALREADY_ALLOCATED); once the integration reverses it, their undo answers 409 REVERSED_BY_MALAFAT (the reversal reason "capture_undo" is reserved for the person: 422 REASON_RESERVED). GET /v1/me publishes each profile\'s rules as `income`.',
        '',
        'Changing a date (MUT-223): on a profile the person owns (their personal profile or one they created), PATCH /v1/income/{id} { occurredOn } moves their own Owed entry or Received entry, and PATCH /v1/payments/{id} { receivedOn } moves their own captured payment, a settle payment included (allocations untouched). Date only, If-Match on `version` (stale → 409 VERSION_MISMATCH). Received entries and payments go no later than the organization\'s today; an Owed entry may go up to ten years after it (MUT-392), keeping its dueDate unless the new date passes it (then EOM_15 of the new date). Nothing is refused once money is applied: an Owed dated ahead may be settled, or moved ahead after a settle, and counts from its first payment or credit. Anything else answers 404 — on a Malafat-fed profile PATCH /v1/income too, while PATCH /v1/payments answers 403 READ_ONLY_PROFILE there, before any lookup, as settle does. GET /v1/audit never lists these edits.',
        '',
        'Summaries (M6) are computed on read: outstanding = overdue + dueToday + notYetDue over OPEN receivables, where an Owed dated ahead counts from its own date, or from its first payment or credit if that comes first, and adds no customer row or currency block until then (MUT-392); statuses are MTB3A\'s. Attachments are reached only through short-lived signed URLs; 503 ATTACHMENTS_NOT_CONFIGURED when the deployment has no bucket.',
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
      { name: 'Profiles', description: 'A signed-in person\'s own standalone profiles: create, rename, default currency and type (sessions only; never a Malafat organization)' },
      { name: 'Expenses', description: 'A hosted profile\'s expenses, categories, receipts and expense summary (sessions only)' },
      { name: 'Receipts', description: 'The receipts library (MUT-255/389): receipts that wait To review before their expense (sessions only). Mounted only where the deployment turns RECEIPTS_LIBRARY on; elsewhere every /v1/receipts path answers 404' },
      { name: 'Income', description: 'Received or Owed, captured directly by the signed-in person on a personal profile (sessions only)' },
      { name: 'Your data', description: 'Download my records: a profile as the records file the signed-out portal restores, and its receipt files (sessions only)' },
      { name: 'Admin', description: 'Operator provisioning: organizations, API keys, users and memberships' },
    ],
  });

  // Hosted portal (MUT-45, hosted-portal.md §9): registered after every API
  // route so a real route always wins; the handler itself still excludes API
  // prefixes for paths no route matched, so a bad /v1 or /admin path keeps
  // answering JSON, never the portal shell.
  if (deps.portal) {
    const { distDir } = deps.portal;

    // MUT-326 stage "redirect": page visits that bypass the front door go through the carry-over page.
    const { legacyRedirect, frontDoorToken } = sessions;
    if (legacyRedirect && frontDoorToken) {
      app.use('*', async (c, next) => {
        if (!isLegacyPageVisit(c.req.method, c.req.path) || isViaFrontDoor((name) => c.req.header(name), frontDoorToken)) return next();
        const url = new URL(c.req.url);
        return c.redirect(`${LEGACY_CARRY_OVER_PATH}?next=${encodeURIComponent(url.pathname + url.search)}`, 302);
      });
    }

    // Any real file in the build (hashed assets, favicon, manifest, …); a miss
    // falls through to the SPA-shell handler below via Hono's own next().
    // Immutable caching applies only to an actual hit under /assets/* —
    // onFound fires only when serveStatic found and is serving the file, so a
    // stale/nonexistent hashed filename (after a deploy rotates them) still
    // falls through to the SPA shell with the default no-store header,
    // instead of being cached as a broken response for a year.
    app.use('*', async (c, next) => {
      if (isPortalExcludedPath(c.req.path)) return next();
      if (isSourceMap(c.req.path)) return c.notFound();
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
