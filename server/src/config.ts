import { parseLiveJurisdictions } from './issuing/jurisdictions.js';
import { isIP } from 'node:net';
import { dirname, isAbsolute, resolve } from 'node:path';
import { webauthnConfigOf } from './auth/webauthn.js';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { ARGON2_MINIMUMS } from './auth/users.js';
import { isUnownedDomain } from './email/ports.js';
import { isTurnstileTestSecret, TURNSTILE_TEST_SECRETS } from './auth/turnstile.js';
import { SELF_SERVICE_POLICY } from './auth/self-service.js';

/** Rates must not travel in cleartext; a local stub (tests, QA against a local server) may use plain http. */
function isHttpsOrLocalHttp(value: string): boolean {
  // zod runs a refine even after .url() has failed; a value URL can't parse is reported by .url().
  if (!URL.canParse(value)) return true;
  const url = new URL(value);
  return url.protocol === 'https:' || (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1'));
}

/** MUT-595: a firm's Malafat origin, http(s); production and staging must be https (checked with the environment below). */
function isMalafatOrigin(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return url.protocol === 'https:' || url.protocol === 'http:';
}

/** ADR-091 D5: the same EU-region rule as the Sentry module's sentry_key postcondition. */
export const SENTRY_EU_DSN =/^https:\/\/[A-Za-z0-9]+@[A-Za-z0-9.-]+\.ingest\.de\.sentry\.io\/\d+$/;

/**
 * MUT-472 (ADR-211): the values server/.env.example ships for secrets all start with "replace-with-", and each is long
 * enough to pass the 32-character minimum. A copied example must not boot a server anyone could sign in to as operator.
 */
const PLACEHOLDER_SECRET = /^replace-with-/i;

/** A secret of at least 32 characters that is not the .env.example placeholder; both messages name the variable. */
function secret(name: string) {
  return z
    .string()
    .min(32, `${name} must be at least 32 characters`)
    .refine((value) => !PLACEHOLDER_SECRET.test(value), `${name} is the placeholder from server/.env.example; put a real secret here (openssl rand -hex 32)`);
}

/**
 * Validated process configuration. Fails fast at boot with a readable list of
 * what is missing — a half-configured ledger service must not start.
 *
 * Nothing here is read anywhere else via `process.env`; every consumer takes
 * a `Config` so tests can construct one without touching the environment.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  /**
   * MUT-463: the address to listen on; local QA servers set 127.0.0.1. Unset = Node's default, every interface (Cloud
   * Run). IP addresses only: a name binds to its first resolved address, and localhost resolves to ::1 first on macOS.
   */
  HOST: z.string().refine((value) => isIP(value) !== 0, 'must be an IP address, such as 127.0.0.1').optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().url(),
  MUTABA3A_ADMIN_TOKEN: secret('MUTABA3A_ADMIN_TOKEN'),
  API_KEY_ENVIRONMENT: z.enum(['live', 'test']),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(300),
  SERVICE_VERSION: z.string().min(1).default('0.0.0-dev'),
  /** Private GCS bucket for attachments (M6). Absent = attachments routes answer 503 ATTACHMENTS_NOT_CONFIGURED. */
  ATTACHMENTS_BUCKET: z.string().min(3).optional(),
  ATTACHMENTS_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  /**
   * MUT-396: where attachment bytes live. Unset = GCS when ATTACHMENTS_BUCKET is set, else none (503). `local` keeps
   * them on disk under ATTACHMENTS_DIR and serves their signed URLs at /dev/attachments: for the dev server and local
   * QA only, refused in production and staging.
   */
  ATTACHMENTS_DRIVER: z.enum(['gcs', 'local']).optional(),
  /** MUT-396: the local driver's folder; relative paths are resolved against the server package, not the cwd. */
  ATTACHMENTS_DIR: z.string().min(1).default('.data/attachments'),
  /** MUT-228: the ECB reference-rate provider's `latest` endpoint, how long a snapshot is fresh, and how long to wait for it. */
  FX_RATES_URL: z
    .string()
    .url()
    .refine(isHttpsOrLocalHttp, 'must be https (plain http only for localhost or 127.0.0.1)')
    .default('https://api.frankfurter.dev/v1/latest'),
  FX_RATES_TTL_MINUTES: z.coerce.number().int().min(15).max(1440).default(240),
  FX_RATES_TIMEOUT_MS: z.coerce.number().int().min(500).max(10_000).default(3000),
  /** MUT-642: Israel's open-data CKAN `datastore_search` (data.gov.il) and the two registries' resource ids. */
  DATA_GOV_IL_URL: z.string().url().refine(isHttpsOrLocalHttp, 'must be https (plain http only for localhost or 127.0.0.1)').default('https://data.gov.il/api/3/action/datastore_search'),
  DATA_GOV_IL_COMPANIES_RESOURCE: z.string().min(1).default('f004176c-b85f-4542-8901-7b3176f9a054'),
  DATA_GOV_IL_NONPROFITS_RESOURCE: z.string().min(1).default('be5b7935-3922-45d4-9638-08871b17ec95'),
  DATA_GOV_IL_TIMEOUT_MS: z.coerce.number().int().min(500).max(10_000).default(2500),
  /**
   * MUT-571/572 (ADR-264): the Tax Authority's Open API (SHAAM). Off unless TAX_AUTHORITY_ENV is set; `production` also
   * needs every value set explicitly (no sandbox defaults reach it). The client secret and the token key are secrets.
   */
  TAX_AUTHORITY_ENV: z.enum(['sandbox', 'production']).optional(),
  TAX_AUTHORITY_BASE_URL: z.string().url().refine(isHttpsOrLocalHttp, 'must be https (plain http only for localhost or 127.0.0.1)').optional(),
  TAX_AUTHORITY_CLIENT_ID: z.string().min(1).optional(),
  TAX_AUTHORITY_CLIENT_SECRET: z.string().min(1).optional(),
  TAX_AUTHORITY_REDIRECT_URI: z.string().url().optional(),
  TAX_AUTHORITY_SCOPE: z.string().min(1).default('invoices_scope'),
  /** The software's registration number (MUT-567); the sandbox accepts the spec's test value 987654321. */
  TAX_AUTHORITY_SOFTWARE_NUMBER: z.coerce.number().int().positive().optional(),
  TAX_AUTHORITY_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30_000).default(10_000),
  /**
   * MUT-569 (ADR-272): the uniform file's software fields (A000 1006, 1009, 1010). The registration certificate number
   * is zeros until MUT-567 issues it; the software house is the registering owner, Narabnd Studio Ltd (MUT-700), set in
   * Terraform (software_house_*). The defaults are placeholders, never a real company.
   */
  UNIFORM_FILE_REGISTRATION_NUMBER: z.string().regex(/^\d{8}$/, 'must be the 8-digit registration certificate number').default('00000000'),
  SOFTWARE_HOUSE_VAT_ID: z.string().regex(/^\d{9}$/, 'must be a 9-digit company number').default('000000000'),
  SOFTWARE_HOUSE_NAME: z.string().min(1).max(20).default('MTB3A'),
  /** Seals the stored tokens (AES-256-GCM). Outside production and staging, derived from the session pepper when unset. */
  TAX_AUTHORITY_TOKEN_KEY: secret('TAX_AUTHORITY_TOKEN_KEY').optional(),
  /**
   * MUT-710 (ADR-274 D4): seals two-step sign-in's authenticator secrets (AES-256-GCM) and keys its recovery-code digests.
   * Required on production and staging with no fallback (Terraform generates it, two_factor.tf); elsewhere derived
   * from the session pepper when unset.
   */
  TWO_FACTOR_SEAL_KEY: secret('TWO_FACTOR_SEAL_KEY').optional(),
  /**
   * MUT-710 (ADR-274 D10): enforce the issuing gate (403 TWO_FACTOR_SETUP_REQUIRED on PUT /v1/issuer, issuing, the Tax
   * Authority connect and allocation decisions) only when exactly "true". Off by default until the portal and phone
   * screens that turn two-step sign-in on have shipped, so nobody already issuing is locked out. The second step at
   * sign-in, for people who turned it on, does not depend on it.
   */
  TWO_FACTOR_ISSUING_GATE_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  /**
   * MUT-736 (ADR-282): every business profile issues invoices, receipts and credit notes, with no operator grant; /v1/me
   * names `invoicing` in everyone's features, so shipped phone builds open issuing too. Only exactly "true" turns it
   * on. Off is the kill switch: the operator's per-person `invoicing` grant decides again.
   */
  INVOICING_FOR_ALL: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  /**
   * MUT-740 (ADR-287 D4): the countries whose invoicing rules are live here, a comma list of ISO 3166-1 alpha-2 codes.
   * A profile whose issuer country isn't listed cannot save issuer details or issue. Default Israel, the only pack
   * there is; anything that isn't a code refuses the boot.
   */
  INVOICING_JURISDICTIONS: z
    .string()
    .default('IL')
    .transform((value, ctx) => {
      const live = parseLiveJurisdictions(value);
      if (!live) {
        ctx.addIssue({ code: 'custom', message: 'must be a comma list of two-letter country codes, e.g. IL or IL,SA' });
        return z.NEVER;
      }
      return live;
    }),
  /**
   * MUT-731 (ADR-284): the free Starter plan. Only exactly "true" turns it on: anyone with nothing else covering them is
   * ACTIVE on Starter (instead of read-only or locked), new sign-ups get no trial, and Starter's hard caps refuse with
   * 409 PLAN_LIMIT. Goes on with MUT-702 Part B (the paid plans can be bought) and only after the phone build that
   * understands PLAN_LIMIT is live (brief §5). Off is today's product exactly. The landing (ADR-283) reads the same
   * switch through GET /v1/self-service `starterPlan`.
   */
  STARTER_PLAN: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  /**
   * MUT-731 (ADR-284, Basel Q7): the one-time 14-day Solo trial (card up front) in web onboarding. Accounts created at or
   * after this instant are offered it once; earlier accounts never are. Unset = the step is off (TODO MUT-702 Part B:
   * set it at release, once Solo can be bought through Checkout with `trial: true`).
   */
  SOLO_TRIAL_OFFER_SINCE: z.string().datetime().transform((v) => new Date(v)).optional(),
  /**
   * MUT-711 (ADR-273): where a business requests an allocation number by hand when MTB3A can't (shown on the review
   * step). Read with or without TAX_AUTHORITY_ENV. The default is the Tax Authority's own site until the exact page is
   * confirmed (open item on MUT-711).
   */
  TAX_AUTHORITY_MANUAL_ALLOCATION_URL: z.string().url().refine((u) => u.startsWith('https://'), 'must be https').optional(),
  /** argon2id cost for user passwords (MUT-37). Never below OWASP profile 1. */
  ARGON2_MEMORY_KIB: z.coerce.number().int().min(ARGON2_MINIMUMS.memoryKiB).default(ARGON2_MINIMUMS.memoryKiB),
  ARGON2_TIME_COST: z.coerce.number().int().min(ARGON2_MINIMUMS.timeCost).default(ARGON2_MINIMUMS.timeCost),
  ARGON2_PARALLELISM: z.coerce.number().int().min(ARGON2_MINIMUMS.parallelism).default(ARGON2_MINIMUMS.parallelism),
  /** HMAC key for session-token digests (MUT-38). Secret Manager; rotating it signs every user out. */
  SESSION_TOKEN_PEPPER: secret('SESSION_TOKEN_PEPPER'),
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(1440).default(120),
  SESSION_ABSOLUTE_HOURS: z.coerce.number().int().min(1).max(168).default(12),
  /** Device-session (MUT-64) lifetime: longer than a browser session because capture happens days apart. */
  DEVICE_SESSION_IDLE_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  DEVICE_SESSION_ABSOLUTE_DAYS: z.coerce.number().int().min(1).max(730).default(180),
  /** The portal's public origin; non-GET session requests must come from it. Unset = compare with the request's own origin. */
  PORTAL_ORIGIN: z.string().url().optional(),
  /**
   * MUT-468: the website's origin (https://<apex>, Terraform sets it from config/hosts.json at stage live), for the
   * Privacy link in every mail's footer. Unset = mails carry no Privacy link. An https origin only: no path, no query.
   */
  WEBSITE_ORIGIN: z
    .string()
    .url()
    .refine(isHttpsOrigin, 'must be an https origin with no path, e.g. https://example.com')
    .optional(),
  /**
   * MUT-115 (ADR-190, D2): the WebAuthn relying-party ID, the apex domain (Terraform sets it from config/hosts.json at
   * stages live/redirect). Unset = no passkeys: every passkey route answers 404. WEBAUTHN_ORIGINS (comma list)
   * replaces the derived origins (PORTAL_ORIGIN and https://<rp id>) for local development; each must be the RP ID or
   * a subdomain of it.
   */
  WEBAUTHN_RP_ID: z.string().min(1).optional(),
  WEBAUTHN_ORIGINS: z.string().min(1).optional(),
  /** How many proxies in front of the service append to X-Forwarded-For (Cloud Run front end = 1; a load balancer adds one). */
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
  /** Built hosted-portal assets (MUT-45), mounted by the Dockerfile. Unset = the server serves no portal, API-only. */
  PORTAL_DIST_DIR: z.string().min(1).optional(),
  /** iOS/Android app-association files (MUT-111): all four or none — see the superRefine below. */
  APPLE_TEAM_ID: z.string().min(1).optional(),
  APPLE_BUNDLE_ID: z.string().min(1).optional(),
  ANDROID_PACKAGE_NAME: z.string().min(1).optional(),
  /** Comma-separated SHA-256 cert fingerprints (debug + upload-key at minimum, MUT-114). Split into an array in index.ts. */
  ANDROID_SHA256_FINGERPRINTS: z.string().min(1).optional(),
  /**
   * MUT-293: the lowest phone build still served, per platform. Absent = that
   * platform is never gated. `*_RECOMMENDED_BUILD` is the softer "update
   * available" ceiling below which the phone gets a nudge, not a block.
   */
  IOS_MIN_BUILD: z.coerce.number().int().positive().optional(),
  ANDROID_MIN_BUILD: z.coerce.number().int().positive().optional(),
  IOS_RECOMMENDED_BUILD: z.coerce.number().int().positive().optional(),
  ANDROID_RECOMMENDED_BUILD: z.coerce.number().int().positive().optional(),
  /** Instant kill switch for the minimum-build gate, independent of the floor values — a misconfigured floor is undone by flipping this, not editing/redeploying the floor itself. */
  // MUT-457: only "true" turns it on (never z.coerce.boolean, which reads "false" as true and switched the gate off).
  MIN_BUILD_CHECK_DISABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  /** MUT-551 (release gate RF-2): the phone app's maintenance switch. Only "true" turns it on: every phone request answers 503 MAINTENANCE. */
  MAINTENANCE_MODE: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  /**
   * MUT-326 (ADR-155 D3): the custom domain's front door proves itself with this secret
   * (Secret Manager, written by server/infrastructure/frontdoor). Needs PORTAL_ORIGIN.
   * Unset = no front door: every request is judged exactly as before.
   */
  FRONT_DOOR_TOKEN: secret('FRONT_DOOR_TOKEN').optional(),
  /**
   * MUT-487 (ADR-232, R5/D9): the legacy run.app forwarder's secret (Secret Manager, generated by Terraform in the
   * new project, a copy mounted on the forwarder). A request carrying it is judged by the client IP it hands over,
   * and nothing else: it never counts as the front door. Unset = no forwarder is trusted.
   */
  FORWARDER_TOKEN: secret('FORWARDER_TOKEN').optional(),
  /**
   * MUT-326 stage "redirect": portal page visits that bypass the front door go to the
   * same-origin carry-over page, which sends them on to PORTAL_ORIGIN. Only "true" turns
   * it on (never z.coerce.boolean, which reads "false" as true). Needs FRONT_DOOR_TOKEN.
   */
  PORTAL_LEGACY_REDIRECT: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  /**
   * MUT-255/389: the receipts library (/v1/receipts*, and deleting an expense keeps its receipts To review). MUT-659:
   * on by default for everyone (dev, QA and every deploy); only "false" turns it off, the way back to before MUT-255.
   */
  RECEIPTS_LIBRARY: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  /**
   * MUT-441 (D3): the deploy-level kill switch for the server reading receipts. On, every uploader's receipts are
   * read (MUT-659 dropped the per-person grant). Needs OCR_URL, and outside development and tests READ_QUEUE (Terraform
   * server_ocr_enabled). Only "true" turns it on, as above.
   */
  SERVER_OCR: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  /** MUT-441: the receipt-ocr service (https on Cloud Run, called with an ID token; or a local sidecar on http://localhost). */
  OCR_URL: z.string().url().refine(isHttpsOrLocalHttp, 'must be https, or http on localhost').optional(),
  /** MUT-441 (F3): the Cloud Tasks queue for reads, projects/<p>/locations/<l>/queues/<q>. Unset = reads run in this process (dev, QA). */
  READ_QUEUE: z.string().regex(/^projects\/[^/]+\/locations\/[^/]+\/queues\/[^/]+$/, 'must be projects/<project>/locations/<location>/queues/<queue>').optional(),
  /** MUT-441: this API's own origin, which read tasks POST to (<origin>/jobs/v1/receipts/read). */
  API_ORIGIN: z.string().url().refine(isHttpsOrLocalHttp, 'must be https, or http on localhost').optional(),
  /** MUT-441 (R8): the service account read tasks carry an OIDC token for (the queue's), and the sweep Scheduler's. */
  READ_INVOKER_SA: z.string().email().optional(),
  SWEEP_INVOKER_SA: z.string().email().optional(),
  /** MUT-441 (R8): the audience the read job's OIDC tokens must name. Unset = API_ORIGIN. */
  READ_OIDC_AUDIENCE: z.string().url().optional(),
  /**
   * MUT-559 (ADR-245): accountant access. Off, every accountant route answers 404, /v1/me has no `clients`, and a
   * grant opens nothing, so the server can deploy before the portal and phone screens (MUT-561..564). Only "true"
   * turns it on, as above.
   */
  ACCOUNTANT_ACCESS: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  /**
   * MUT-593 (ADR-254 D10): Malafat acting as each person with a delegated token. Off, the token endpoint refuses a
   * confidential client, every delegated token answers 401, and Connected apps and the operator's per-firm switch
   * answer 404, so the server deploys dark. Only "true" turns it on; dev and the QA live API do.
   */
  MALAFAT_DELEGATION: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  /**
   * MUT-596 (local QA): a confidential client's JWKS and redirect URIs may be plain http on a loopback or *.lvh.me
   * host, so the Malafat QA stub can stand in for Malafat. Refused on production and staging.
   */
  OAUTH_CLIENT_LOCAL_HTTP: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  /**
   * MUT-595 (ADR-254 D1): Sign in with Malafat. Off, its routes answer 404 and the doors say so. Only "true" turns it
   * on; Malafat's side must list this server's callback in MTB3A_SIGN_IN_REDIRECT_URIS (MAL-1539).
   */
  MALAFAT_SIGN_IN: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  /** MUT-595: a firm's own Malafat origin, `{slug}` for its address. A local tenant host in dev. */
  MALAFAT_ORIGIN_TEMPLATE: z
    .string()
    .default('https://{slug}.malafat.app')
    .refine((v) => v.includes('{slug}') && isMalafatOrigin(v.replace('{slug}', 'x')), 'must be an http(s) origin containing {slug}'),
  /** MUT-595 (MAL-1539): MTB3A's client id at every Malafat firm. */
  MALAFAT_SIGN_IN_CLIENT_ID: z.string().min(1).max(64).default('mtb3a'),
  /** MUT-559: the most pending and active accountants one profile may have (stops invite spam). */
  ACCOUNTANTS_PER_PROFILE_MAX: z.coerce.number().int().min(1).max(50).default(5),
  /**
   * MUT-565 (ADR-251): the Accountant plan. Off (the default, production until live prices exist): no cap, and
   * `/v1/me.clientBooks.cap` is null. On: ACCOUNTANT_FREE_CLIENTS client books free, the plan for more. Only "true".
   */
  ACCOUNTANT_PLAN: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  /** MUT-565: the client books an accountant reads without the plan. */
  ACCOUNTANT_FREE_CLIENTS: z.coerce.number().int().min(1).max(50).default(3),
  /** MUT-565: the ceiling with the plan (abuse guard; past it the 4th-client answer says "Contact us"). */
  ACCOUNTANT_PLAN_MAX_CLIENTS: z.coerce.number().int().min(1).max(1000).default(100),
  /**
   * MUT-560 (ADR-247): one-time share links to a period of a profile, opened with a PIN. Off, every share-link route
   * answers 404, so the server can deploy before the portal and phone screens (MUT-561..563). Only "true" turns it on.
   */
  SHARE_LINKS: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  /** MUT-560: the most live share links one profile may have (stops link spam). */
  SHARE_LINKS_PER_PROFILE_MAX: z.coerce.number().int().min(1).max(50).default(10),
  /**
   * MUT-314 (ADR-248): period downloads (an Excel report and a receipts zip) for owners, accountants and share links.
   * Off, every download route answers 404, so the server can deploy before the buttons (MUT-561..564). Only "true" turns
   * it on; a link's download also needs SHARE_LINKS.
   */
  PERIOD_DOWNLOADS: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  /** MUT-314: expense and income rows one Excel report may hold. */
  PERIOD_PACK_MAX_ROWS: z.coerce.number().int().min(1).max(200_000).default(20_000),
  /** MUT-314: bytes of receipts one receipts zip may hold (500 MiB; no ZIP64, so well below 4 GiB). */
  PERIOD_PACK_MAX_RECEIPT_BYTES: z.coerce.number().int().min(1).max(2 * 1024 * 1024 * 1024).default(500 * 1024 * 1024),
  /** MUT-314: download streams one instance serves at once; the next answers 429. */
  PERIOD_PACK_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(3),
  // MUT-436 (review D3/D5): an agent may add to the inbox only once the phone decodes 'mcp' and its minimum build is raised.
  MCP_INBOX_WRITES: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  /**
   * MUT-361 (ADR-181 D7): the lapse gate — a READ_ONLY profile refuses session writes and a LOCKED one everything but
   * the records export (billing/gate.ts). On unless exactly "false": the operator's kill switch, e.g. while a pilot user
   * found by `npm run billing:uncovered` still waits for a grant, or until the phone build that reads the refusal ships.
   */
  BILLING_GATE: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  /**
   * MUT-360: Stripe (Secret Manager, mounted only once stripe_enabled is applied). A restricted key, read-only on
   * billing objects except, from MUT-362 (eng review D2), Write on Customers, Checkout Sessions and Customer portal;
   * both or neither — unset, the webhook, reconcile and billing sessions answer 503. A live key only where
   * API_KEY_ENVIRONMENT is live, so a test server can never read the real account.
   */
  STRIPE_SECRET_KEY: z.string().regex(/^(rk|sk)_(test|live)_[A-Za-z0-9_]+$/, 'must be a Stripe secret or restricted key (sk_/rk_)').optional(),
  STRIPE_WEBHOOK_SECRET: z.string().regex(/^whsec_[A-Za-z0-9_]+$/, 'must be a Stripe webhook signing secret (whsec_)').optional(),
  /**
   * MUT-525 (R6): QA only. A coupon id that replaces offers.json with one yearly offer and reads it uncached, so each
   * live QA run owns its coupon. Refused where API_KEY_ENVIRONMENT is live.
   */
  BILLING_OFFER_COUPON_ID: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'must be a Stripe coupon id').optional(),
  /** MUT-532: QA only, the same rule for the cancel flow's stay coupon (offers.json `stay`). Refused where live. */
  BILLING_STAY_COUPON_ID: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'must be a Stripe coupon id').optional(),
  /** MUT-534 (D9): QA only, the same rule for the come-back coupons (offers.json `comeback`), one per currency, set together. Refused where live. */
  BILLING_COMEBACK_COUPON_ID_ILS: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'must be a Stripe coupon id').optional(),
  BILLING_COMEBACK_COUPON_ID_USD: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'must be a Stripe coupon id').optional(),
  /**
   * MUT-533 (D3): the length of Stripe's Smart Retries window, in days, as the dashboard sets it (7, 14, 21 or 28).
   * The failed-card reminder goes at its midpoint; 28 keeps every mail key inside the 30-day send log.
   */
  BILLING_RETRY_WINDOW_DAYS: z.enum(['7', '14', '21', '28']).default('14').transform((v) => Number(v)),
  /** MUT-535 (D12): monthly summary mails per run; keep it well under MAIL_DAILY_CAP, which every other mail shares. */
  MONTHLY_SUMMARY_DAILY_SENDS: z.coerce.number().int().min(1).max(10_000).default(40),
  /** MUT-360 D2: the nightly Scheduler job's X-Job-Token (Terraform-generated). Unset = /jobs/* answers 503. */
  MUTABA3A_JOB_TOKEN: secret('MUTABA3A_JOB_TOKEN').optional(),
  /**
   * MUT-434 (D19): the secret an agent's renewed tokens are derived under, so a retried refresh gets the same pair.
   * Secret Manager. Needs PORTAL_ORIGIN (the issuer). Unset = the OAuth endpoints and /mcp answer 503. Rotating it
   * breaks only retries inside the 30-second window; rotating SESSION_TOKEN_PEPPER is what signs agents out.
   */
  OAUTH_DERIVE_KEY: secret('OAUTH_DERIVE_KEY').optional(),
  /**
   * MUT-148 (ADR-091): the api project's DSN (Secret Manager, mounted once sentry_enabled is applied). Unset = no
   * error reports. Only an EU-region DSN starts: a US one would send events outside the region ADR-091 chose (D5).
   */
  SENTRY_DSN: z.string().regex(SENTRY_EU_DSN, 'must be an https DSN on the EU region, https://<key>@<org>.ingest.de.sentry.io/<project>').optional(),
  /** The environment events are filed under. Unset = NODE_ENV. */
  SENTRY_ENVIRONMENT: z.string().min(1).max(64).optional(),
  /**
   * ADR-236: release-only error reports. Unset = report only when NODE_ENV is production; `false` = never (local
   * release builds, QA, e2e); `true` = report from any environment, only to check the integration.
   */
  SENTRY_ENABLED: z.enum(['true', 'false']).optional(),
  /**
   * MUT-359 (ADR-159 §5): which transport sends mail. `noop` (default) sends nothing; `log` and `memory` are for
   * development and tests only (refused in production, D14); `resend` needs every RESEND_/MAIL_ value below.
   */
  MAILER: z.enum(['resend', 'log', 'memory', 'noop']).default('noop'),
  /** MUT-366: POST /v1/signups answers 404 until this is "true"; the server refuses to start with it on and no mailer. Recovery is never behind it. */
  SELF_SIGNUP_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  /**
   * MUT-366 (D7): Cloudflare Turnstile's secret (Secret Manager). Outside production, unset = Cloudflare's published
   * always-pass test secret (2x… always fails, for QA), answered without a network call. Production needs a real
   * one once mail or signup is on, and refuses a test one.
   */
  TURNSTILE_SECRET: z.string().min(1).max(200).optional(),
  /** MUT-366 (ADR-159 §5): signup and recovery answer no earlier than this many ms after the request began. */
  SIGNUP_RESPONSE_FLOOR_MS: z.coerce.number().int().min(0).max(10_000).default(SELF_SERVICE_POLICY.signupFloorMs),
  RECOVERY_RESPONSE_FLOOR_MS: z.coerce.number().int().min(0).max(10_000).default(SELF_SERVICE_POLICY.recoveryFloorMs),
  /** no-reply@<apex>, written by Terraform from config/hosts.json. One plain address; the display name is the product's. */
  MAIL_FROM_ADDRESS: z.string().email().max(254).optional(),
  /** Where replies go (D6). */
  MAIL_REPLY_TO: z.string().email().max(254).optional(),
  /** Mutaba3a's sending key, restricted to its domain (Secret Manager). */
  RESEND_API_KEY: z.string().regex(/^re_[A-Za-z0-9_]+$/, 'must be a Resend API key (re_…)').optional(),
  /** The Resend webhook's signing secret (Secret Manager). Alone, it turns the bounce webhook on (D20). */
  RESEND_WEBHOOK_SECRET: z.string().regex(/^whsec_[A-Za-z0-9+/=]+$/, 'must be a Resend/Svix signing secret (whsec_…)').optional(),
  /** Sends in any rolling 24 h. Required with resend, set below the shared Resend plan's limit (D18); 500 elsewhere. */
  MAIL_DAILY_CAP: z.coerce.number().int().min(1).optional(),
  /** The part of the daily cap only recovery mail (reset, finish setup) may use. Default: 10 % of the cap, rounded up. */
  MAIL_SECURITY_RESERVE: z.coerce.number().int().min(0).optional(),
  /** Sends to one address in any rolling 24 h (D17). */
  MAIL_RECIPIENT_DAILY_CAP: z.coerce.number().int().min(1).default(10),
  /** MUT-367's review digest goes here (at most one an hour while signups wait). Unset = no digest. */
  OPERATOR_ALERT_EMAIL: z.string().email().max(254).optional(),
  /**
   * MUT-367 (ADR-159 §7a, D3): how the signup screen checks a domain. `dns` asks DNS and RDAP; `fixture` answers from
   * a fixed table of `.example` domains (tests, QA, development) and is refused in production. Unset = `dns` in
   * production, `fixture` elsewhere.
   */
  EMAIL_DOMAIN_CHECKER: z.enum(['dns', 'fixture']).optional(),
  /**
   * MUT-474: how many profiles one person may own on a dev server, so local QA runs that each make a throwaway
   * profile don't hit the product limit (MAX_OWNED_PROFILES, 6) part-way. Never below it; refused in production and
   * staging. Unset = the product limit.
   */
  QA_MAX_OWNED_PROFILES: z.coerce.number().int().min(6).max(1000).optional(),
  /**
   * MUT-441: local QA only. How long an in-process read waits before it starts, standing in for Cloud Tasks' dispatch
   * and a cold start, so the release-QA spec can see the portal's "Reading…" state. Refused in production and staging.
   */
  QA_READ_DELAY_MS: z.coerce.number().int().min(0).max(60_000).optional(),
  /**
   * MUT-641 (ADR-265): who signs issued-document PDFs. Unset = `dev` outside production (a throwaway authority made in
   * the process, nothing on disk) and `off` in production, where the PDF routes answer 503 SIGNING_NOT_CONFIGURED
   * until the certificate is in place: a document is never handed out unsigned. `dev` is refused in production.
   * `kms` signs with a Cloud KMS key and needs its key version, its certificate chain and a time-stamp authority.
   */
  ISSUING_SIGNER: z.enum(['dev', 'kms', 'off']).optional(),
  ISSUING_SIGNING_KMS_KEY: z
    .string()
    .regex(/^projects\/[^/]+\/locations\/[^/]+\/keyRings\/[^/]+\/cryptoKeys\/[^/]+\/cryptoKeyVersions\/\d+$/, 'must be a Cloud KMS key version: projects/…/cryptoKeyVersions/N')
    .optional(),
  /** The certificate the certifying authority issued for the KMS key, then its issuers (PEM). Public: never a key. */
  ISSUING_SIGNING_CERT_CHAIN: z
    .string()
    .refine((pem) => pem.includes('-----BEGIN CERTIFICATE-----'), 'must hold PEM certificates')
    .refine((pem) => !/PRIVATE KEY/.test(pem), 'holds a private key: the signing key stays in Cloud KMS and never travels in configuration')
    .optional(),
  /**
   * An RFC 3161 time-stamp authority: the certifying authority's, or a public one (Sectigo over https) until then.
   * Unset outside `kms` = the development authority's. https on production and staging; plain http only elsewhere
   * (a test against DigiCert's http-only service).
   */
  ISSUING_TSA_URL: z
    .string()
    .url()
    .refine((value) => /^https?:\/\//.test(value), 'must be an http(s) URL')
    .optional(),
  ISSUING_SIGNING_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30_000).default(10_000),
});

