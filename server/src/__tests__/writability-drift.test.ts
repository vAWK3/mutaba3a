import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PROFILE_DEPENDENT_DOMAINS, sessionAccessFor, WRITABILITY_MATRIX } from '../auth/writability.js';

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
    // MUT-65: the three profile-dependent rows carry a fixed, literal suffix on
    // the session cell rather than a change to the matrix's own `session`
    // value, so this stays a plain string comparison — no grammar to parse.
    const session = PROFILE_DEPENDENT_DOMAINS.has(row.domain) ? `${row.session}; read-write on a personal profile` : row.session;
    expect(cells).toEqual([
      row.domain,
      row.scopes.length ? row.scopes.join(', ') : '—',
      row.routes,
      row.apiKey,
      session,
      row.writerOfRecord ?? '—',
      'device',
    ]);
  });

  it.each([...PROFILE_DEPENDENT_DOMAINS])('%s: the suffix is backed by sessionAccessFor, not just brief prose (MUT-65)', (domain) => {
    const row = WRITABILITY_MATRIX.find((r) => r.domain === domain)!;
    expect(sessionAccessFor(domain, null)).toBe('read-write');
    expect(sessionAccessFor(domain, 'MALAFAT')).toBe(row.session);
  });
});
