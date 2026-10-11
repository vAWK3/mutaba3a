import { describe, it, expect } from 'vitest';
import {
  buildIncomeCreate,
  buildIncomeUpdate,
  shouldExpandDetails,
  resolveDefaultCurrency,
  isBelowRecordedTotal,
  type IncomeEntryValues,
} from '../incomeEntry';

const NOW = '2026-10-11T09:30:00.000Z';
const EARLIER = '2026-09-01T12:00:00.000Z';

function values(overrides: Partial<IncomeEntryValues> = {}): IncomeEntryValues {
  return {
    incomeStatus: 'earned',
    profileId: 'p1',
    amountMinor: 120000,
    currency: 'USD',
    occurredAt: '2026-10-11',
    clientId: 'c1',
    projectId: '',
    dueDate: '',
    title: 'Logo redesign',
    notes: '',
    ...overrides,
  };
}

describe('buildIncomeCreate / buildIncomeUpdate', () => {
  describe('create', () => {
    it.each(['earned', 'invoiced'] as const)('%s is unpaid and carries no payment fields', (incomeStatus) => {
      const write = buildIncomeCreate(values({ incomeStatus }), NOW);
      expect(write.status).toBe('unpaid');
      expect('paidAt' in write).toBe(false);
      expect('receivedAmountMinor' in write).toBe(false);
    });

    it('received is paid now, in full', () => {
      const write = buildIncomeCreate(values({ incomeStatus: 'received' }), NOW);
      expect(write.status).toBe('paid');
      expect(write.paidAt).toBe(NOW);
      expect(write.receivedAmountMinor).toBe(120000);
    });

    it('maps the entry fields and leaves empty optionals unset', () => {
      const write = buildIncomeCreate(values(), NOW);
      expect(write).toMatchObject({
        kind: 'income',
        profileId: 'p1',
        title: 'Logo redesign',
        clientId: 'c1',
        amountMinor: 120000,
        currency: 'USD',
        occurredAt: new Date('2026-10-11').toISOString(),
      });
      expect(write.projectId).toBeUndefined();
      expect(write.notes).toBeUndefined();
      expect(write.dueDate).toBeUndefined();
    });

    it('keeps the due date for unpaid income and drops it for received', () => {
      expect(buildIncomeCreate(values({ dueDate: '2026-11-01' }), NOW).dueDate).toBe('2026-11-01');
      expect(
        buildIncomeCreate(values({ incomeStatus: 'received', dueDate: '2026-11-01' }), NOW).dueDate
      ).toBeUndefined();
    });
  });

  describe('edit without payment records', () => {
    it('paid → paid keeps the original payment date', () => {
      const write = buildIncomeUpdate(values({ incomeStatus: 'received', title: 'Retitled' }), {
        now: NOW,
        existing: { status: 'paid', paidAt: EARLIER },
        hasRecords: false,
      });
      expect(write.status).toBe('paid');
      expect(write.paidAt).toBe(EARLIER);
      expect(write.receivedAmountMinor).toBe(120000);
    });

    it('paid → paid with no recorded paidAt falls back to now', () => {
      const write = buildIncomeUpdate(values({ incomeStatus: 'received' }), {
        now: NOW,
        existing: { status: 'paid' },
        hasRecords: false,
      });
      expect(write.paidAt).toBe(NOW);
    });

    it('unpaid → unpaid leaves the payment fields out of the write entirely', () => {
      const write = buildIncomeUpdate(values({ incomeStatus: 'invoiced' }), {
        now: NOW,
        existing: { status: 'unpaid' },
        hasRecords: false,
      });
      expect(write.status).toBe('unpaid');
      // absent, not undefined: Dexie deletes keys whose value is undefined
      expect('paidAt' in write).toBe(false);
      expect('receivedAmountMinor' in write).toBe(false);
    });

    it('unpaid → paid is paid now, in full', () => {
      const write = buildIncomeUpdate(values({ incomeStatus: 'received' }), {
        now: NOW,
        existing: { status: 'unpaid' },
        hasRecords: false,
      });
      expect(write.status).toBe('paid');
      expect(write.paidAt).toBe(NOW);
      expect(write.receivedAmountMinor).toBe(120000);
    });

    it('paid → unpaid clears the payment fields', () => {
      const write = buildIncomeUpdate(values({ incomeStatus: 'invoiced' }), {
        now: NOW,
        existing: { status: 'paid', paidAt: EARLIER },
        hasRecords: false,
      });
      expect(write.status).toBe('unpaid');
      expect('paidAt' in write).toBe(true);
      expect(write.paidAt).toBeUndefined();
      expect('receivedAmountMinor' in write).toBe(true);
      expect(write.receivedAmountMinor).toBeUndefined();
    });
  });

  describe('edit with payment records', () => {
    it.each([
      ['paid', 'received'],
      ['unpaid', 'invoiced'],
      ['unpaid', 'received'],
      ['paid', 'earned'],
    ] as const)('existing %s, form %s: the records own status, paidAt and received', (status, incomeStatus) => {
      const write = buildIncomeUpdate(values({ incomeStatus }), {
        now: NOW,
        existing: { status, paidAt: EARLIER },
        hasRecords: true,
      });
      expect('status' in write).toBe(false);
      expect('paidAt' in write).toBe(false);
      expect('receivedAmountMinor' in write).toBe(false);
      expect(write.amountMinor).toBe(120000);
      expect(write.title).toBe('Logo redesign');
    });
  });
});

describe('isBelowRecordedTotal', () => {
  it('is true when the amount is below what the records add up to', () => {
    expect(isBelowRecordedTotal(40000, [{ amountMinor: 30000 }, { amountMinor: 20000 }])).toBe(true);
  });

  it('is false at exactly the recorded total', () => {
    expect(isBelowRecordedTotal(50000, [{ amountMinor: 30000 }, { amountMinor: 20000 }])).toBe(false);
  });

  it('is false with no records', () => {
    expect(isBelowRecordedTotal(1, [])).toBe(false);
  });
});

describe('shouldExpandDetails', () => {
  const plain = { currency: 'USD' as const, profileId: 'p1' };

  it('stays collapsed for an entry that only has the core fields and the profile currency', () => {
    expect(shouldExpandDetails(plain, 'USD')).toBe(false);
  });

  it.each([
    ['notes', { notes: 'Phase 1' }],
    ['a due date', { dueDate: '2026-11-01' }],
    ['a project', { projectId: 'pr1' }],
    ['a currency other than the profile default', { currency: 'ILS' as const }],
    ['no profile', { profileId: undefined }],
  ])('expands for %s', (_label, overrides) => {
    expect(shouldExpandDetails({ ...plain, ...overrides }, 'USD')).toBe(true);
  });

  it('does not treat an empty string as a value', () => {
    expect(shouldExpandDetails({ ...plain, notes: '', dueDate: '', projectId: '' }, 'USD')).toBe(false);
  });
});

describe('resolveDefaultCurrency', () => {
  it('uses the profile default first', () => {
    expect(resolveDefaultCurrency({ defaultCurrency: 'ILS' }, { defaultCurrency: 'EUR' })).toBe('ILS');
  });

  it('falls back to the settings default', () => {
    expect(resolveDefaultCurrency(undefined, { defaultCurrency: 'EUR' })).toBe('EUR');
  });

  it('falls back to the app default', () => {
    expect(resolveDefaultCurrency(undefined, undefined)).toBe('USD');
  });
});
