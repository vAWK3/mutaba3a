import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

/**
 * MUT-149 (ADR-091 am.11): the Sentry browser SDK loads only in the portal's
 * lazy crash-reporting chunk and the landing's own lazy chunks; nothing else
 * carries it. Types stay importable for the shared, pure options builder.
 */
const SENTRY_SDK_PATH = {
  name: '@sentry/browser',
  allowTypeImports: true,
  message:
    'Only src/hosted/observability/portalSentry.ts (signed in only, ADR-091 am.11) and src/pages/landing/observability/landingSentry.ts (website pages only, MUT-150) load the Sentry SDK, lazily.',
}

/** Browser Sentry code reuses MUT-148's contract and scrubber, both pure and Node-free, and nothing else of the server. */
const SERVER_SENTRY_CONTRACT_ONLY = {
  regex: '(^|/)server/src/(?!observability/(sentry-rules|sentry-scrub)(\\.js)?$)',
  message: 'The browser Sentry setup imports only the contract and the scrubber from the server (ADR-091 am.6).',
}

/** The portal's import bans (MUT-43, hosted-portal.md §8), shared by the portal and its local backend (ADR-097). */
const PORTAL_RESTRICTED_PATHS = [{ name: 'dexie', message: 'The portal never uses Dexie; local mode stores API-shaped records itself (ADR-097).' }]
const PORTAL_RESTRICTED_PATTERNS = [
  { regex: '(^|/)(db|sync|hooks)(/|$)', message: 'The portal never imports the local data layer, sync or local hooks (hosted-portal.md §8).' },
  { regex: '(^|/)components/(layout|drawers)(/|$)', message: 'The portal has its own shell and no drawers (hosted-portal.md §2).' },
  { regex: '(^|/)lib/(stores|toastStore)', message: 'The portal keeps no app store state (hosted-portal.md §8).' },
  { regex: '(^|/)lib/i18n(/index|/context)?$', message: 'Import lib/i18n/core (and plural): the app provider bundles the app dictionaries.' },
]
const PORTAL_DECIMAL_SYNTAX = [
  { selector: "CallExpression[callee.name='Number']", message: 'No Number() in the portal: amounts are decimal strings (hosted-portal.md §7.3).' },
  { selector: "CallExpression[callee.name=/^parse(Float|Int)$/]", message: 'No parseFloat/parseInt in the portal: amounts are decimal strings.' },
  { selector: "CallExpression[callee.object.name='Number'][callee.property.name=/^parse(Float|Int)$/]", message: 'No Number.parseFloat/parseInt in the portal: amounts are decimal strings.' },
  { selector: "UnaryExpression[operator='+']", message: 'No unary + in the portal: amounts are decimal strings.' },
]
/** The server modules src/hosted/local may import (ADR-097 §9). Everything they import in turn is the server's business. */
const LOCAL_SERVER_ALLOWLIST = [
  'app-shell',
  'attachments/rules',
  'attachments/storage',
  'auth/middleware',
  'auth/sessions',
  'auth/store-guard',
  'fx-rates',
  'logger',
  // MUT-291: the carry-over formats amounts as the routes do (already in the chunk through them); pure, no I/O
  'money',
  'personal-profile',
  'rate-limit',
  // MUT-325: the records file's text and the device person's address, shared with the hosted export
  'records-file/codec',
  'records-file/local-person',
  'repositories/memory',
  'repositories/ports',
  'routes/fx-rates',
  'routes/me',
  'routes/portal-routes',
  'routes/profiles',
  'schemas',
]

