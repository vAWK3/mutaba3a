import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * MUT-8 guard: Home's forecast strip, month-actuals row, guidance attention
 * feed and KPI cards were deleted by decision (ADR-036). A partial revert must
 * not quietly bring a component back that nothing renders.
 */
const ROOT = join(__dirname, '..');
const GONE = [
  'components/home/PredictiveKpiStrip.tsx',
  'components/home/MonthActualsRow.tsx',
  'components/home/AttentionFeed.tsx',
  'components/home/KpiCard.tsx',
];

describe('Home surface after MUT-8', () => {
  it.each(GONE)('%s no longer exists', (rel) => {
    expect(existsSync(join(ROOT, rel))).toBe(false);
  });

  it('the home barrel exports only the two MUT-8 sections', () => {
    const barrel = readFileSync(join(ROOT, 'components/home/index.ts'), 'utf8');
    expect(barrel).toContain('HomeNeedsAttention');
    expect(barrel).toContain('HomeRecentPayments');
    expect(barrel).not.toMatch(/PredictiveKpiStrip|MonthActualsRow|AttentionFeed|KpiCard|KpiStrip/);
  });
});
