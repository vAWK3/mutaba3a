import { describe, expect, it } from 'vitest';
import type { ExpenseRecord } from '../../repositories/ports.js';
import { planExpenseMove, type ExpenseMoveContext } from '../move-plan.js';

/** MUT-589 (ADR-254, D1): what a saved expense becomes on another profile, and the list of what changes. */
const AT = new Date('2026-11-11T09:00:00Z');

function expense(over: Partial<ExpenseRecord> = {}): ExpenseRecord {
  return {
    id: 'e1',
    organizationId: 'source',
    occurredOn: '2026-11-02',
    amountMinor: 11_700n,
    currency: 'ILS',
    title: 'Laptop stand',
    vendor: 'Office Depot',
    vendorId: 'v-source',
    categoryId: 'c-source',
    customerId: null,
    projectId: null,
    notes: 'for the desk',
    createdByUserId: 'u1',
    vatTreatment: null,
    vatRateBasisPoints: null,
    netMinor: null,
    vatMinor: null,
    allocationNumber: null,
    version: 3,
    createdAt: AT,
    updatedAt: AT,
    deletedAt: null,
    ...over,
  };
}

const cat = (id: string, name: string, archivedAt: Date | null = null) => ({ id, name, archivedAt });

function ctx(over: Partial<ExpenseMoveContext> = {}): ExpenseMoveContext {
  return {
    lang: 'en',
    sourceCategoryName: 'Office Supplies',
    targetCategories: [cat('t-rent', 'Rent'), cat('t-supplies', 'Office Supplies'), cat('t-other', 'Other')],
    targetFirm: false,
    targetVendorId: 'v-target',
    clientName: null,
    matterName: null,
    sourceGroups: [],
    targetGroups: [],
    ...over,
  };
}

