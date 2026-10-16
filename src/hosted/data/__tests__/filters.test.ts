import { describe, it, expect } from 'vitest';
import { omitShellOverlay, parseClientDetail, parseConversionsPage, parseIncomeDrawer, parsePaymentsPage, parseReceivablesPage, pickShellOverlay, splitIncomeDrawer } from '../filters';

const R = 'b1111111-1111-4111-8111-111111111111';

describe('income drawer URL state (MUT-133)', () => {
  it('accepts only received or owed for newIncome', () => {
    expect(parseIncomeDrawer({ newIncome: 'owed' })).toEqual({ newIncome: 'owed' });
    expect(parseIncomeDrawer({ newIncome: 'received' })).toEqual({ newIncome: 'received' });
    expect(parseIncomeDrawer({ newIncome: 'expense' })).toEqual({});
  });

  it('accepts only a uuid for settle', () => {
    expect(parseIncomeDrawer({ settle: R })).toEqual({ settle: R });
    expect(parseIncomeDrawer({ settle: 'nope' })).toEqual({});
  });

  it('parses drawer state beside each page\'s filters', () => {
    expect(parseReceivablesPage({ status: 'SETTLED', settle: R })).toEqual({ status: 'SETTLED', settle: R });
    expect(parsePaymentsPage({ status: 'POSTED', newIncome: 'received' })).toEqual({ status: 'POSTED', newIncome: 'received' });
    expect(parseClientDetail({ tab: 'receivables', settle: R })).toEqual({ tab: 'receivables', settle: R });
  });

  it('accepts only a uuid for the re-date drawers ?income= and ?payment= (MUT-224)', () => {
    expect(parseIncomeDrawer({ income: R })).toEqual({ income: R });
    expect(parseIncomeDrawer({ payment: R })).toEqual({ payment: R });
    expect(parseIncomeDrawer({ income: 'nope', payment: '1' })).toEqual({});
    expect(parseReceivablesPage({ status: 'ALL', income: R })).toEqual({ status: 'ALL', income: R });
    expect(parsePaymentsPage({ status: 'POSTED', payment: R })).toEqual({ status: 'POSTED', payment: R });
    expect(parseClientDetail({ tab: 'payments', payment: R })).toEqual({ tab: 'payments', payment: R });
  });

  it('splits the re-date drawers out with the others (MUT-224)', () => {
    const { filters, drawer } = splitIncomeDrawer({ status: 'OPEN' as const, income: R, payment: R });
    expect(filters).toEqual({ status: 'OPEN' });
    expect(drawer).toEqual({ income: R, payment: R });
  });

  it('splits drawer state out so a list never receives it (eng review R1)', () => {
    const { filters, drawer } = splitIncomeDrawer({ status: 'OPEN' as const, customerId: 'x', newIncome: 'owed' as const, settle: R });
    expect(filters).toEqual({ status: 'OPEN', customerId: 'x' });
    expect(drawer).toEqual({ newIncome: 'owed', settle: R });
  });
});

describe('conversions page URL state (MUT-194)', () => {
  const ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

  it('keeps a uuid ?conversion=<id> to edit, and drops a malformed one', () => {
    expect(parseConversionsPage({ conversion: ID })).toEqual({ conversion: ID });
    expect(parseConversionsPage({ conversion: 'not-an-id' })).toEqual({});
  });

  it('keeps the create flag beside it', () => {
    expect(parseConversionsPage({ newConversion: '1' })).toEqual({ newConversion: true });
  });

  it('keeps a JOD currency filter (D7, TD-117)', () => {
    expect(parseConversionsPage({ currency: 'JOD' })).toEqual({ currency: 'JOD' });
    expect(parseConversionsPage({ currency: 'GBP' })).toEqual({});
  });

});

describe('shell overlay keys (MUT-183 R1)', () => {
  it('drops the profile drawers\' keys and keeps every other key', () => {
    const search = { status: 'OPEN', customerId: 'x', settle: R, newProfile: 1, manageProfiles: '1', editProfile: R };
    expect(omitShellOverlay(search)).toEqual({ status: 'OPEN', customerId: 'x', settle: R });
  });

  it('returns the same keys when there is nothing to drop', () => {
    expect(omitShellOverlay({ tab: 'receivables' })).toEqual({ tab: 'receivables' });
  });

  it('pickShellOverlay keeps only the drawer keys, dropping page filters', () => {
    const search = { status: 'OPEN', customerId: 'x', newProfile: 1, manageProfiles: '1', editProfile: R };
    expect(pickShellOverlay(search)).toEqual({ newProfile: 1, manageProfiles: '1', editProfile: R });
  });

  it('pickShellOverlay returns nothing when no drawer is open', () => {
    expect(pickShellOverlay({ tab: 'receivables' })).toEqual({});
  });

  it('a page search rewrite carries an open drawer forward (router.tsx useReplaceSearch, review finding)', () => {
    // Regression: useReplaceSearch used to replace the whole URL search, so a
    // background setFilters() call (e.g. a stale-anchor refetch) silently
    // closed whatever profile drawer the shell had open. The fix merges the
    // shell's own keys back in — this is that merge, exercised directly.
    const prev = { status: 'OPEN', customerId: 'x', manageProfiles: '1' };
    const next = { status: 'PAID', customerId: 'x' };
    expect({ ...pickShellOverlay(prev), ...next }).toEqual({ status: 'PAID', customerId: 'x', manageProfiles: '1' });
  });

  it('carries the account menu\'s Change password drawer the same way (MUT-237)', () => {
    const search = { status: 'OPEN', changePassword: 'true' };
    expect(omitShellOverlay(search)).toEqual({ status: 'OPEN' });
    expect(pickShellOverlay(search)).toEqual({ changePassword: 'true' });
  });
});
