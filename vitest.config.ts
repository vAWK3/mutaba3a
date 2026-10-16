import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Pin the timezone so date-sensitive tests are deterministic.
 *
 * Without this, results depend on the developer's machine: the suite passes in
 * UTC+n and fails in UTC-n (see MUT-17). Asia/Jerusalem is the default because
 * it is the primary user timezone and observes DST. Override to test other
 * zones -- `npm run test:tz` runs the suite west of UTC.
 */
const TZ = process.env.TZ || 'Asia/Jerusalem';

/**
 * Coverage floors (MUT-24 §C). `npm run test:coverage`, and so web-ci.yml,
 * fails below them. Global numbers are the measured run floored to a whole
 * percent: raise them when coverage rises, never lower them to land a change.
 * The risk files hold the money, overdue/ageing, payment-record and migration
 * logic; pure ones are pinned at 100.
 */
const PURE = { lines: 100, statements: 100, functions: 100, branches: 100 };
const RISK = { lines: 95, statements: 95, functions: 95, branches: 95 };

const COVERAGE_THRESHOLDS = {
  // 2026-10-16 run: lines 91.69, statements 91.01, functions 88.74, branches 84.12.
  lines: 91,
  statements: 91,
  functions: 88,
  branches: 84,
  // Money arithmetic, minor units, FX
  'src/lib/utils.ts': PURE,
  'src/lib/currencyAmounts.ts': PURE,
  'src/lib/paymentEntry.ts': PURE,
  'src/lib/incomeEntry.ts': PURE,
  'src/lib/fx/fxService.ts': PURE,
  'src/components/ui/AmountWithConversion.tsx': PURE,
  'src/hosted/format/DecimalAmount.tsx': PURE,
  // Overdue, days overdue, owed-now ordering, the MUT-227 date floor
  'src/lib/dates.ts': PURE,
  'src/lib/attention.ts': PURE,
  'src/pages/income/incomeRows.ts': PURE,
  'src/components/clients/clientIndexRows.ts': PURE,
  'src/components/clients/clientProfileRows.ts': PURE,
  'src/components/expenses/recurringAttention.ts': PURE,
  'src/hosted/components/conversionApiErrors.ts': PURE,
  'src/hosted/components/incomeApiErrors.ts': RISK,
  'src/hosted/format/dates.ts': PURE,
  'src/db/aggregations.ts': PURE,
  // Payment records (MUT-18/60) and every other money writer
  'src/db/repository.ts': RISK,
  'src/db/csvImport.ts': RISK,
  'src/db/expenseRepository.ts': RISK,
  // Dexie migrations and the migration safety layer
  'src/db/database.ts': RISK,
  'src/db/migration-safety.ts': RISK,
  'src/db/profileDefault.ts': PURE,
};

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'scripts/**/*.{test,spec}.ts'],
    env: { TZ },
    coverage: {
      provider: 'v8',
      // json-summary feeds web-ci.yml's job summary (scripts/coverage-summary.ts).
      reporter: ['text', 'json', 'html', 'json-summary', 'text-summary'],
      // Write the report even when a test fails, so a red run still shows its numbers.
      reportOnFailure: true,
      thresholds: COVERAGE_THRESHOLDS,
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.spec.{ts,tsx}',
        'src/test/**',
        'src/main.tsx',
        'src/vite-env.d.ts',
      ],
    },
  },
});
