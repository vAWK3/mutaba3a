/**
 * `npx tsx scripts/coverage-summary.ts [coverage/coverage-summary.json]`
 * (MUT-24 §C): prints the run's coverage as markdown. web-ci.yml appends it to
 * $GITHUB_STEP_SUMMARY after `npm run test:coverage`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { formatCoverageSummary, type CoverageSummary } from './coverage-summary-format';

const reportPath = resolve(process.argv[2] ?? 'coverage/coverage-summary.json');
const summary = JSON.parse(readFileSync(reportPath, 'utf8')) as CoverageSummary;
process.stdout.write(formatCoverageSummary(summary, { root: `${process.cwd()}/` }));
