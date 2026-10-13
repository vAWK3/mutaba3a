import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { db } from '../../db/database';
import { businessProfileRepo, clientRepo, transactionRepo, paymentRecordRepo } from '../../db/repository';
import {
  useTransaction,
  useClient,
  useClientSummary,
  useProject,
  useProjectSummary,
  useBusinessProfiles,
  useBusinessProfile,
  useDefaultBusinessProfile,
  useCreateBusinessProfile,
  useUpdateBusinessProfile,
  useSetDefaultBusinessProfile,
  useArchiveBusinessProfile,
  useCreatePaymentRecord,
  useUpdatePaymentRecord,
  useDeletePaymentRecord,
  useRecordPartialPayment,
  useMarkTransactionPaid,
  usePaymentsByClient,
  useRecentPayments,
  useCreateTransaction,
  useUpdateTransaction,
  useCreateReceivedIncome,
} from '../useQueries';
import { useIncome, useReceivables } from '../useIncomeQueries';
import type { BusinessProfile } from '../../types';

// Create a test query client
function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

// Create wrapper with query client
function createWrapper(queryClient: QueryClient = createTestQueryClient()) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };
}

describe('Business Profile Hooks', () => {
  beforeEach(async () => {
    await db.businessProfiles.clear();
  });

  afterEach(async () => {
    await db.businessProfiles.clear();
  });

  const createTestProfile = (): Omit<BusinessProfile, 'id' | 'createdAt' | 'updatedAt'> => ({
    name: 'Test Company',
    nameEn: 'Test Company EN',
    email: 'test@example.com',
    phone: '+972501234567',
    taxId: '123456789',
    businessType: 'company',
    address1: 'Test Address',
    city: 'Test City',
    country: 'Test Country',
    postalCode: '12345',
    defaultCurrency: 'USD',
    defaultLanguage: 'en',
    isDefault: false,
  });

  describe('useBusinessProfiles', () => {
    it('should return empty array when no profiles exist', async () => {
      const { result } = renderHook(() => useBusinessProfiles(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual([]);
    });

    it('should return profiles when they exist', async () => {
      await businessProfileRepo.create(createTestProfile());
      await businessProfileRepo.create({ ...createTestProfile(), name: 'Second Company' });

      const { result } = renderHook(() => useBusinessProfiles(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toHaveLength(2);
    });
  });

  describe('useBusinessProfile', () => {
    it('should return a specific profile by id', async () => {
      const created = await businessProfileRepo.create(createTestProfile());

      const { result } = renderHook(() => useBusinessProfile(created.id), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.id).toBe(created.id);
      expect(result.current.data?.name).toBe('Test Company');
    });

    it('should not fetch when id is empty', async () => {
      const { result } = renderHook(() => useBusinessProfile(''), {
        wrapper: createWrapper(),
      });

      // Should not be loading or fetching
      expect(result.current.isFetching).toBe(false);
    });
  });

  describe('useDefaultBusinessProfile', () => {
    // TanStack Query v5 treats a queryFn that resolves to `undefined` as a
    // failure: the query lands in `error` state and logs "Query data cannot be
    // undefined". A fresh install has no profile at all, so the hook must
    // normalise "no default" to `null` and succeed.
    it('resolves to null with no console error on a fresh install (no profiles)', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const { result } = renderHook(() => useDefaultBusinessProfile(), {
          wrapper: createWrapper(),
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toBeNull();
        expect(result.current.isError).toBe(false);
        expect(consoleError).not.toHaveBeenCalled();
      } finally {
        consoleError.mockRestore();
      }
    });

    // While any active business exists, one is the default (MUT-88,
    // ADR-072): the data layer enforces this on every write, so the lone
    // profile created here becomes the default even though isDefault was
    // never set on it.
    it('makes the lone profile the default, even when isDefault was never set', async () => {
      const created = await businessProfileRepo.create(createTestProfile());

      const { result } = renderHook(() => useDefaultBusinessProfile(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.id).toBe(created.id);
    });

    it('should return the default profile', async () => {
      await businessProfileRepo.create({ ...createTestProfile(), isDefault: true });

      const { result } = renderHook(() => useDefaultBusinessProfile(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.isDefault).toBe(true);
    });
  });

  describe('useCreateBusinessProfile', () => {
    it('should create a new profile', async () => {
      const { result } = renderHook(() => useCreateBusinessProfile(), {
        wrapper: createWrapper(),
      });

      await result.current.mutateAsync(createTestProfile());

      const profiles = await businessProfileRepo.list();
      expect(profiles).toHaveLength(1);
      expect(profiles[0].name).toBe('Test Company');
    });
  });

  describe('useUpdateBusinessProfile', () => {
    it('should update an existing profile', async () => {
      const created = await businessProfileRepo.create(createTestProfile());

      const { result } = renderHook(() => useUpdateBusinessProfile(), {
        wrapper: createWrapper(),
      });

      await result.current.mutateAsync({
        id: created.id,
        data: { name: 'Updated Name' },
      });

      const updated = await businessProfileRepo.get(created.id);
      expect(updated?.name).toBe('Updated Name');
    });
  });

  describe('useSetDefaultBusinessProfile', () => {
    it('should set a profile as default', async () => {
      const profile = await businessProfileRepo.create(createTestProfile());

      const { result } = renderHook(() => useSetDefaultBusinessProfile(), {
        wrapper: createWrapper(),
      });

      await result.current.mutateAsync(profile.id);

      const updated = await businessProfileRepo.get(profile.id);
      expect(updated?.isDefault).toBe(true);
    });
  });

  describe('useArchiveBusinessProfile', () => {
    it('should archive a profile', async () => {
      const profile = await businessProfileRepo.create(createTestProfile());

      const { result } = renderHook(() => useArchiveBusinessProfile(), {
        wrapper: createWrapper(),
      });

      await result.current.mutateAsync(profile.id);

      const archived = await businessProfileRepo.get(profile.id);
      expect(archived?.archivedAt).toBeDefined();
    });
  });
});

describe('Payment Record Hooks', () => {
  beforeEach(async () => {
    await db.transactions.clear();
    await db.paymentRecords.clear();
  });

  afterEach(async () => {
    await db.transactions.clear();
    await db.paymentRecords.clear();
  });

  describe('useCreatePaymentRecord', () => {
    it('should invalidate the income and receivable lists, not just the transaction keys', async () => {
      const tx = await transactionRepo.create({
        kind: 'income',
        status: 'unpaid',
        amountMinor: 10000,
        currency: 'USD',
        occurredAt: '2026-03-01',
      });

      const queryClient = createTestQueryClient();
      const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useCreatePaymentRecord(), {
        wrapper: createWrapper(queryClient),
      });

      await result.current.mutateAsync({
        transactionId: tx.id,
        amountMinor: 4000,
        paidAt: '2026-03-02',
      });

      await waitFor(() => {
        expect(invalidateQueries).toHaveBeenCalled();
      });

      const invalidated = invalidateQueries.mock.calls.map(
        ([arg]) => (arg as { queryKey: unknown[] }).queryKey[0]
      );

      expect(invalidated).toEqual(
        expect.arrayContaining([
          'income',
          'receivables',
          'incomeOverviewTotals',
          'incomeAttentionReceivables',
          'paymentRecords',
          'transactions',
          'clientSummary',
        ])
      );

      // MUT-58: nothing reads the money-event keys since Home's forecast strip
      // and guidance feed were deleted (ADR-036), so a payment no longer
      // refreshes them.
      expect(invalidated.filter((key) => String(key).startsWith('money'))).toEqual([]);
    });

    it('should record the payment it invalidates for', async () => {
      const tx = await transactionRepo.create({
        kind: 'income',
        status: 'unpaid',
        amountMinor: 10000,
        currency: 'USD',
        occurredAt: '2026-03-01',
      });

      const { result } = renderHook(() => useCreatePaymentRecord(), {
        wrapper: createWrapper(),
      });

      await result.current.mutateAsync({
        transactionId: tx.id,
        amountMinor: 10000,
        paidAt: '2026-03-02',
      });

      const updated = await transactionRepo.get(tx.id);
      expect(updated?.receivedAmountMinor).toBe(10000);
      expect(updated?.status).toBe('paid');
    });
  });

  /**
   * MUT-3: Mark paid writes a PaymentRecord, but used to invalidate only the
   * transaction keys, so the client profile's Payments section kept showing
   * the pre-payment history until the 60s staleTime ran out.
   */
  describe('useMarkTransactionPaid', () => {
    it('refreshes the client payment history it just wrote to', async () => {
      const client = await clientRepo.create({ name: 'Acme' });
      const tx = await transactionRepo.create({
        kind: 'income',
        status: 'unpaid',
        title: 'Homepage',
        amountMinor: 10000,
        currency: 'USD',
        occurredAt: '2026-03-01',
        clientId: client.id,
      });

      const queryClient = createTestQueryClient();
      const { result } = renderHook(
        () => ({ payments: usePaymentsByClient(client.id), markPaid: useMarkTransactionPaid() }),
        { wrapper: createWrapper(queryClient) }
      );

      await waitFor(() => expect(result.current.payments.data).toEqual([]));

      await result.current.markPaid.mutateAsync(tx.id);

      await waitFor(() => {
        expect(result.current.payments.data).toHaveLength(1);
      });
      expect(result.current.payments.data?.[0]).toMatchObject({
        transactionTitle: 'Homepage',
        amountMinor: 10000,
        source: 'record',
      });
    });
  });

  /** MUT-8: Home's Recent payments shares the ['paymentRecords'] prefix. */
  describe('useRecentPayments', () => {
    it('shows a payment as soon as Mark paid records it', async () => {
      const client = await clientRepo.create({ name: 'Acme' });
      const tx = await transactionRepo.create({
        kind: 'income',
        status: 'unpaid',
        title: 'Logo',
        amountMinor: 5000,
        currency: 'ILS',
        occurredAt: '2026-03-01',
        clientId: client.id,
      });

      const { result } = renderHook(
        () => ({ recent: useRecentPayments(), markPaid: useMarkTransactionPaid() }),
        { wrapper: createWrapper(createTestQueryClient()) }
      );
      await waitFor(() => expect(result.current.recent.data).toEqual([]));

      await result.current.markPaid.mutateAsync(tx.id);

      await waitFor(() => expect(result.current.recent.data).toHaveLength(1));
      expect(result.current.recent.data?.[0]).toMatchObject({ clientName: 'Acme', transactionTitle: 'Logo', currency: 'ILS' });
    });
  });

  /**
   * MUT-73: these hooks wrote through a device-sync decorator. Device sync is
   * retired (ADR-053) and they now call the base repository; each still writes
   * exactly what the repository writes.
   */
  describe('payment writes that used to go through the sync decorator', () => {
    const owed = () =>
      transactionRepo.create({
        kind: 'income',
        status: 'unpaid',
        amountMinor: 10000,
        currency: 'USD',
        occurredAt: '2026-03-01',
      });

    it('useRecordPartialPayment records the payment and the received total', async () => {
      const tx = await owed();
      const { result } = renderHook(() => useRecordPartialPayment(), { wrapper: createWrapper() });

      await result.current.mutateAsync({ id: tx.id, paymentAmountMinor: 4000 });

      const updated = await transactionRepo.get(tx.id);
      expect(updated).toMatchObject({ status: 'unpaid', receivedAmountMinor: 4000 });
      const records = await paymentRecordRepo.listByTransaction(tx.id);
      expect(records.map((r) => r.amountMinor)).toEqual([4000]);
    });

    it('useUpdatePaymentRecord changes the amount and re-derives the entry', async () => {
      const tx = await owed();
      const record = await paymentRecordRepo.create({ transactionId: tx.id, amountMinor: 4000, paidAt: '2026-03-02' });
      const { result } = renderHook(() => useUpdatePaymentRecord(), { wrapper: createWrapper() });

      await result.current.mutateAsync({ id: record.id, transactionId: tx.id, data: { amountMinor: 10000 } });

      expect(await transactionRepo.get(tx.id)).toMatchObject({ status: 'paid', receivedAmountMinor: 10000 });
    });

    it('useDeletePaymentRecord removes the payment and the entry is owed again', async () => {
      const tx = await owed();
      const record = await paymentRecordRepo.create({ transactionId: tx.id, amountMinor: 10000, paidAt: '2026-03-02' });
      expect((await transactionRepo.get(tx.id))?.status).toBe('paid');
      const { result } = renderHook(() => useDeletePaymentRecord(), { wrapper: createWrapper() });

      await result.current.mutateAsync({ id: record.id, transactionId: tx.id });

      expect(await transactionRepo.get(tx.id)).toMatchObject({ status: 'unpaid', receivedAmountMinor: 0 });
      expect(await paymentRecordRepo.listByTransaction(tx.id)).toEqual([]);
    });
  });
});

// TD-028: every by-id hook wraps a repository `get(id)` whose contract is
// `Promise<Entity | undefined>`. TanStack Query v5 rejects `undefined` as
// query data (the query lands in `error` state and logs "Query data cannot be
// undefined"), so a deep link to a deleted row must resolve to `null` instead.
// These run against real Dexie with an id that was never written.
describe('By-id hooks resolve null for a missing row', () => {
  const MISSING_ID = 'missing-row-id';

  async function expectResolvesNull<T>(useHook: () => { isSuccess: boolean; isError: boolean; data: T }) {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { result } = renderHook(useHook, { wrapper: createWrapper() });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toBeNull();
      expect(result.current.isError).toBe(false);
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  }

  it('useTransaction resolves to null, no console error', async () => {
    await expectResolvesNull(() => useTransaction(MISSING_ID));
  });

  it('useClient resolves to null, no console error', async () => {
    await expectResolvesNull(() => useClient(MISSING_ID));
  });

  it('useProject resolves to null, no console error', async () => {
    await expectResolvesNull(() => useProject(MISSING_ID));
  });


  it('useBusinessProfile resolves to null, no console error', async () => {
    await expectResolvesNull(() => useBusinessProfile(MISSING_ID));
  });

  // The summaries resolve `undefined` when their parent client/project is gone.
  it('useClientSummary resolves to null, no console error', async () => {
    await expectResolvesNull(() => useClientSummary(MISSING_ID));
  });

  it('useProjectSummary resolves to null, no console error', async () => {
    await expectResolvesNull(() => useProjectSummary(MISSING_ID));
  });
});

// MUT-5: the income drawer saves through useCreateTransaction / useUpdateTransaction,
// while the client profile and /income read useIncome / useReceivables. A save
// must refresh both, or the entry the user just logged doesn't appear.
describe('transaction writes refresh the income lists (MUT-5)', () => {
  beforeEach(async () => {
    await db.transactions.clear();
  });

  afterEach(async () => {
    await db.transactions.clear();
  });

  function useIncomeLists() {
    return {
      income: useIncome({}),
      receivables: useReceivables({}),
      create: useCreateTransaction(),
      update: useUpdateTransaction(),
    };
  }

  it('a create shows up in useIncome and useReceivables', async () => {
    const { result } = renderHook(useIncomeLists, { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.income.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.receivables.isSuccess).toBe(true));
    expect(result.current.income.data).toHaveLength(0);

    await act(async () => {
      await result.current.create.mutateAsync({
        kind: 'income',
        status: 'unpaid',
        amountMinor: 120000,
        currency: 'USD',
        occurredAt: '2026-10-11',
        title: 'Logo redesign',
      });
    });

    await waitFor(() => expect(result.current.income.data).toHaveLength(1));
    await waitFor(() => expect(result.current.receivables.data).toHaveLength(1));
  });

  it('an update shows up in useIncome', async () => {
    const tx = await transactionRepo.create({
      kind: 'income',
      status: 'unpaid',
      amountMinor: 120000,
      currency: 'USD',
      occurredAt: '2026-10-11',
      title: 'Before',
    });
    const { result } = renderHook(useIncomeLists, { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.income.data?.[0]?.title).toBe('Before'));

    await act(async () => {
      await result.current.update.mutateAsync({ id: tx.id, data: { title: 'After' } });
    });

    await waitFor(() => expect(result.current.income.data?.[0]?.title).toBe('After'));
  });

  // MUT-60: a fast-added Received create goes through useCreateReceivedIncome
  // (record-backed), not useCreateTransaction -- it must refresh the same
  // lists and leave a PaymentRecord the drawer's history can read.
  it('a Received create shows up in useIncome, as paid, with its PaymentRecord', async () => {
    function useReceivedIncomeLists() {
      return { income: useIncome({}), createReceived: useCreateReceivedIncome() };
    }
    const { result } = renderHook(useReceivedIncomeLists, { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.income.isSuccess).toBe(true));

    let created: { id: string } | undefined;
    await act(async () => {
      created = await result.current.createReceived.mutateAsync({
        data: {
          kind: 'income',
          amountMinor: 50000,
          currency: 'USD',
          occurredAt: '2026-10-11',
          title: 'Design payment',
        },
        paidAt: '2026-10-09',
      });
    });

    await waitFor(() => expect(result.current.income.data).toHaveLength(1));
    expect(result.current.income.data?.[0]?.status).toBe('paid');

    const records = await paymentRecordRepo.listByTransaction(created!.id);
    expect(records).toHaveLength(1);
    expect(records[0].paidAt).toBe('2026-10-09');
  });
});

// MUT-5 review: one invalidation list, each key once per write
describe('invalidation covers each money key exactly once (MUT-5 review)', () => {
  beforeEach(async () => {
    await db.transactions.clear();
    await db.paymentRecords.clear();
  });

  afterEach(async () => {
    await db.transactions.clear();
    await db.paymentRecords.clear();
  });

  const MONEY_KEYS = [
    'income',
    'receivables',
    'incomeOverviewTotals',
    'incomeAttentionReceivables',
    'paymentRecords',
    'transactionDisplay',
  ];

  function invalidatedKeys(spy: { mock: { calls: unknown[][] } }): string[] {
    return spy.mock.calls.map(([filters]) => JSON.stringify((filters as { queryKey?: unknown })?.queryKey));
  }

  it('a payment save invalidates each money key once, including the payment drawer display', async () => {
    const queryClient = createTestQueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const tx = await transactionRepo.create({
      kind: 'income',
      status: 'unpaid',
      amountMinor: 10000,
      currency: 'USD',
      occurredAt: '2026-10-01',
    });
    const { result } = renderHook(() => useCreatePaymentRecord(), { wrapper: createWrapper(queryClient) });

    await act(async () => {
      await result.current.mutateAsync({ transactionId: tx.id, amountMinor: 1000, paidAt: '2026-10-02' });
    });

    const keys = invalidatedKeys(spy);
    for (const key of MONEY_KEYS) {
      expect(keys.filter((k) => k === JSON.stringify([key])), key).toHaveLength(1);
    }
  });

  it("an income edit refreshes the payment drawer's remaining balance", async () => {
    const queryClient = createTestQueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const tx = await transactionRepo.create({
      kind: 'income',
      status: 'unpaid',
      amountMinor: 10000,
      currency: 'USD',
      occurredAt: '2026-10-01',
    });
    const { result } = renderHook(() => useUpdateTransaction(), { wrapper: createWrapper(queryClient) });

    await act(async () => {
      await result.current.mutateAsync({ id: tx.id, data: { amountMinor: 15000 } });
    });

    expect(invalidatedKeys(spy)).toContain(JSON.stringify(['transactionDisplay']));
  });
});
