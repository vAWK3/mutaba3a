import { describe, it, expect } from 'vitest';
import { formatCoverageSummary, type CoverageSummary } from '../coverage-summary-format';

/**
 * MUT-24 §C: web-ci.yml writes the coverage of every run to the job summary.
 * The table must read the same totals Vitest's json-summary reporter wrote,
 * name the files with the most uncovered lines (where the next ratchet is),
 * and survive an empty report.
 */

const metric = (covered: number, total: number) => ({ total, covered, skipped: 0, pct: total ? Math.round((covered / total) * 10000) / 100 : 100 });
const file = (lines: [number, number]) => ({
  lines: metric(...lines), statements: metric(...lines), functions: metric(1, 1), branches: metric(1, 2),
});

const summary: CoverageSummary = {
  total: { lines: metric(900, 1000), statements: metric(880, 1000), functions: metric(90, 100), branches: metric(400, 500) },
  '/repo/src/a.ts': file([10, 10]),
  '/repo/src/b.ts': file([5, 20]),
  '/repo/src/c.ts': file([40, 50]),
  '/repo/src/d.ts': file([0, 3]),
};

describe('formatCoverageSummary', () => {
  it('opens with the four totals', () => {
    const md = formatCoverageSummary(summary, { root: '/repo/' });

    expect(md).toContain('## Web coverage');
    expect(md).toContain('| Lines | 90% | 900 / 1000 |');
    expect(md).toContain('| Statements | 88% | 880 / 1000 |');
    expect(md).toContain('| Functions | 90% | 90 / 100 |');
    expect(md).toContain('| Branches | 80% | 400 / 500 |');
  });

  it('lists the files with the most uncovered lines, most first, relative to the repo', () => {
    const md = formatCoverageSummary(summary, { root: '/repo/', top: 2 });

    expect(md).toContain('| `src/b.ts` | 15 | 25% |');
    expect(md).toContain('| `src/c.ts` | 10 | 80% |');
    expect(md.indexOf('src/b.ts')).toBeLessThan(md.indexOf('src/c.ts'));
    expect(md).not.toContain('src/d.ts');
    expect(md).not.toContain('src/a.ts');
  });

  it('leaves out fully covered files and the table when nothing is uncovered', () => {
    const md = formatCoverageSummary({ total: summary.total, '/repo/src/a.ts': file([10, 10]) }, { root: '/repo/' });

    expect(md).not.toContain('Most uncovered');
  });
});