const APP_ASSOCIATION_KEYS = ['APPLE_TEAM_ID', 'APPLE_BUNDLE_ID', 'ANDROID_PACKAGE_NAME', 'ANDROID_SHA256_FINGERPRINTS'] as const;
const MIN_BUILD_PLATFORMS = [
  { min: 'IOS_MIN_BUILD', recommended: 'IOS_RECOMMENDED_BUILD' },
  { min: 'ANDROID_MIN_BUILD', recommended: 'ANDROID_RECOMMENDED_BUILD' },
] as const;

/** `loadConfig` fills SENTRY_ENVIRONMENT in from NODE_ENV and the mail caps from their defaults, so they are always set. */
export type Config = Omit<z.infer<typeof envSchema>, 'SENTRY_ENVIRONMENT' | 'MAIL_DAILY_CAP' | 'MAIL_SECURITY_RESERVE' | 'EMAIL_DOMAIN_CHECKER'> & {
  SENTRY_ENVIRONMENT: string;
  EMAIL_DOMAIN_CHECKER: 'dns' | 'fixture';
  MAIL_DAILY_CAP: number;
  MAIL_SECURITY_RESERVE: number;
};

/** MUT-359: the cap outside `resend`, where nothing real is sent. */
export const DEFAULT_MAIL_DAILY_CAP = 500;
const RESEND_REQUIRED = ['MAIL_FROM_ADDRESS', 'MAIL_REPLY_TO', 'RESEND_API_KEY', 'RESEND_WEBHOOK_SECRET', 'MAIL_DAILY_CAP'] as const;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new ConfigError(`Invalid configuration:\n${lines.join('\n')}`);
  }
  const config = parsed.data;
  const attachments = attachmentsConfig(config);
  const setKeys = APP_ASSOCIATION_KEYS.filter((key) => config[key] !== undefined);
  if (setKeys.length > 0 && setKeys.length < APP_ASSOCIATION_KEYS.length) {
    const missing = APP_ASSOCIATION_KEYS.filter((key) => !setKeys.includes(key));
    throw new ConfigError(
      `Invalid configuration:\n  app association (${APP_ASSOCIATION_KEYS.join(', ')}): all four or none must be set; missing ${missing.join(', ')}`,
    );
  }
  // A string like "," passes the schema's min(1), but every entry is blank
  // once well-known.ts trims and filters it — refuse at boot rather than
  // silently serving assetlinks.json with an empty fingerprint list.
  if (config.ANDROID_SHA256_FINGERPRINTS && !config.ANDROID_SHA256_FINGERPRINTS.split(',').some((fp) => fp.trim().length > 0)) {
    throw new ConfigError('Invalid configuration:\n  ANDROID_SHA256_FINGERPRINTS: must contain at least one non-blank fingerprint');
  }
  if (config.FRONT_DOOR_TOKEN && !config.PORTAL_ORIGIN) {
    throw new ConfigError('Invalid configuration:\n  FRONT_DOOR_TOKEN: needs PORTAL_ORIGIN, the origin the front door serves the portal on');
  }
  if (config.OAUTH_DERIVE_KEY && !config.PORTAL_ORIGIN) {
    throw new ConfigError('Invalid configuration:\n  OAUTH_DERIVE_KEY: needs PORTAL_ORIGIN, the OAuth issuer and the origin /mcp is served on');
  }
  try {
    webauthnConfigOf({ rpId: config.WEBAUTHN_RP_ID, origins: config.WEBAUTHN_ORIGINS, portalOrigin: config.PORTAL_ORIGIN });
  } catch (err) {
    throw new ConfigError(`Invalid configuration:\n  ${(err as Error).message}`);
  }
  if (config.PORTAL_LEGACY_REDIRECT && !config.FRONT_DOOR_TOKEN) {
    throw new ConfigError('Invalid configuration:\n  PORTAL_LEGACY_REDIRECT: needs FRONT_DOOR_TOKEN, or every visit would be redirected, the new host\'s included');
  }
  if ((config.STRIPE_SECRET_KEY === undefined) !== (config.STRIPE_WEBHOOK_SECRET === undefined)) {
    const missing = config.STRIPE_SECRET_KEY === undefined ? 'STRIPE_SECRET_KEY' : 'STRIPE_WEBHOOK_SECRET';
    throw new ConfigError(`Invalid configuration:\n  ${missing}: STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are set together or not at all`);
  }
  if (config.STRIPE_SECRET_KEY && /^(rk|sk)_live_/.test(config.STRIPE_SECRET_KEY) && config.API_KEY_ENVIRONMENT !== 'live') {
    throw new ConfigError('Invalid configuration:\n  STRIPE_SECRET_KEY: a live Stripe key needs API_KEY_ENVIRONMENT=live');
  }
  // MUT-360 review: the live server reads billing objects only, so a full-access key (or a test key, whose test-mode
  // subscriptions would then cover real people) is refused there.
  if (config.STRIPE_SECRET_KEY && config.API_KEY_ENVIRONMENT === 'live' && !/^rk_live_/.test(config.STRIPE_SECRET_KEY)) {
    throw new ConfigError('Invalid configuration:\n  STRIPE_SECRET_KEY: a live server needs a restricted live key (rk_live_…), never sk_ or a test key');
  }
  if (config.BILLING_OFFER_COUPON_ID && config.API_KEY_ENVIRONMENT === 'live') {
    throw new ConfigError('Invalid configuration:\n  BILLING_OFFER_COUPON_ID: the QA coupon override is never set on a live server; the live offers are offers.json');
  }
  if ((config.BILLING_COMEBACK_COUPON_ID_ILS || config.BILLING_COMEBACK_COUPON_ID_USD) && config.API_KEY_ENVIRONMENT === 'live') {
    throw new ConfigError('Invalid configuration:\n  BILLING_COMEBACK_COUPON_ID_ILS/_USD: the QA coupon overrides are never set on a live server; the live offers are offers.json');
  }
  if (Boolean(config.BILLING_COMEBACK_COUPON_ID_ILS) !== Boolean(config.BILLING_COMEBACK_COUPON_ID_USD)) {
    throw new ConfigError('Invalid configuration:\n  BILLING_COMEBACK_COUPON_ID_ILS/_USD: set both or neither');
  }
  if (config.BILLING_STAY_COUPON_ID && config.API_KEY_ENVIRONMENT === 'live') {
    throw new ConfigError('Invalid configuration:\n  BILLING_STAY_COUPON_ID: the QA coupon override is never set on a live server; the live offers are offers.json');
  }
  receiptReadingConfig(config);
  issuingSignerConfig(config);
  if (config.QA_MAX_OWNED_PROFILES !== undefined && (config.NODE_ENV === 'production' || config.NODE_ENV === 'staging')) {
    throw new ConfigError(`Invalid configuration:\n  QA_MAX_OWNED_PROFILES: the profile cap override is for the dev server and local QA only, never ${config.NODE_ENV}`);
  }
  for (const { min, recommended } of MIN_BUILD_PLATFORMS) {
    const floor = config[min];
    const target = config[recommended];
    if (floor !== undefined && target !== undefined && target < floor) {
      throw new ConfigError(`Invalid configuration:\n  ${recommended}: must be >= ${min} (${target} < ${floor})`);
    }
  }
  return { ...config, ...attachments, SENTRY_ENVIRONMENT: config.SENTRY_ENVIRONMENT ?? config.NODE_ENV, ...mailConfig(config), TURNSTILE_SECRET: turnstileSecret(config), EMAIL_DOMAIN_CHECKER: domainChecker(config) };
}

