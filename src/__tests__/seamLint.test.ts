import { describe, it, expect } from 'vitest';
import { ESLint } from 'eslint';

// MUT-47 (D6): the lint rule that keeps storage behind getRepositories().
// Lints in-memory sources at real paths so the config's file globs apply.

const RULE = '@typescript-eslint/no-restricted-imports';
const eslint = new ESLint({ cwd: process.cwd() });

async function seamErrors(code: string, filePath: string): Promise<number> {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter((m) => m.ruleId === RULE).length;
}

const outside = 'src/components/clients/SeamProbe.tsx';

describe('storage seam lint rule (MUT-47)', () => {
  it.each([
    ["import { db } from '../../db';", 'db from the barrel'],
    ["import { db } from '../../db/database';", 'db from database'],
    ["import { clientRepo } from '../../db';", 'a repository singleton from the barrel'],
    ["import { expenseRepo } from '../../db/expenseRepository';", 'a repository module'],
    ["import { deleteAllData } from '../../db';", 'a whole-database helper from the barrel'],
    ["import { serializeAllTables } from '../../db/backup';", 'the backup module'],
    ["import { findOrphanedRecords } from '../../db/orphanedRecords';", 'a storage helper'],
    ["import { datasetRepo } from '../../db/dataset';", 'the Dexie dataset implementation'],
  ])('rejects %s (%s) outside src/db', async (code) => {
    expect(await seamErrors(`${code}\nexport const x = 1;\n`, outside)).toBe(1);
  });

  it.each([
    ["import { getRepositories } from '../../db';", 'the seam itself'],
    ["import { MIGRATED_PAYMENT_NOTE } from '../../db/database';", 'a constant beside db'],
    ["import { startingProfileId } from '../../db/orphanedRecords';", 'a pure helper'],
    ["import type { BackupData } from '../../db/backup';", 'a type'],
    ["import { combineOwed } from '../../db/aggregations';", 'pure aggregations'],
  ])('allows %s (%s)', async (code) => {
    expect(await seamErrors(`${code}\nexport const x = 1;\n`, outside)).toBe(0);
  });

  it('does not apply inside src/db or to tests', async () => {
    const code = "import { db } from './database';\nexport const x = db;\n";
    expect(await seamErrors(code, 'src/db/SeamProbe.ts')).toBe(0);
    expect(await seamErrors("import { db } from '../../db';\nexport const x = db;\n", 'src/components/__tests__/SeamProbe.test.ts')).toBe(0);
  });
});
