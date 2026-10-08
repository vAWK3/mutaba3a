import { describe, expect, it } from 'vitest';
import { IMPORT_MAX_ROWS, planImport, type ImportRow, type ImportState } from '../plan.js';

const customer = (id: string, name: string, status: 'ACTIVE' | 'ARCHIVED' = 'ACTIVE') => ({ id, name, status });
const project = (id: string, name: string, customerId: string, currency: string, status: 'ACTIVE' | 'ARCHIVED' = 'ACTIVE') => ({
  id,
  name,
  customerId,
  currency,
  status,
});

function state(partial: Partial<ImportState> = {}): ImportState {
  return { customersByExternalId: new Map(), projectsByExternalId: new Map(), ...partial };
}

describe('planImport', () => {
  it('creates unknown customers and projects, resolving a project customer from the same batch', () => {
    const rows: ImportRow[] = [
      { entityType: 'CUSTOMER', externalId: 'c1', name: 'Acme' },
      { entityType: 'PROJECT', externalId: 'p1', name: 'Case 1', currency: 'ILS', customerExternalId: 'c1' },
    ];
    const plan = planImport(rows, state());
    expect(plan.map((r) => [r.index, r.action])).toEqual([
      [0, 'create'],
      [1, 'create'],
    ]);
    expect(plan[1]).toMatchObject({ entityType: 'PROJECT', externalId: 'p1', customer: { kind: 'batch', externalId: 'c1' } });
  });

  it('links already-known external ids and warns when the name differs, never overwriting', () => {
    const plan = planImport(
      [{ entityType: 'CUSTOMER', externalId: 'c1', name: 'Acme Ltd' }],
      state({ customersByExternalId: new Map([['c1', customer('cust-1', 'Acme')]]) }),
    );
    expect(plan[0]).toMatchObject({ action: 'link', existingId: 'cust-1', warnings: ['NAME_DIFFERS'] });
  });

  it('flags a project whose customer is in neither the organization nor the batch', () => {
    const plan = planImport([{ entityType: 'PROJECT', externalId: 'p1', name: 'Case', currency: 'ILS', customerExternalId: 'ghost' }], state());
    expect(plan[0]).toMatchObject({ action: 'conflict', reason: 'UNKNOWN_CUSTOMER' });
  });

  it('flags a project whose batch customer is itself a conflict', () => {
    const plan = planImport(
      [
        { entityType: 'CUSTOMER', externalId: 'c1', name: '   ' },
        { entityType: 'PROJECT', externalId: 'p1', name: 'Case', currency: 'ILS', customerExternalId: 'c1' },
      ],
      state(),
    );
    expect(plan[0]).toMatchObject({ action: 'conflict', reason: 'VALIDATION' });
    expect(plan[1]).toMatchObject({ action: 'conflict', reason: 'UNKNOWN_CUSTOMER' });
  });

  it('flags a linked project that belongs to a different customer', () => {
    const plan = planImport(
      [{ entityType: 'PROJECT', externalId: 'p1', name: 'Case', currency: 'ILS', customerExternalId: 'c2' }],
      state({
        customersByExternalId: new Map([
          ['c1', customer('cust-1', 'A')],
          ['c2', customer('cust-2', 'B')],
        ]),
        projectsByExternalId: new Map([['p1', project('proj-1', 'Case', 'cust-1', 'ILS')]]),
      }),
    );
    expect(plan[0]).toMatchObject({ action: 'conflict', reason: 'CUSTOMER_MISMATCH', existingId: 'proj-1' });
  });

  it('flags a linked project whose currency differs: currency changes go through PATCH', () => {
    const plan = planImport(
      [{ entityType: 'PROJECT', externalId: 'p1', name: 'Case', currency: 'USD', customerExternalId: 'c1' }],
      state({
        customersByExternalId: new Map([['c1', customer('cust-1', 'A')]]),
        projectsByExternalId: new Map([['p1', project('proj-1', 'Case', 'cust-1', 'ILS')]]),
      }),
    );
    expect(plan[0]).toMatchObject({ action: 'conflict', reason: 'CURRENCY_DIFFERS' });
  });

  it('links a linked project with matching customer and currency, warning when archived', () => {
    const plan = planImport(
      [{ entityType: 'PROJECT', externalId: 'p1', name: 'Case', currency: 'ILS', customerExternalId: 'c1' }],
      state({
        customersByExternalId: new Map([['c1', customer('cust-1', 'A')]]),
        projectsByExternalId: new Map([['p1', project('proj-1', 'Case', 'cust-1', 'ILS', 'ARCHIVED')]]),
      }),
    );
    expect(plan[0]).toMatchObject({ action: 'link', existingId: 'proj-1', warnings: ['ARCHIVED'] });
  });

  it('rejects unsupported currencies, blank names and duplicate external ids within the batch as VALIDATION', () => {
    const plan = planImport(
      [
        { entityType: 'CUSTOMER', externalId: 'c1', name: 'Acme' },
        { entityType: 'CUSTOMER', externalId: 'c1', name: 'Acme again' },
        { entityType: 'PROJECT', externalId: 'p1', name: 'Case', currency: 'GBP', customerExternalId: 'c1' },
        { entityType: 'PROJECT', externalId: 'c1', name: 'Same id as a customer is fine', currency: 'ILS', customerExternalId: 'c1' },
      ],
      state(),
    );
    expect(plan[0]).toMatchObject({ action: 'create' });
    expect(plan[1]).toMatchObject({ action: 'conflict', reason: 'VALIDATION', detail: 'DUPLICATE_IN_BATCH' });
    expect(plan[2]).toMatchObject({ action: 'conflict', reason: 'VALIDATION', detail: 'UNSUPPORTED_CURRENCY' });
    expect(plan[3]).toMatchObject({ action: 'create' });
  });

  it('keeps input order and caps the batch', () => {
    const rows: ImportRow[] = Array.from({ length: IMPORT_MAX_ROWS + 1 }, (_, i) => ({ entityType: 'CUSTOMER', externalId: `c${i}`, name: `N${i}` }));
    expect(() => planImport(rows, state())).toThrow(/rows/);
    const plan = planImport(rows.slice(0, 3).reverse(), state());
    expect(plan.map((r) => r.externalId)).toEqual(['c2', 'c1', 'c0']);
  });
});