/** MUT-641 (ADR-265): production signs only with a real certificate, and a KMS signer has everything it needs. */
function issuingSignerConfig(config: z.infer<typeof envSchema>): void {
  const refuse = (name: string, why: string): never => {
    throw new ConfigError(`Invalid configuration:\n  ${name}: ${why}`);
  };
  if (config.ISSUING_SIGNER === 'dev' && config.NODE_ENV === 'production') {
    refuse('ISSUING_SIGNER', 'the development authority signs for development, tests and QA only; production signs with the certificate in Cloud KMS (kms) or not at all (off)');
  }
  if (config.ISSUING_SIGNER === 'kms') {
    for (const name of ['ISSUING_SIGNING_KMS_KEY', 'ISSUING_SIGNING_CERT_CHAIN', 'ISSUING_TSA_URL'] as const) {
      if (!config[name]) refuse(name, 'ISSUING_SIGNER=kms needs the key version, its certificate chain and a time-stamp authority');
    }
  }
  // MUT-641 (review): over plain http anyone on the path could answer with a token signed by a certificate of their own.
  if (config.ISSUING_TSA_URL && (config.NODE_ENV === 'production' || config.NODE_ENV === 'staging') && !isHttpsOrLocalHttp(config.ISSUING_TSA_URL)) {
    refuse('ISSUING_TSA_URL', `a time-stamp authority is reached over https on ${config.NODE_ENV} (e.g. https://timestamp.sectigo.com)`);
  }
}

