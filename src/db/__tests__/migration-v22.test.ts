import { describe, it, expect, afterEach, vi } from 'vitest';
import Dexie from 'dexie';
import { MiniCrmDatabase } from '../database';

/**
 * MUT-88 (ADR-072): v22 changes no schema. It repairs devices that already
 * hold two default businesses (the demo-seed race), so the one-default rule
 * holds for data written before the rule existed. A real profile outranks a
 * `demo_` sample one.
 */

let counter = 0;
const uniqueName = () => `mutaba3a-v22-test-${Date.now()}-${counter++}`;
const opened: Dexie[] = [];

/** v22 adds no stores, so the current schema is exactly what a v21 build left on disk. */
function currentSchema(): Record<string, string> {
  const probe = new MiniCrmDatabase(uniqueName());
  return Object.fromEntries(
    probe.tables.map((t) => [t.name, [t.schema.primKey.src, ...t.schema.indexes.map((i) => i.src)].join(', ')])
  );
}

const T1 = '2026-01-01T00:00:00.000Z';
const T2 = '2026-06-01T00:00:00.000Z';

async function createV21Database(name: string, profiles: object[]): Promise<void> {
  const v21 = new Dexie(name);
  v21.version(21).stores(currentSchema());
  await v21.open();
  await v21.table('businessProfiles').bulkAdd(profiles);
  v21.close();
}

async function openCurrent(name: string): Promise<MiniCrmDatabase> {
  const current = new MiniCrmDatabase(name);
  opened.push(current);
  await current.open();
  return current;
}

afterEach(async () => {
  for (const d of opened.splice(0)) {
    d.close();
    await Dexie.delete(d.name);
  }
  vi.restoreAllMocks();
});

describe('Migration v22: exactly one default business (MUT-88)', () => {
  it('a v21 database with a sample default and a real default keeps only the real one', async () => {
    const name = uniqueName();
    await createV21Database(name, [
      { id: 'demo_business_profile_1', name: 'Advanced Tech Solutions', isDefault: true, createdAt: T1 },
      { id: 'mine', name: 'Default Profile', isDefault: true, createdAt: T2 },
    ]);

    const upgraded = await openCurrent(name);

    expect(upgraded.verno).toBe(24);
    const defaults = (await upgraded.businessProfiles.toArray()).filter((p) => p.isDefault).map((p) => p.id);
    expect(defaults).toEqual(['mine']);
  });

  it('leaves a database that already has one default exactly as it was', async () => {
    const name = uniqueName();
    const rows = [
      { id: 'a', name: 'A', isDefault: false, createdAt: T1, updatedAt: T1 },
      { id: 'b', name: 'B', isDefault: true, createdAt: T2, updatedAt: T2 },
    ];
    await createV21Database(name, rows);

    const upgraded = await openCurrent(name);

    expect(await upgraded.businessProfiles.orderBy('id').toArray()).toEqual(rows);
  });

  it('opens an empty v21 database without an error', async () => {
    const errors = vi.spyOn(console, 'error');
    const name = uniqueName();
    await createV21Database(name, []);

    const upgraded = await openCurrent(name);

    expect(upgraded.verno).toBe(24);
    expect(errors).not.toHaveBeenCalled();
  });
});
