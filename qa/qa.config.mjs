/**
 * release-qa config for mini-crm (MUT-97, companion to MAL-1007).
 * Engine and docs: ~/Work/tools/release-qa (SKILL.md).
 *
 * mini-crm is a single local-first SPA: no server, no auth, no shared database.
 * Every browser context gets its own fresh IndexedDB, so there is no seed step and
 * no personas — each spec dismisses the first-run "Welcome" dialog itself
 * (support/app.ts openFreshApp), same as the e2e/ suite this catalog replaces.
 */
/** Valid in shape, never a real project key: QA builds run the analytics code, and qa/support/posthog.ts answers it. */
export const QA_POSTHOG_KEY = 'phc_releaseQaDummyKeyNeverSent000000';
/**
 * MUT-149: a dummy key on the org's real ingest host (the build refuses any other host): the portal's crash
 * reporting runs, and qa/support/sentry.ts answers every Sentry request, so nothing is ever sent.
 */
export const QA_SENTRY_DSN = 'https://00000000000000000000000000000000@o4512029835526144.ingest.de.sentry.io/1';

// Heap cap for the QA dev servers. Node's default lets each one grow to ~4 GB, and a long recorded run
// alongside Playwright and an iOS Simulator can push a laptop into swap until the disk fills (it happened
// to the Malafat QA env on 2026-10-17). Vite stays far below this; the cap only bounds a leak.
const SERVER_HEAP_MB = 2048;
const HEAP_CAPPED = `NODE_OPTIONS="\${NODE_OPTIONS:-} --max-old-space-size=${SERVER_HEAP_MB}"`;