/** MUT-441: the refusals for the server's receipt reader (the kill switch, the queue and the job's OIDC check). */
function receiptReadingConfig(config: z.infer<typeof envSchema>): void {
  const refuse = (name: string, why: string): never => {
    throw new ConfigError(`Invalid configuration:\n  ${name}: ${why}`);
  };
  if (config.SERVER_OCR && !config.OCR_URL) refuse('OCR_URL', 'SERVER_OCR needs the OCR service\'s URL');
  if (config.SERVER_OCR && (config.NODE_ENV === 'production' || config.NODE_ENV === 'staging') && !config.READ_QUEUE) {
    refuse('READ_QUEUE', `SERVER_OCR on ${config.NODE_ENV} reads through Cloud Tasks; in-process reads are for the dev server and local QA only`);
  }
  // MUT-595: a stub Malafat at http://{slug}.lvh.me for local QA (it resolves to 127.0.0.1); never plain http beyond.
  if (!config.MALAFAT_ORIGIN_TEMPLATE.startsWith('https://') && (config.NODE_ENV === 'production' || config.NODE_ENV === 'staging')) {
    refuse('MALAFAT_ORIGIN_TEMPLATE', `Malafat is reached over https on ${config.NODE_ENV}`);
  }
  if (config.OAUTH_CLIENT_LOCAL_HTTP && (config.NODE_ENV === 'production' || config.NODE_ENV === 'staging')) {
    refuse('OAUTH_CLIENT_LOCAL_HTTP', `a client's keys are fetched over https on ${config.NODE_ENV}`);
  }
  if (config.TAX_AUTHORITY_ENV) {
    for (const name of ['TAX_AUTHORITY_CLIENT_ID', 'TAX_AUTHORITY_CLIENT_SECRET', 'TAX_AUTHORITY_REDIRECT_URI'] as const) if (!config[name]) refuse(name, 'TAX_AUTHORITY_ENV needs it');
    if (config.TAX_AUTHORITY_ENV === 'production') {
      for (const name of ['TAX_AUTHORITY_BASE_URL', 'TAX_AUTHORITY_SOFTWARE_NUMBER', 'TAX_AUTHORITY_TOKEN_KEY'] as const) if (!config[name]) refuse(name, 'the production Tax Authority takes no sandbox defaults: set it');
    }
    if ((config.NODE_ENV === 'production' || config.NODE_ENV === 'staging') && !config.TAX_AUTHORITY_TOKEN_KEY) refuse('TAX_AUTHORITY_TOKEN_KEY', `stored tokens need their own key on ${config.NODE_ENV}`);
  }
  if ((config.NODE_ENV === 'production' || config.NODE_ENV === 'staging') && !config.TWO_FACTOR_SEAL_KEY) {
    refuse('TWO_FACTOR_SEAL_KEY', `two-step sign-in secrets need their own key on ${config.NODE_ENV}`);
  }
  if (config.QA_READ_DELAY_MS !== undefined && (config.NODE_ENV === 'production' || config.NODE_ENV === 'staging')) {
    refuse('QA_READ_DELAY_MS', `the read delay is for the dev server and local QA only, never ${config.NODE_ENV}`);
  }
  if (config.READ_QUEUE) {
    for (const name of ['API_ORIGIN', 'READ_INVOKER_SA'] as const) if (!config[name]) refuse(name, 'READ_QUEUE needs it: read tasks POST to API_ORIGIN with an OIDC token for READ_INVOKER_SA');
  }
}

