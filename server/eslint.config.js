import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  globalIgnores(['dist', 'node_modules', 'prisma/generated']),
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.node,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // ADR-097 (MUT-286): the portal's local backend imports server modules, never the reverse — the server
    // stays deployable on its own. These are the app's top-level src/ directories; none exists under server/src.
    files: ['src/**/*.ts'],
    ignores: ['src/__tests__/platform-shim.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '(^|/)src/(assets|components|content|db|demo|hooks|hosted|lib|pages|services|styles|test|types|utils)(/|$)',
              message: 'The server never imports the web app (ADR-097).',
            },
          ],
        },
      ],
    },
  },
]);