export default defineConfig([
  globalIgnores(['dist', 'dev-dist', 'server', '.claude/worktrees', 'coverage']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  {
    // release-qa tooling (MUT-97), not application code. Playwright's
    // `test.extend()` fixtures take a second parameter conventionally named
    // `use`, which react-hooks mistakes for the React hook of the same name;
    // `support/qa.ts`'s require() fallback for qa.config.mjs is untyped by
    // nature (a dynamically loaded config, not app data).
    files: ['qa/**/*.{ts,tsx}'],
    rules: {
      'react-hooks/rules-of-hooks': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // The Sentry SDK outside the portal (MUT-149); the landing's own chunks have their exception below.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/hosted/**', 'src/**/__tests__/**', 'src/test/**'],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', { paths: [SENTRY_SDK_PATH] }],
    },
  },
  {
    // ADR-090 (MUT-154): the PostHog SDK lives only in the landing's analytics
    // module and the shared, types-only src/lib/analytics. The base rule is used here
    // because the TypeScript variant above already guards this tree.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/hosted/**', 'src/pages/landing/**', 'src/lib/analytics/**', 'src/**/__tests__/**', 'src/test/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'posthog-js', message: 'Only src/pages/landing/analytics and src/hosted/analytics may load PostHog (ADR-090).' }],
          // Review F2: the counting code itself stays with the landing pages
          patterns: [
            { regex: '(^|/)landing/analytics(/|$)', message: 'Only the landing pages count visits (ADR-090, MUT-154).' },
            // MUT-150 review: the same for the website's error reports; main.tsx starts them with an inline exception
            { regex: '(^|/)landing/observability(/|$)', message: "Only the website's pages report errors (MUT-150)." },
            { regex: '(^|/)lib/analytics/(posthogConfig|guard)$', message: 'The PostHog guard and options load only with the SDK, in the landing or portal analytics module (ADR-090).' },
          ],
        },
      ],
    },
  },
  {
    // The landing pages themselves (MUT-154): only their analytics module loads
    // the SDK or the guard; the pages call useLandingAnalytics().
    files: ['src/pages/landing/**/*.{ts,tsx}'],
    ignores: ['src/pages/landing/analytics/**', 'src/**/__tests__/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'posthog-js', message: 'Only src/pages/landing/analytics loads PostHog on the landing (ADR-090).' }],
          patterns: [{ regex: '(^|/)lib/analytics/(posthogConfig|guard)$', message: 'The PostHog guard and options load with the SDK, in landingAnalytics.ts (ADR-090, review F4).' }],
        },
      ],
    },
  },
  {
    // Review F7: the shared library may import the SDK's types, never the SDK.
    files: ['src/lib/analytics/**/*.{ts,tsx}'],
    ignores: ['src/lib/analytics/**/__tests__/**'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'posthog-js', allowTypeImports: true, message: 'src/lib/analytics is shared code: types only from posthog-js (ADR-090).' }, SENTRY_SDK_PATH],
        },
      ],
    },
  },
  {
    // MUT-149 (ADR-091 am.11, eng D4): the browser Sentry options reuse MUT-148's
    // contract and scrubber, both pure and Node-free, and nothing else of the
    // server.
    files: ['src/lib/observability/**/*.{ts,tsx}'],
    ignores: ['src/lib/observability/**/__tests__/**'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [SENTRY_SDK_PATH],
          patterns: [SERVER_SENTRY_CONTRACT_ONLY],
        },
      ],
    },
  },
  {
    // MUT-150: the landing's error reports, under the same server-import rule.
    files: ['src/pages/landing/observability/**/*.{ts,tsx}'],
    ignores: ['src/pages/landing/observability/**/__tests__/**'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        { paths: [SENTRY_SDK_PATH], patterns: [SERVER_SENTRY_CONTRACT_ONLY] },
      ],
    },
  },
  {
    // The landing's lazy error-report chunk (MUT-150): the one landing file that loads the Sentry SDK.
    files: ['src/pages/landing/observability/landingSentry.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', { patterns: [SERVER_SENTRY_CONTRACT_ONLY] }],
    },
  },
  {
    // The portal's half of the same guard (MUT-155): only src/hosted/analytics
    // loads the SDK. The TypeScript variant, because the base rule below holds
    // the portal's own import guards.
    files: ['src/hosted/**/*.{ts,tsx}'],
    ignores: ['src/hosted/analytics/**', 'src/hosted/**/__tests__/**'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'posthog-js', allowTypeImports: true, message: 'Only src/hosted/analytics may load PostHog in the portal (ADR-090).' },
            SENTRY_SDK_PATH,
          ],
        },
      ],
    },
  },
  {
    // The block above skips the portal's analytics module; the Sentry ban still holds there (MUT-149).
    files: ['src/hosted/analytics/**/*.{ts,tsx}'],
    ignores: ['src/hosted/analytics/**/__tests__/**'],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', { paths: [SENTRY_SDK_PATH] }],
    },
  },
  {
    // The portal's lazy crash-reporting chunk (MUT-149): the one file that loads
    // the Sentry SDK. It keeps the PostHog half of the block above.
    files: ['src/hosted/observability/portalSentry.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        { paths: [{ name: 'posthog-js', allowTypeImports: true, message: 'Only src/hosted/analytics may load PostHog in the portal (ADR-090).' }] },
      ],
    },
  },
  {
    // The hosted portal (MUT-43, hosted-portal.md §8). It shows server figures
    // only: nothing from the local data layer, sync, local hooks, shell,
    // drawers or stores, and not the app's i18n provider (it carries the app's
    // full dictionaries). Amounts are decimal strings end to end.
    // Since ADR-097 (MUT-286) the server's own routes run in the page signed
    // out, but only from src/hosted/local (next block); everything else reaches
    // them lazily through client.ts's dynamic import of @mut/local-backend.
    files: ['src/hosted/**/*.{ts,tsx}'],
    ignores: ['src/hosted/**/__tests__/**', 'src/hosted/local/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            ...PORTAL_RESTRICTED_PATHS,
            { name: '@mut/local-backend', message: 'Load the local backend only through client.ts localBackend(): a static import puts it in every signed-in page (ADR-097 §2.7).' },
          ],
          patterns: [
            ...PORTAL_RESTRICTED_PATTERNS,
            { regex: '(^|/)server/src(/|$)', message: 'Only src/hosted/local runs server code in the page (ADR-097).' },
          ],
        },
      ],
      'no-restricted-syntax': ['error', ...PORTAL_DECIMAL_SYNTAX],
    },
  },
  {
    // The portal's local backend (MUT-286, ADR-097 §9): the portal's rules,
    // plus an allowlist of server modules — the route list, the in-memory
    // store, the auth middleware, the shell, and the session-token
    // primitives. Anything else in server/src (Prisma, argon2, Node-only I/O)
    // stays out of the browser.
    files: ['src/hosted/local/**/*.ts'],
    ignores: ['src/hosted/local/**/__tests__/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: PORTAL_RESTRICTED_PATHS,
          patterns: [
            ...PORTAL_RESTRICTED_PATTERNS,
            {
              regex: `(^|/)server/src/(?!(${LOCAL_SERVER_ALLOWLIST.join('|')})\\.js$)`,
              message: 'The local backend imports only the allowlisted server modules (eslint.config.js LOCAL_SERVER_ALLOWLIST, ADR-097 §9).',
            },
          ],
        },
      ],
      'no-restricted-syntax': ['error', ...PORTAL_DECIMAL_SYNTAX],
    },
  },
])