/** MUT-441 (R8): the read job's audience; unset = the API's own origin. */
export function readOidcAudience(config: Pick<Config, 'READ_OIDC_AUDIENCE' | 'API_ORIGIN'>): string | undefined {
  return config.READ_OIDC_AUDIENCE ?? config.API_ORIGIN;
}

/** MUT-367 (D3): the fixture would let anyone choose their own verdict, so production always asks DNS and RDAP. */
function domainChecker(config: z.infer<typeof envSchema>): 'dns' | 'fixture' {
  const production = config.NODE_ENV === 'production';
  if (production && config.EMAIL_DOMAIN_CHECKER === 'fixture') {
    throw new ConfigError('Invalid configuration:\n  EMAIL_DOMAIN_CHECKER: the fixture checker is for tests and QA; production checks real domains (dns)');
  }
  return config.EMAIL_DOMAIN_CHECKER ?? (production ? 'dns' : 'fixture');
}

/**
 * MUT-366 (D7, review #6): a server that really mails links (MAILER=resend, any environment) or opens signup in
 * production must name its secret, and production never takes a test secret, which would let every bot through.
 * Development and tests fall back to the always-pass test secret.
 */
function turnstileSecret(config: z.infer<typeof envSchema>): string | undefined {
  const secret = config.TURNSTILE_SECRET;
  const production = config.NODE_ENV === 'production';
  if (production && secret && isTurnstileTestSecret(secret)) {
    throw new ConfigError('Invalid configuration:\n  TURNSTILE_SECRET: a Cloudflare test secret would let every request through in production');
  }
  const mailsLinks = config.MAILER === 'resend' || (production && (config.MAILER !== 'noop' || config.SELF_SIGNUP_ENABLED));
  if (!secret && mailsLinks) {
    throw new ConfigError('Invalid configuration:\n  TURNSTILE_SECRET: signup and recovery mail links, so a server that sends mail needs the Turnstile secret');
  }
  return secret ?? (production ? undefined : TURNSTILE_TEST_SECRETS.pass);
}

