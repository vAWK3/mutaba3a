import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'dev-dist', 'src-tauri', 'server', '.claude/worktrees']),
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