export default {
  name: 'mini-crm',
  title: 'Mutaba3a — mini-crm',

  apps: {
    web: {
      label: 'Web app',
      platform: 'web',
      // `make release web` tags web-v<version> (scripts/tag-release.sh). The plain v* tags
      // belong to the retired desktop pipeline and stopped at v0.0.67.
      release: { strategy: 'tag', pattern: 'web-v*', version: 'web-v(.+)' },
      watch: [
        'src/**',
        '!src/**/__tests__/**',
        '!src/**/*.test.{ts,tsx}',
        '!src/test/**',
        '!src/**/*.d.ts',
        '!src/hosted/**', // separate deploy target (MUT-34/45) — its own future qa app, not this one
        '!src/demo/**', // seed data for local dev, not a user-facing flow
        // Desktop-only (Tauri): they render nothing in a browser, so no web spec can reach them.
        '!src/components/ui/UpdateBanner.*',
        '!src/hooks/useTauriUpdater.ts',
        // Only the hosted portal renders it; it is in the portal app's watch instead.
        '!src/components/filters/SegmentedTabs.tsx',
        // MUT-291: the carry-over spans both apps; the carry-over app owns it.
        '!src/pages/carryOver/**',
        '!src/lib/carryOver/**',
      ],
      baseURL: 'http://localhost:5173',
      attachURL: 'http://localhost:5173',
      // Plain `vite` (no --mode): __BUILD_MODE__ resolves to "web", which mounts the
      // app under /app — every spec below navigates to /app/... to match.
      // A dummy PostHog key (MUT-154): the landing's analytics runs, and qa/support/posthog.ts
      // answers every PostHog request locally, so nothing is ever sent.
      // MUT-150: the landing's error reports run on the same dummy DSN; every spec answers Sentry locally
      start: { cmd: `${HEAP_CAPPED} npm run dev -- --port 5173 --strictPort`, env: { MUTABA3A_POSTHOG_KEY: QA_POSTHOG_KEY, MUTABA3A_LANDING_SENTRY_DSN: QA_SENTRY_DSN } },
      ready: 'http://localhost:5173',
      personas: {}, // no auth — local-first, single-user
    },
    portal: {
      label: 'Hosted portal',
      platform: 'web',
      // The portal ships inside the API image (server/scripts/deploy.sh builds dist-hosted),
      // so its last release is the last `make release server`: api-v<version>.
      release: { strategy: 'tag', pattern: 'api-v*', version: 'api-v(.+)' },
      // The portal's own code, plus the shared token and font files it renders with (MUT-102)
      // MUT-368: the self-service screens are the portal-selfservice app's (they need a live API and its outbox).
      watch: ['src/hosted/**', 'hosted.html', 'src/styles/**', 'src/assets/fonts/**', 'src/components/malafat/**', 'src/lib/malafatSuggestions.ts', 'src/content/malafatLinks.ts', 'src/components/filters/SegmentedTabs.tsx', 'src/lib/observability/**', '!src/hosted/**/__tests__/**', '!src/**/*.test.{ts,tsx}',
        '!src/hosted/pages/auth/{SignupPage,RecoverPage,EmailLinkForm,CheckEmailNotice,UnderReviewNotice,SignedOutOnly}.tsx', '!src/hosted/pages/auth/selfService.ts',
        '!src/hosted/components/turnstile/**', '!src/hosted/session/{selfServiceDoors,firstRun}.ts',
        // MUT-418: the trial's card prompt needs a real signup and Stripe's sandbox: the portal-live app's.
        '!src/hosted/components/TrialBanner.tsx', '!src/hosted/data/{trialPrompt,trialPromptQueries}.ts', '!src/hosted/shell/TrialWelcomeOpener.tsx', '!src/hosted/session/trialWelcomeOffer.ts',
        // MUT-291: the carry-over's pages and mapping are the carry-over app's (they need the old app's origin too).
        '!src/hosted/pages/carry-over/**', '!src/hosted/local/carryOver/**'],
      // `vite --mode hosted` (MUT-43). Specs stub every /v1 call with page.route, so no API runs:
      // a 401 from /v1/me is the signed-out portal, which is all the sign-in specs need.
      baseURL: 'http://127.0.0.1:5175',
      attachURL: 'http://127.0.0.1:5175',
      start: { cmd: `${HEAP_CAPPED} npm run dev:hosted`, env: { MUTABA3A_POSTHOG_KEY: QA_POSTHOG_KEY, MUTABA3A_SENTRY_DSN: QA_SENTRY_DSN } },
      ready: 'http://127.0.0.1:5175',
      personas: {},
    },
    'portal-live': {
      label: 'Hosted portal on a live API (Stripe sandbox)',
      platform: 'web',
      // MUT-362 (eng review D8 B): Settings › Billing against a real dev API and Stripe's real hosted pages. Ships
      // with the portal and the API, so it follows the same release tag.
      release: { strategy: 'tag', pattern: 'api-v*', version: 'api-v(.+)' },
      watch: [
        'src/hosted/components/BillingDrawer.tsx',
        'src/hosted/data/billingView.ts',
        'src/hosted/data/billingQueries.ts',
        'src/hosted/data/countries.ts',
        'server/src/routes/billing.ts',
        'server/src/billing/checkout.ts',
        'server/src/billing/billing-countries.json',
        'server/src/billing/stripe/checkout-gateway.ts',
        // MUT-418: the free trial's card prompt (first-run step, Home banner) and the answers it stores.
        'src/hosted/components/TrialBanner.tsx',
        'src/hosted/data/trialPrompt.ts',
        'src/hosted/data/trialPromptQueries.ts',
        'src/hosted/shell/TrialWelcomeOpener.tsx',
        'src/hosted/session/trialWelcomeOffer.ts',
        'server/src/billing/trial-prompt.ts',
        // MUT-361: the lapse gate, enforced by the API and shown by the portal.
        'server/src/billing/gate.ts',
        'server/src/auth/billing-gate.ts',
      ],
      // support/billing-live.mjs: the Keychain sandbox key, a migrated QA database, the sandbox catalog,
      // `stripe listen`, the API on :8790 and the portal on :5176 (8787-8789 are other sessions' dev APIs).
      baseURL: 'http://127.0.0.1:5176',
      attachURL: 'http://127.0.0.1:5176',
      start: { cmd: `${HEAP_CAPPED} node qa/support/billing-live.mjs` },
      ready: 'http://127.0.0.1:5176',
      personas: {},
    },
    'portal-selfservice': {
      label: 'Hosted portal: signup, recovery and the review queue on a live API',
      platform: 'web',
      // MUT-368 (D11): Create an account, Forgot your password and the under-review screen against a real dev API on
      // the memory mailer (read through its dev outbox) and the fixture domain checker, serving the BUILT portal so
      // the real PORTAL_CSP applies. Turnstile is a page-routed stand-in (support/turnstile.ts): QA never contacts
      // Cloudflare. Needs Docker's mutaba3a-test-pg. Ships with the portal and the API, so it follows their tag.
      release: { strategy: 'tag', pattern: 'api-v*', version: 'api-v(.+)' },
      watch: [
        'src/hosted/pages/auth/SignupPage.tsx',
        'src/hosted/pages/auth/RecoverPage.tsx',
        'src/hosted/pages/auth/EmailLinkForm.tsx',
        'src/hosted/pages/auth/CheckEmailNotice.tsx',
        'src/hosted/pages/auth/UnderReviewNotice.tsx',
        'src/hosted/pages/auth/SignedOutOnly.tsx',
        'src/hosted/pages/auth/selfService.ts',
        'src/hosted/components/turnstile/**',
        'src/hosted/session/selfServiceDoors.ts',
        'src/hosted/session/firstRun.ts',
        'server/src/routes/self-service.ts',
        'server/src/auth/self-service.ts',
        'server/src/auth/turnstile.ts',
        'server/src/routes/admin-signup-reviews.ts',
        'server/src/email/domains/**',
        '!src/hosted/**/__tests__/**',
        '!server/src/**/__tests__/**',
      ],
      // support/selfservice-live.mjs: a per-launch QA database, the built portal, and the API on :8791 serving both.
      baseURL: 'http://127.0.0.1:8791',
      attachURL: 'http://127.0.0.1:8791',
      start: { cmd: `${HEAP_CAPPED} node qa/support/selfservice-live.mjs` },
      // Answers only once the API is up with signup open (not just once something listens).
      ready: 'http://127.0.0.1:8791/v1/self-service',
      personas: {},
    },
    'carry-over': {
      label: 'Carry-over: the old web app and the old address to the new address',
      platform: 'web',
      // The receiver ships with the portal (api-v*); the old app's screen with the web app (web-v*). The receiver is
      // the half every carry-over needs, so this app follows the API's tag.
      release: { strategy: 'tag', pattern: 'api-v*', version: 'api-v(.+)' },
      watch: ['src/pages/carryOver/**', 'src/lib/carryOver/**', 'src/hosted/pages/carry-over/**', 'src/hosted/local/carryOver/**', '!**/__tests__/**', '!src/**/*.test.{ts,tsx}'],
      // support/carry-over.mjs (MUT-291 R6): the old app on :5183, the old portal on :5187 and the new on :5188, all
      // on the loopback, each told the others' origins through MUTABA3A_CARRY_OVER. No API runs; specs answer /v1.
      baseURL: 'http://127.0.0.1:5188',
      attachURL: 'http://127.0.0.1:5188',
      start: { cmd: `${HEAP_CAPPED} node qa/support/carry-over.mjs`, env: { MUTABA3A_POSTHOG_KEY: QA_POSTHOG_KEY, MUTABA3A_SENTRY_DSN: QA_SENTRY_DSN } },
      ready: 'http://127.0.0.1:5188',
      personas: {},
    },
  },

  env: {
    // Isolated checkout so a QA run never touches your working tree or dev server.
    worktree: { path: '.claude/worktrees/qa-release', copy: [], install: 'npm ci --prefer-offline' },
    vars: {},
    up: [],
    down: [],
    check: [],
  },

  playwright: {
    cwd: '.',
    command: 'npx playwright test',
    config: 'playwright.config.ts',
    warmup: false, // Vite serves instantly — no first-hit compilation to absorb
    slowMo: 250,
    // MUT-368: each test sends its own client address, so the live APIs' per-IP budgets (signup and recovery: 10 an
    // hour; sign-in) never add up across a run. The QA APIs trust one proxy hop; the stubbed apps ignore it.
    clientIpHeader: 'x-forwarded-for',
  },
};