/** The server package directory (config.ts sits in src/ or dist/, one level below it). */
const SERVER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * MUT-396: the storage refusals. The local driver serves files to anyone holding a URL from a server whose secret
 * is the session pepper, with no lifecycle rules: never on a deployed service.
 */
function attachmentsConfig(config: z.infer<typeof envSchema>): { ATTACHMENTS_DIR: string } {
  const refuse = (why: string): never => {
    throw new ConfigError(`Invalid configuration:\n  ATTACHMENTS_DRIVER: ${why}`);
  };
  if (config.ATTACHMENTS_DRIVER === 'local') {
    if (config.NODE_ENV === 'production' || config.NODE_ENV === 'staging') refuse(`local storage is for the dev server and local QA only, never ${config.NODE_ENV}`);
    if (config.ATTACHMENTS_BUCKET) refuse('local with ATTACHMENTS_BUCKET set is ambiguous; unset one of them');
  }
  if (config.ATTACHMENTS_DRIVER === 'gcs' && !config.ATTACHMENTS_BUCKET) refuse('gcs needs ATTACHMENTS_BUCKET');
  return { ATTACHMENTS_DIR: isAbsolute(config.ATTACHMENTS_DIR) ? config.ATTACHMENTS_DIR : resolve(SERVER_DIR, config.ATTACHMENTS_DIR) };
}