describe('planExpenseMove (MUT-589, D1)', () => {
  it('maps the category by the same name, links the target vendor, and lists nothing when nothing a person sees changes', () => {
    const plan = planExpenseMove(expense(), ctx());
    expect(plan.patch).toMatchObject({ categoryId: 't-supplies', vendorId: 'v-target', customerId: null, projectId: null });
    expect(plan.changes).toEqual([]);
  });

  it('matches names in any letter case and spacing (the nameKey)', () => {
    const plan = planExpenseMove(expense(), ctx({ sourceCategoryName: '  office supplies ' }));
    expect(plan.patch.categoryId).toBe('t-supplies');
  });

  it('matches a seeded category across Arabic and English by its preset key (ADR-208)', () => {
    const plan = planExpenseMove(expense(), ctx({ sourceCategoryName: 'مستلزمات المكتب', targetCategories: [cat('t-supplies', 'Office Supplies'), cat('t-other', 'Other')] }));
    expect(plan.patch.categoryId).toBe('t-supplies');
    expect(plan.changes).toEqual([]);
  });

  it('falls back to the target\'s Other (in either language) and says so', () => {
    const plan = planExpenseMove(expense(), ctx({ sourceCategoryName: 'Court & Filing Fees', targetCategories: [cat('t-rent', 'Rent'), cat('t-other', 'أخرى')] }));
    expect(plan.patch.categoryId).toBe('t-other');
    expect(plan.changes).toEqual([{ field: 'category', from: 'Court & Filing Fees', to: 'Other' }]);
  });

  it('falls back to no category when the target has no Other', () => {
    const plan = planExpenseMove(expense(), ctx({ sourceCategoryName: 'Hobby', targetCategories: [cat('t-rent', 'Rent')] }));
    expect(plan.patch.categoryId).toBeNull();
    expect(plan.changes).toEqual([{ field: 'category', from: 'Hobby', to: null }]);
  });

  it('never maps to an archived target category', () => {
    const plan = planExpenseMove(expense(), ctx({ targetCategories: [cat('t-supplies', 'Office Supplies', AT), cat('t-other', 'Other')] }));
    expect(plan.patch.categoryId).toBe('t-other');
  });

  it('keeps an expense with no category without one, and lists no change', () => {
    const plan = planExpenseMove(expense({ categoryId: null }), ctx({ sourceCategoryName: null }));
    expect(plan.patch.categoryId).toBeNull();
    expect(plan.changes).toEqual([]);
  });

  it('shows names in the viewer\'s language', () => {
    const plan = planExpenseMove(expense(), ctx({ lang: 'ar', sourceCategoryName: 'Court & Filing Fees', targetCategories: [cat('t-other', 'Other')] }));
    expect(plan.changes).toEqual([{ field: 'category', from: 'رسوم المحاكم والتسجيل', to: 'أخرى' }]);
  });

  it('clears the client and the matter, which never cross profiles', () => {
    const plan = planExpenseMove(expense({ customerId: 'cust', projectId: 'proj' }), ctx({ clientName: 'Nour Legal', matterName: 'Lease review' }));
    expect(plan.patch).toMatchObject({ customerId: null, projectId: null });
    expect(plan.changes).toEqual([
      { field: 'client', from: 'Nour Legal', to: null },
      { field: 'matter', from: 'Lease review', to: null },
    ]);
  });

  it('unlinks the vendor when none resolves on the target, and keeps the typed vendor text', () => {
    const plan = planExpenseMove(expense(), ctx({ targetVendorId: null }));
    expect(plan.patch.vendorId).toBeNull();
    expect(plan.patch).not.toHaveProperty('vendor');
  });

  const vat = { vatTreatment: 'STANDARD_RATED' as const, vatRateBasisPoints: 1700, netMinor: 10_000n, vatMinor: 1_700n, allocationNumber: '123456789' };

  it('keeps VAT and the allocation number on a firm target', () => {
    const plan = planExpenseMove(expense(vat), ctx({ targetFirm: true }));
    expect(plan.patch).not.toHaveProperty('vatTreatment');
    expect(plan.patch).not.toHaveProperty('allocationNumber');
    expect(plan.changes).toEqual([]);
  });

  it('clears VAT and the allocation number on a non-firm target; the gross amount stays', () => {
    const plan = planExpenseMove(expense(vat), ctx({ targetFirm: false }));
    expect(plan.patch).toMatchObject({ vatTreatment: null, vatRateBasisPoints: null, netMinor: null, vatMinor: null, allocationNumber: null });
    expect(plan.patch).not.toHaveProperty('amountMinor');
    expect(plan.patch).not.toHaveProperty('currency');
    expect(plan.changes).toEqual([
      { field: 'vat', from: '17.00', to: null },
      { field: 'allocationNumber', from: '123456789', to: null },
    ]);
  });

  it('lists the groups it leaves and joins, by date on the target', () => {
    const plan = planExpenseMove(expense(), ctx({ sourceGroups: ['Trip to Amman', 'Q4'], targetGroups: [] }));
    expect(plan.changes).toEqual([{ field: 'groups', from: 'Q4, Trip to Amman', to: null }]);
    const same = planExpenseMove(expense(), ctx({ sourceGroups: ['Q4'], targetGroups: ['Q4'] }));
    expect(same.changes).toEqual([]);
  });

  it('lists every change in one fixed order: category, client, matter, VAT, allocation number, groups', () => {
    const plan = planExpenseMove(expense({ customerId: 'c', projectId: 'p', ...vat }), ctx({ sourceCategoryName: 'Hobby', targetCategories: [], clientName: 'A', matterName: 'B', sourceGroups: ['G'], targetGroups: ['H'] }));
    expect(plan.changes.map((c) => c.field)).toEqual(['category', 'client', 'matter', 'vat', 'allocationNumber', 'groups']);
    expect(plan.changes.at(-1)).toEqual({ field: 'groups', from: 'G', to: 'H' });
  });

  it('never touches the amount, currency, date, title or notes (ADR-004)', () => {
    const plan = planExpenseMove(expense({ customerId: 'c', ...vat }), ctx({ clientName: 'A' }));
    for (const field of ['amountMinor', 'currency', 'occurredOn', 'title', 'notes', 'vendor']) expect(plan.patch).not.toHaveProperty(field);
  });
});
