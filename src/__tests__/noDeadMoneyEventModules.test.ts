import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * MUT-58 guard: Home's forecast strip, month actuals and guidance feed were the
 * only readers of the money-event engine (ADR-036 §3). With them gone, the read
 * hooks, the repository behind them, the invalidation every write path ran for
 * them, and the month-key helpers only those components used were deleted. A
 * partial revert must not bring any of it back, or a write path calling it.
 */
const ROOT = join(__dirname, '..');
const GONE = [
  'hooks/useMoneyEventQueries.ts',
  'db/moneyEventRepository.ts',
  'lib/monthDetection.ts',
];
const DELETED_NAMES = /useMoneyEventQueries|moneyEventRepository|invalidateMoneyEventQueries|monthDetection/;
const DELETED_TYPES = [
  'MoneyDirection',
  'MoneyEventSource',
  'MoneyEventState',
  'MoneyConfidence',
  'MoneyEvent',
  'DailyAggregate',
  'MonthSummary',
  'YearSummary',
  'GuidanceSeverity',
  'GuidanceCategory',
  'GuidanceItem',
  'MoneyEventFilters',
];

function sourceFiles(): string[] {
  return (readdirSync(ROOT, { recursive: true }) as string[])
    .filter((rel) => /\.tsx?$/.test(rel))
    .filter((rel) => !rel.endsWith('noDeadMoneyEventModules.test.ts'));
}

describe('money-event read side after MUT-58', () => {
  it.each(GONE)('%s no longer exists', (rel) => {
    expect(existsSync(join(ROOT, rel))).toBe(false);
  });

  it('no source file imports or calls the deleted modules', () => {
    const offenders = sourceFiles().filter((rel) =>
      DELETED_NAMES.test(readFileSync(join(ROOT, rel), 'utf8'))
    );
    expect(offenders).toEqual([]);
  });

  it('the shared types no longer declare the money-event and guidance shapes', () => {
    const types = readFileSync(join(ROOT, 'types/index.ts'), 'utf8');
    const declared = DELETED_TYPES.filter((name) =>
      new RegExp(`export (interface|type) ${name}\\b`).test(types)
    );
    expect(declared).toEqual([]);
  });

  // The moneyEventVersions table this guard used to keep (ADR-029) was sync
  // versioning, not the read side; MUT-73 dropped it with the other sync
  // tables (ADR-053), and noSyncModules.test.ts asserts it is gone.
});
