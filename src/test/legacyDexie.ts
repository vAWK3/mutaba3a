import Dexie from 'dexie';
import { MiniCrmDatabase } from '../db/database';

/**
 * Build an IndexedDB database exactly as an older build left it on disk, so a
 * migration test can open the current `MiniCrmDatabase` over it and watch
 * every later `upgrade()` run (MUT-24 §C).
 *
 * The schema at version N is the union of every `stores()` call up to N, which
 * is how Dexie itself reads the version history. The history lives in
 * `database.ts` and is append-only, so deriving it from the class (rather than
 * copying 24 schema blocks into tests) keeps the two from drifting.
 */

type DexieVersionInternals = { _cfg: { version: number; storesSource: Record<string, string | null> | null } };

export function schemaAt(version: number): Record<string, string> {
  const probe = new MiniCrmDatabase(`schema-probe-${version}`);
  const versions = (probe as unknown as { _versions: DexieVersionInternals[] })._versions
    .filter((v) => v._cfg.version <= version)
    .sort((a, b) => a._cfg.version - b._cfg.version);
  const merged: Record<string, string | null> = {};
  for (const v of versions) Object.assign(merged, v._cfg.storesSource ?? {});
  return Object.fromEntries(Object.entries(merged).filter((entry): entry is [string, string] => entry[1] !== null));
}

let counter = 0;

/** A fresh database name per test, so fake-indexeddb state never leaks between cases. */
export function uniqueDbName(prefix: string): string {
  return `${prefix}-${Date.now()}-${counter++}`;
}

/** Create a database at `version` holding `rows` (table → records), then close it. */
export async function createDatabaseAt(name: string, version: number, rows: Record<string, object[]>): Promise<void> {
  const legacy = new Dexie(name);
  legacy.version(version).stores(schemaAt(version));
  await legacy.open();
  for (const [table, records] of Object.entries(rows)) {
    await legacy.table(table).bulkAdd(records);
  }
  legacy.close();
}
