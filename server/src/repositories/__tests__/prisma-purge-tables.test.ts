import { describe, expect, it } from 'vitest';
import { PURGE_PROFILE_TABLES, PURGE_PROFILE_TABLES_EXEMPT, RETAINED_ISSUING_DOCUMENT_TABLES, RETAINED_ISSUING_PROFILE_TABLES, RETAINED_ISSUING_TABLES } from '../prisma-purge-tables.js';

describe('MUT-644: the retention sweep’s tables (ADR-277 D4)', () => {
  it('are exactly the tables the purge keeps 7 years', () => {
    const kept = Object.entries(PURGE_PROFILE_TABLES_EXEMPT).filter(([, why]) => why.startsWith('kept 7 years')).map(([table]) => table);
    expect([...RETAINED_ISSUING_TABLES].sort()).toEqual(kept.sort());
  });

  it('none of them is deleted by the purge, and the sweep’s log outlives it', () => {
    for (const table of RETAINED_ISSUING_TABLES) expect(PURGE_PROFILE_TABLES as readonly string[]).not.toContain(table);
    expect(PURGE_PROFILE_TABLES_EXEMPT).toHaveProperty('issuing_retention_events');
  });

  it('split into what goes one document at a time (the document last) and the profile’s own rows (amended 2026-11-25)', () => {
    const perDocument = RETAINED_ISSUING_DOCUMENT_TABLES.map(([table]) => table);
    expect(perDocument.at(-1)).toBe('issued_documents');
    for (const table of perDocument) expect(PURGE_PROFILE_TABLES_EXEMPT[table]).toMatch(/^kept 7 years from each document/);
    for (const table of RETAINED_ISSUING_PROFILE_TABLES) expect(PURGE_PROFILE_TABLES_EXEMPT[table]).toMatch(/^kept 7 years, until its last document goes/);
    expect(new Set(RETAINED_ISSUING_TABLES).size).toBe(perDocument.length + RETAINED_ISSUING_PROFILE_TABLES.length);
  });
});