/** MUT-359: the mail refusals (ticket, D7, D14, D18, D20) and the caps' defaults. */
/** MUT-468: `https://host[:port]` exactly, lower-case as the URL parser writes it; anything else (or unparsable) is false. */
function isHttpsOrigin(value: string): boolean {
  try {
    return value.startsWith('https://') && new URL(value).origin === value;
  } catch {
    return false;
  }
}

function mailConfig(config: z.infer<typeof envSchema>): { MAIL_DAILY_CAP: number; MAIL_SECURITY_RESERVE: number } {
  const refuse = (name: string, why: string): never => {
    throw new ConfigError(`Invalid configuration:\n  ${name}: ${why}`);
  };
  if (config.MAILER === 'noop' && config.SELF_SIGNUP_ENABLED) refuse('SELF_SIGNUP_ENABLED', 'signup mails a link, so it needs a MAILER other than noop');
  if (config.NODE_ENV === 'production' && (config.MAILER === 'log' || config.MAILER === 'memory')) {
    refuse('MAILER', `${config.MAILER} is for development and tests only: in production it would ${config.MAILER === 'log' ? 'write setup links into the logs' : 'keep mail in memory and send nothing'}`);
  }
  if (config.MAILER === 'resend') {
    for (const name of RESEND_REQUIRED) if (config[name] === undefined) refuse(name, 'MAILER=resend needs it');
  }
  // MUT-468: the mail art is served by the portal; without its origin every production mail would go out without it,
  // and anything but an https origin would point every mail at broken or mixed-content pictures.
  if (config.NODE_ENV === 'production' && config.MAILER === 'resend' && !(config.PORTAL_ORIGIN && isHttpsOrigin(config.PORTAL_ORIGIN))) {
    refuse('PORTAL_ORIGIN', 'production mail needs an https origin with no path: the mail art is served from <PORTAL_ORIGIN>/mail/v<N>');
  }
  if (config.RESEND_WEBHOOK_SECRET && !config.MAIL_FROM_ADDRESS) refuse('MAIL_FROM_ADDRESS', 'the Resend webhook keeps only events sent from this address\'s domain, so it needs it');
  for (const name of ['MAIL_FROM_ADDRESS', 'MAIL_REPLY_TO'] as const) {
    const address = config[name];
    if (address && isUnownedDomain(address)) refuse(name, `${address.split('@')[1]} is not a domain we own; mail there reaches whoever registers it`);
  }
  const daily = config.MAIL_DAILY_CAP ?? DEFAULT_MAIL_DAILY_CAP;
  // 10 % rounded up, but never the whole cap: a cap of 1 leaves no reserve rather than refusing to start.
  const reserve = config.MAIL_SECURITY_RESERVE ?? Math.min(Math.ceil(daily / 10), daily - 1);
  if (reserve >= daily) refuse('MAIL_SECURITY_RESERVE', `must be below MAIL_DAILY_CAP (${reserve} >= ${daily})`);
  return { MAIL_DAILY_CAP: daily, MAIL_SECURITY_RESERVE: reserve };
}
