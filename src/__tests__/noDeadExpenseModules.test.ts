import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * MUT-14 guard: a partial revert of one deletion commit must not quietly
 * resurrect a page nothing routes to, or a module nothing imports.
 */
const ROOT = join(__dirname, '..');
const GONE = [
  'pages/expenses/ExpensesPage.tsx',
  'pages/expenses/ProfileExpensesPage.tsx',
  'pages/expenses/ReceiptsPage.tsx',
  'pages/expenses/ExpensesOverviewPage.tsx',
  'pages/expenses/ExpensesForecastPage.tsx',
  'pages/expenses/VendorsPage.tsx',
  'pages/expenses/MonthCloseChecklistPage.tsx',
  'pages/expenses/components',
  'pages/suppliers',
  'components/ui/ClosedMonthWarning.tsx',
  'components/drawers/RecurringRuleDrawer.tsx',
  'db/forecastCalculations.ts',
  'lib/matchingAlgorithm.ts',
];

describe('expense surface after MUT-14', () => {
  it.each(GONE)('%s no longer exists', (rel) => {
    expect(existsSync(join(ROOT, rel))).toBe(false);
  });

  it('the expenses page barrel exports only the ledger', () => {
    const barrel = readFileSync(join(ROOT, 'pages/expenses/index.ts'), 'utf8');
    expect(barrel.trim()).toBe("export { ExpensesLedgerPage } from './ExpensesLedgerPage';");
  });

  it('the drawers barrel no longer exports the orphan recurring-rule drawer', () => {
    const barrel = readFileSync(join(ROOT, 'components/drawers/index.ts'), 'utf8');
    expect(barrel).not.toContain('RecurringRuleDrawer');
  });
});
