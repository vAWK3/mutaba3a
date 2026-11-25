import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

/** MUT-587: as the web's DATE_LOCALE_SYNTAX (eslint.config.js); Arabic dates take ARABIC_LOCALE from src/dates.ts. */
const DATE_CALL = ["NewExpression[callee.object.name='Intl'][callee.property.name=/^(DateTimeFormat|RelativeTimeFormat)$/]", "CallExpression[callee.property.name=/^toLocale(Date|Time)?String$/]"];
const ARABIC_LITERAL = '/^ar(-|$)/';
const DATE_LOCALE_SYNTAX = [
  ...DATE_CALL.flatMap((call) => [
    `${call}[arguments.0.type='Literal'][arguments.0.value=${ARABIC_LITERAL}]`,
    `${call}[arguments.0.type='ConditionalExpression'][arguments.0.consequent.value=${ARABIC_LITERAL}]`,
    `${call}[arguments.0.type='ConditionalExpression'][arguments.0.alternate.value=${ARABIC_LITERAL}]`,
  ]).map((selector) => ({ selector, message: 'Format Arabic dates with ARABIC_LOCALE from src/dates.ts (MUT-587): Levantine months, Latin digits.' })),
  { selector: 'TemplateElement[value.raw=/-u-nu-/]', message: 'Use ARABIC_LOCALE as it is: it already sets Latin digits, and a second -u-nu- throws (MUT-587).' },
];

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
    files: ['src/**/*.ts'],
    ignores: ['src/**/__tests__/**'],
    rules: {
      'no-restricted-syntax': ['error', ...DATE_LOCALE_SYNTAX],
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
            {
              // MUT-314 (ADR-248): period-pack/index.ts is the module's only door; its files import each other relatively.
              regex: '(^|/)period-pack/(?!index\\.js$)[^/]+$',
              message: 'Import the period download through period-pack/index.js only.',
            },
          ],
        },
      ],
    },
  },
]);
