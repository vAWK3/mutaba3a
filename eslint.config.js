import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// The storage seam's import patterns (MUT-47), shared by every block that sets
// the TypeScript no-restricted-imports rule on app code: in flat config the
// last block wins per rule, so a block that adds a path must repeat these.
const STORAGE_SEAM_PATTERNS = [
  {
    regex: '(^|/)db/(repository|expenseRepository|dataset|demoData|seed|backup|profileImport|csvImport|integrityCheck|crossProfileStats|migration-safety)$',
    allowTypeImports: true,
    message: 'Storage modules are reached through getRepositories() (MUT-47).',
  },
  {
    regex: '(^|/)db(/index|/database)?$',
    importNames: [
      'db',
      'initDatabase',
      'deleteAllData',
      'clearDatabase',
      'repairDatabase',
      'createBackup',
      'getLatestBackup',
      'getAllBackups',
      'restoreFromBackup',
      'validateMigration',
      'autoFixMigrationIssues',
      'downloadBackup',
      'exportCompleteBackup',
      'importBackupFromFile',
      'clientRepo',
      'projectRepo',
      'categoryRepo',
      'transactionRepo',
      'projectSummaryRepo',
      'clientSummaryRepo',
      'fxRateRepo',
      'settingsRepo',
      'businessProfileRepo',
      'paymentRecordRepo',
    ],
    message: 'Use getRepositories() instead of the database or a repository object (MUT-47).',
  },
  {
    regex: '(^|/)db/orphanedRecords$',
    importNames: ['findOrphanedRecords'],
    message: 'Use getRepositories().base.dataset.findOrphanedRecords() (MUT-47).',
  },
]

export default defineConfig([
  globalIgnores(['dist', 'dev-dist', 'src-tauri', 'server', '.claude/worktrees', 'coverage']),
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
    // The storage seam (MUT-47). Outside src/db, the app reaches storage only
    // through getRepositories(): never `db`, a Dexie repository object, or a
    // module whose exports read or write the database. Pure helpers, constants
    // and types beside them stay importable. The one exception is
    // initDatabase() in src/main.tsx (it opens Dexie before React mounts),
    // which carries its own disable comment.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/db/**', 'src/hosted/**', 'src/**/__tests__/**', 'src/test/**'],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', { patterns: STORAGE_SEAM_PATTERNS }],
    },
  },
  {
    // ADR-090 (MUT-154): the PostHog SDK lives only in the landing's analytics
    // module and the shared, types-only src/lib/analytics. The local app and
    // the desktop build never carry it (ADR-024). The base rule is used here
    // because the TypeScript variant above already guards this tree.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/hosted/**', 'src/pages/landing/**', 'src/pages/download/**', 'src/lib/analytics/**', 'src/**/__tests__/**', 'src/test/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'posthog-js', message: 'Only src/pages/landing/analytics and src/hosted/analytics may load PostHog (ADR-090).' }],
          // Review F2: the counting code itself stays with the landing pages, so a
          // lazily loaded /app page can never start it either
          patterns: [
            { regex: '(^|/)landing/analytics(/|$)', message: 'Only the landing pages count visits (ADR-090, MUT-154).' },
            { regex: '(^|/)lib/analytics/(posthogConfig|guard)$', message: 'The PostHog guard and options load only with the SDK, in the landing or portal analytics module (ADR-090).' },
          ],
        },
      ],
    },
  },
  {
    // The landing pages themselves (MUT-154): only their analytics module loads
    // the SDK or the guard; the pages call useLandingAnalytics().
    files: ['src/pages/landing/**/*.{ts,tsx}', 'src/pages/download/**/*.{ts,tsx}'],
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
    // The TypeScript variant, so it repeats the storage seam it replaces here.
    files: ['src/lib/analytics/**/*.{ts,tsx}'],
    ignores: ['src/lib/analytics/**/__tests__/**'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'posthog-js', allowTypeImports: true, message: 'src/lib/analytics is shared code: types only from posthog-js (ADR-090).' }],
          patterns: STORAGE_SEAM_PATTERNS,
        },
      ],
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
          ],
        },
      ],
    },
  },
  {
    // The hosted portal (MUT-43, hosted-portal.md §8). It shows server figures
    // only: nothing from the local data layer, sync, local hooks, shell,
    // drawers or stores, and not the app's i18n provider (it carries the app's
    // full dictionaries). Amounts are decimal strings end to end.
    files: ['src/hosted/**/*.{ts,tsx}'],
    ignores: ['src/hosted/**/__tests__/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'dexie', message: 'The portal opens no IndexedDB (hosted-portal.md §8).' }],
          patterns: [
            { regex: '(^|/)(db|sync|hooks)(/|$)', message: 'The portal never imports the local data layer, sync or local hooks (hosted-portal.md §8).' },
            { regex: '(^|/)components/(layout|drawers)(/|$)', message: 'The portal has its own shell and no drawers (hosted-portal.md §2).' },
            { regex: '(^|/)lib/(stores|toastStore)', message: 'The portal keeps no app store state (hosted-portal.md §8).' },
            { regex: '(^|/)lib/i18n(/index|/context)?$', message: 'Import lib/i18n/core (and plural): the app provider bundles the app dictionaries.' },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "CallExpression[callee.name='Number']", message: 'No Number() in the portal: amounts are decimal strings (hosted-portal.md §7.3).' },
        { selector: "CallExpression[callee.name=/^parse(Float|Int)$/]", message: 'No parseFloat/parseInt in the portal: amounts are decimal strings.' },
        { selector: "CallExpression[callee.object.name='Number'][callee.property.name=/^parse(Float|Int)$/]", message: 'No Number.parseFloat/parseInt in the portal: amounts are decimal strings.' },
        { selector: "UnaryExpression[operator='+']", message: 'No unary + in the portal: amounts are decimal strings.' },
      ],
    },
  },
])
