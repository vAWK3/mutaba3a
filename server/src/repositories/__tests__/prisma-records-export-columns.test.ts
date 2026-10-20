import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { EXPORT_COLUMNS } from '../prisma-records-export.js';

/**
 * MUT-325: the export's selects are typed against the record types (`Columns<R>`), but Prisma can't check a select
 * passed through the shared delegate. This holds every selected column to the schema, without a database, so a
 * renamed column fails here rather than in a person's download.
 */
describe('records export columns', () => {
  const models = new Map(Prisma.dmmf.datamodel.models.map((m) => [m.name, new Set(m.fields.filter((f) => f.kind !== 'object').map((f) => f.name))]));

  it.each(EXPORT_COLUMNS.map((c) => [c.model, c.select] as const))('%s: every selected column exists', (model, select) => {
    const columns = models.get(model);
    expect(columns, `no model ${model}`).toBeDefined();
    expect(Object.keys(select).filter((key) => !columns!.has(key))).toEqual([]);
  });
});
