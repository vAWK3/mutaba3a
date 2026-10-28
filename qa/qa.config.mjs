/**
 * release-qa config for mini-crm (MUT-97, companion to MAL-1007).
 * Engine and docs: ~/Work/tools/release-qa (SKILL.md).
 *
 * Apps: the website (landing, privacy, terms), the hosted portal on stubbed and on live
 * APIs, and the carry-over between the portal's two addresses. The free web app at /app
 * and the desktop apps are retired (MUT-445).
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
      label: 'Website',
      platform: 'web',
      // `make release web` tags web-v<version> (scripts/tag-release.sh). The plain v* tags
      // belong to the retired desktop app and stopped at v0.0.67.
      release: { strategy: 'tag', pattern: 'web-v*', version: 'web-v(.+)' },
      // What the website build loads (src/main.tsx), and what Netlify serves beside it. The rest of src/ outside
      // src/hosted is the portal's, in its watch below.
      watch: [
        'src/main.tsx',
        'index.html',
        'src/index.css',
        'src/pages/landing/**',
        'src/content/**',
        'src/components/brand/**',
        'src/components/ui/{ErrorBoundary,Input}.*',
        'src/hooks/**',
        'src/lib/{appVersion,dates,goHosted,utils}.ts',
        'src/lib/{analytics,i18n,theme}/**',
        'src/styles/**',
        'src/assets/**',
        'public/**',
        'netlify.toml',
        // MUT-387: Malafat's OAuth client document; `make release web` checks the live copy (release:oauth-client)
        '!public/.well-known/**',
        '!src/**/__tests__/**',
        '!src/**/*.test.{ts,tsx}',
      ],
      baseURL: 'http://localhost:5173',
      attachURL: 'http://localhost:5173',
      // A dummy PostHog key (MUT-154): the landing's analytics runs, and qa/support/posthog.ts
      // answers every PostHog request locally, so nothing is ever sent.
      // MUT-150: the landing's error reports run on the same dummy DSN; every spec answers Sentry locally
      start: { cmd: `${HEAP_CAPPED} npx vite --config qa/support/qa.vite.ts --port 5173 --strictPort`, env: { QA_VITE_ROLE: 'web', MUTABA3A_POSTHOG_KEY: QA_POSTHOG_KEY, MUTABA3A_LANDING_SENTRY_DSN: QA_SENTRY_DSN } },
      ready: 'http://localhost:5173',
      personas: {}, // no auth
    },
    portal: {
      label: 'Hosted portal',
      platform: 'web',
      // The portal ships inside the API image (server/scripts/deploy.sh builds dist-hosted),
      // so its last release is the last `make release server`: api-v<version>.
      release: { strategy: 'tag', pattern: 'api-v*', version: 'api-v(.+)' },
      // The portal's own code, plus the shared token and font files it renders with (MUT-102)
      // MUT-368: the self-service screens are the portal-selfservice app's (they need a live API and its outbox).
      watch: ['src/hosted/**', 'hosted.html', 'src/styles/**', 'src/assets/fonts/**', 'src/components/malafat/**', 'src/lib/malafatSuggestions.ts', 'src/content/malafatLinks.ts', 'src/lib/observability/**',
        // MUT-445: the shared UI only the portal renders now that the free web app is retired
        'src/components/{expenses,filters,icons,ui}/**', 'src/lib/{dom,forms,motion,whatsNew}/**', 'src/lib/{malafatMomentStore,savedFlashStore,useSavedFlash}.ts',
        '!src/components/ui/{ErrorBoundary,Input}.*', '!src/hosted/**/__tests__/**', '!src/**/__tests__/**', '!src/**/*.test.{ts,tsx}',
        '!src/hosted/pages/auth/{SignupPage,RecoverPage,EmailLinkForm,CheckEmailNotice,UnderReviewNotice,SignedOutOnly}.tsx', '!src/hosted/pages/auth/selfService.ts',
        '!src/hosted/components/turnstile/**', '!src/hosted/session/{selfServiceDoors,firstRun}.ts',
        // MUT-468: the mail art is read through the live API's outbox: the portal-selfservice app's.
        '!src/hosted/public/mail/**',
        // MUT-418: the trial's card prompt needs a real signup and Stripe's sandbox: the portal-live app's.
        '!src/hosted/components/TrialBanner.tsx', '!src/hosted/data/{trialPrompt,trialPromptQueries}.ts', '!src/hosted/shell/TrialWelcomeOpener.tsx', '!src/hosted/session/trialWelcomeOffer.ts',
        // MUT-291: the carry-over's pages and mapping are the carry-over app's (they need the old app's origin too).
        '!src/hosted/pages/carry-over/**', '!src/hosted/local/carryOver/**',
        // MUT-115: passkeys need a real WebAuthn relying party: the portal-selfservice app's.
        '!src/hosted/passkeys/**', '!src/hosted/components/PasskeysDrawer.tsx',
        // MUT-370: the passkey suggestion is the portal-selfservice app's too.
        '!src/hosted/components/PasskeySuggestion.tsx', '!src/hosted/data/{passkeyPrompt,passkeyPromptQueries}.ts',
        // MUT-434: connecting an agent needs the live API's OAuth server and /mcp: the portal-selfservice app's.
        '!src/hosted/pages/connect/**', '!src/hosted/components/{ConnectClaudeDrawer,CopyField}.tsx', '!src/hosted/data/oauthQueries.ts', '!src/hosted/session/features.ts',
        // MUT-460: the operator console needs the live API's operator gate and a real passkey step-up.
        '!src/hosted/pages/operator/**', '!src/hosted/operator/**', '!src/hosted/data/{operatorQueries,signupReviews}.ts'],
      // `vite --mode hosted` (MUT-43). Specs stub every /v1 call with page.route, so no API runs:
      // a 401 from /v1/me is the signed-out portal, which is all the sign-in specs need.
      baseURL: 'http://127.0.0.1:5175',
      attachURL: 'http://127.0.0.1:5175',
      start: { cmd: `${HEAP_CAPPED} npx vite --config qa/support/qa.vite.ts --mode hosted`, env: { QA_VITE_ROLE: 'portal', MUTABA3A_POSTHOG_KEY: QA_POSTHOG_KEY, MUTABA3A_SENTRY_DSN: QA_SENTRY_DSN } },
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
        // MUT-468: the mail frame and its art, opened from the outbox as a mail app would.
        'server/src/email/templates/**',
        'server/src/email/mailer.ts',
        'src/hosted/public/mail/**',
        // MUT-115: passkeys need a real WebAuthn relying party, so their flows run here (Chromium's virtual authenticator).
        'src/hosted/passkeys/**',
        'src/hosted/components/PasskeysDrawer.tsx',
        'server/src/routes/passkeys.ts',
        'server/src/auth/webauthn.ts',
        'server/src/auth/passkey-names.ts',
        // MUT-370: the passkey suggestion on Home needs the same relying party.
        'src/hosted/components/PasskeySuggestion.tsx',
        'src/hosted/data/passkeyPrompt.ts',
        'src/hosted/data/passkeyPromptQueries.ts',
        'server/src/auth/passkey-prompt.ts',
        // MUT-434: OAuth for MCP agents needs the live API (its issuer, tokens and /mcp).
        'server/src/oauth/**',
        'server/src/routes/oauth.ts',
        'server/src/routes/oauth-consent.ts',
        'server/src/routes/oauth-cleanup.ts',
        'server/src/routes/mcp.ts',
        'server/src/mcp/**',
        // MUT-435: the agent's read tools and the same-purchase rule they share with MUT-437.
        'server/src/expenses/similarity.ts',
        // MUT-436: the receipt upload path the agent's receipt tools share with the routes.
        'server/src/expenses/receipts-compose.ts',
        // MUT-437: inbox filing, shared by POST /v1/inbox/{id}/file-as-expense and the agent's file_inbox_entry.
        'server/src/inbox/file-expense.ts',
        'server/src/auth/agent-auth.ts',
        'src/hosted/pages/connect/**',
        'src/hosted/components/ConnectClaudeDrawer.tsx',
        'src/hosted/components/CopyField.tsx',
        'src/hosted/session/features.ts',
        'src/hosted/data/oauthQueries.ts',
        // MUT-460: the operator console (MUT-459's gate and passkey step-up) and the digest that links to it.
        'src/hosted/pages/operator/**',
        'src/hosted/operator/**',
        'src/hosted/data/operatorQueries.ts',
        'src/hosted/data/signupReviews.ts',
        'server/src/operator/**',
        'server/src/routes/operator.ts',
        'server/src/auth/operator-gate.ts',
        'server/src/auth/step-up.ts',
        'server/src/email/review-digest.ts',
        // MUT-482: the summaries Malafat reads with an API key, checked on the live API.
        'server/src/summaries/compute.ts',
        'server/src/routes/summaries.ts',
        // MUT-441: the server reads receipts on its own receipt-ocr sidecar (selfservice-live.mjs starts it).
        'server/src/receipts/**',
        'server/src/routes/receipt-reading.ts',
        'server/ocr/app/**',
        '!src/hosted/**/__tests__/**',
        '!server/src/**/__tests__/**',
        '!server/ocr/app/__pycache__/**',
      ],
      // support/selfservice-live.mjs: a per-launch QA database, the built portal, and the API on :8791 serving both,
      // reading receipts on the receipt-ocr sidecar on :8792 (MUT-441; server/ocr/run_local.sh, needs Tesseract).
      // `localhost`, not 127.0.0.1: the passkey flows (MUT-115) need it as their WebAuthn RP ID.
      baseURL: 'http://localhost:8791',
      attachURL: 'http://localhost:8791',
      start: { cmd: `${HEAP_CAPPED} node qa/support/selfservice-live.mjs` },
      // Answers only once the API is up with signup open (not just once something listens).
      ready: 'http://localhost:8791/v1/self-service',
      personas: {},
    },
    'carry-over': {
      label: 'Carry-over: the old address, or a file from the old web app, to the new address',
      platform: 'web',
      // The receiver and both portals ship with the API (api-v*).
      release: { strategy: 'tag', pattern: 'api-v*', version: 'api-v(.+)' },
      watch: ['src/lib/carryOver/**', 'src/hosted/pages/carry-over/**', 'src/hosted/local/carryOver/**', '!**/__tests__/**', '!src/**/*.test.{ts,tsx}'],
      // support/carry-over.mjs (MUT-291 R6): the old portal on :5187 and the new on :5188, both
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
