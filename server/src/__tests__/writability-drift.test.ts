import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { WRITABILITY_MATRIX } from '../auth/writability.js';

/**
 * MUT-39 AC: "the matrix in the design brief and the enforced behaviour are
 * the same table". The brief's block between the writability-matrix markers is
 * parsed cell by cell and compared with the const every layer enforces.
 */
const BRIEF = resolve(dirname(fileURLToPath(import.meta.url)), '../../../.claude/designs/hosted-portal.md');

function briefRows(): string[][] {
  const text = readFileSync(BRIEF, 'utf8');
  const block = text.split('<!-- writability-matrix:begin -->')[1]?.split('<!-- writability-matrix:end -->')[0];
  if (!block) throw new Error('writability-matrix markers not found in hosted-portal.md');
  return block
    .trim()
    .split('\n')
    .filter((line) => line.startsWith('|') && !line.startsWith('|---'))
    .map((line) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim()));
}

describe('writability matrix: brief ↔ code', () => {
  const [header, ...rows] = briefRows();

  it('has the agreed columns', () => {
    expect(header).toEqual(['Domain', 'Scopes', 'Routes covered', 'Malafat API key', 'User session · hosted profile', 'Writer of record', 'Local profile']);
  });

  it('has one row per domain, in the same order as the const', () => {
    expect(rows.map((r) => r[0])).toEqual(WRITABILITY_MATRIX.map((r) => r.domain));
  });

  it.each(WRITABILITY_MATRIX.map((r, i) => [r.domain, i] as const))('row %s is identical cell by cell', (_domain, i) => {
    const row = WRITABILITY_MATRIX[i]!;
    const cells = rows[i]!;
    expect(cells).toEqual([
      row.domain,
      row.scopes.length ? row.scopes.join(', ') : '—',
      row.routes,
      row.apiKey,
      row.session,
      row.writerOfRecord ?? '—',
      'device',
    ]);
  });
});
