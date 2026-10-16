/**
 * Turns Vitest's json-summary report into the markdown web-ci.yml appends to
 * the job summary (MUT-24 §C). Kept apart from coverage-summary.ts, which
 * reads files on import, so it can be tested
 * (scripts/__tests__/coverage-summary.test.ts).
 */

export interface CoverageMetric {
  total: number;
  covered: number;
  skipped: number;
  pct: number;
}

export interface FileCoverage {
  lines: CoverageMetric;
  statements: CoverageMetric;
  functions: CoverageMetric;
  branches: CoverageMetric;
}

/** coverage/coverage-summary.json: one `total` entry plus one per absolute file path. */
export type CoverageSummary = { total: FileCoverage } & Record<string, FileCoverage>;

const METRICS: [keyof FileCoverage, string][] = [
  ['lines', 'Lines'],
  ['statements', 'Statements'],
  ['functions', 'Functions'],
  ['branches', 'Branches'],
];

const DEFAULT_TOP = 10;

const uncoveredLines = (f: FileCoverage) => f.lines.total - f.lines.covered;

export function formatCoverageSummary(summary: CoverageSummary, options: { root: string; top?: number }): string {
  const { total, ...files } = summary;
  const out = ['## Web coverage', '', '| Metric | Covered | Count |', '|---|---|---|'];
  for (const [key, label] of METRICS) {
    out.push(`| ${label} | ${total[key].pct}% | ${total[key].covered} / ${total[key].total} |`);
  }

  const worst = Object.entries(files)
    .filter(([, f]) => uncoveredLines(f) > 0)
    .sort(([, a], [, b]) => uncoveredLines(b) - uncoveredLines(a))
    .slice(0, options.top ?? DEFAULT_TOP);
  if (worst.length > 0) {
    out.push('', '### Most uncovered lines', '', '| File | Uncovered lines | Lines |', '|---|---|---|');
    for (const [path, f] of worst) {
      out.push(`| \`${path.replace(options.root, '')}\` | ${uncoveredLines(f)} | ${f.lines.pct}% |`);
    }
  }
  return out.join('\n') + '\n';
}
