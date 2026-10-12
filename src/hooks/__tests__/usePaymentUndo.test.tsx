/**
 * @vitest-environment jsdom
 *
 * MUT-82 (D8–D10): after a payment recorded from Home, a toast offers Undo.
 * Undo deletes that payment record through the repository, which recalculates
 * the entry from the records left (ADR-038, ADR-039), so the entry's status,
 * remaining amount and paidAt come back exactly. Runs against the real
 * repository on fake-indexeddb.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { usePaymentUndo, PAYMENT_UNDO_GROUP } from '../usePaymentUndo';
import { createAppQueryClient } from '../../lib/queryClient';
import { useToastStore } from '../../lib/toastStore';
import { db } from '../../db/database';
import { transactionRepo } from '../../db/repository';
import { getRepositories } from '../../db';
import { todayLocalISO } from '../../lib/dates';
import type { PaymentRecord, Transaction } from '../../types';

vi.mock('../../lib/i18n', () => {
  const translations: Record<string, string> = {
    'common.undo': 'Undo',
    'overview.undoFailed': "Couldn't undo. The payment is still recorded.",
  };
  return { useT: () => (key: string) => translations[key] ?? key };
});

const TODAY = todayLocalISO();

/** The three fields ADR-038/039 derive from payment records */
async function paymentState(id: string) {
  const tx = (await transactionRepo.get(id)) as Transaction;
  return {
    status: tx.status,
    remainingMinor: tx.amountMinor - (tx.receivedAmountMinor ?? 0),
    paidAt: tx.paidAt,
  };
}

async function createEntry(amountMinor = 355000): Promise<string> {
  const tx = await transactionRepo.create({
    kind: 'income',
    status: 'unpaid',
    amountMinor,
    currency: 'ILS',
    occurredAt: '2026-09-01',
    dueDate: '2026-10-01',
  });
  return tx.id;
}

/** What the drawer does on Record: the same repository path */
function recordPayment(transactionId: string, amountMinor: number, paidAt = TODAY): Promise<PaymentRecord> {
  return getRepositories().base.paymentRecords.create({ transactionId, amountMinor, paidAt });
}

function renderUndo() {
  const queryClient = createAppQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => usePaymentUndo(), { wrapper });
}

const toasts = () => useToastStore.getState().toasts;

function pressUndo() {
  const [toast] = toasts();
  act(() => {
    toast.action!.onClick();
    useToastStore.getState().removeToast(toast.id);
  });
}

describe('usePaymentUndo', () => {
  beforeEach(async () => {
    await db.transactions.clear();
    await db.paymentRecords.clear();
    useToastStore.setState({ toasts: [] });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    useToastStore.setState({ toasts: [] });
    await db.transactions.clear();
    await db.paymentRecords.clear();
  });

  it('offers Undo in a toast that says what was recorded', async () => {
    const id = await createEntry();
    const record = await recordPayment(id, 355000);
    const { result } = renderUndo();

    act(() => result.current.offerUndo(record, 'Recorded ₪3,550 from Acme'));

    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]).toMatchObject({ message: 'Recorded ₪3,550 from Acme', group: PAYMENT_UNDO_GROUP });
    expect(toasts()[0].action?.label).toBe('Undo');
  });

  describe('restores the entry exactly', () => {
    it('an unpaid entry paid in full', async () => {
      const id = await createEntry();
      const before = await paymentState(id);
      const record = await recordPayment(id, 355000);
      expect(await paymentState(id)).toEqual({ status: 'paid', remainingMinor: 0, paidAt: TODAY });
      const onUndone = vi.fn();
      const { result } = renderUndo();

      act(() => result.current.offerUndo(record, 'Recorded', onUndone));
      pressUndo();

      await waitFor(() => expect(onUndone).toHaveBeenCalledTimes(1));
      expect(await paymentState(id)).toEqual(before);
      expect(before).toEqual({ status: 'unpaid', remainingMinor: 355000, paidAt: undefined });
    });

    it('a part-paid entry paid in full: unpaid again, the earlier payment still counted, no paidAt', async () => {
      const id = await createEntry();
      await recordPayment(id, 100000, '2026-09-15');
      const before = await paymentState(id);
      const record = await recordPayment(id, 255000);
      expect(await paymentState(id)).toEqual({ status: 'paid', remainingMinor: 0, paidAt: TODAY });
      const onUndone = vi.fn();
      const { result } = renderUndo();

      act(() => result.current.offerUndo(record, 'Recorded', onUndone));
      pressUndo();

      await waitFor(() => expect(onUndone).toHaveBeenCalledTimes(1));
      expect(await paymentState(id)).toEqual(before);
      expect(before).toEqual({ status: 'unpaid', remainingMinor: 255000, paidAt: undefined });
    });

    it('a second partial payment on a part-paid entry', async () => {
      const id = await createEntry();
      await recordPayment(id, 100000, '2026-09-15');
      const before = await paymentState(id);
      const record = await recordPayment(id, 50000);
      const onUndone = vi.fn();
      const { result } = renderUndo();

      act(() => result.current.offerUndo(record, 'Recorded', onUndone));
      pressUndo();

      await waitFor(() => expect(onUndone).toHaveBeenCalledTimes(1));
      expect(await paymentState(id)).toEqual(before);
    });
  });

  it('keeps one Undo at a time: a second payment replaces it and the first stays recorded', async () => {
    const first = await createEntry();
    const second = await createEntry(90000);
    const firstRecord = await recordPayment(first, 355000);
    const secondRecord = await recordPayment(second, 90000);
    const onUndone = vi.fn();
    const { result } = renderUndo();

    act(() => result.current.offerUndo(firstRecord, 'Recorded ₪3,550'));
    act(() => result.current.offerUndo(secondRecord, 'Recorded ₪900', onUndone));

    expect(toasts().map((toast) => toast.message)).toEqual(['Recorded ₪900']);
    pressUndo();
    await waitFor(() => expect(onUndone).toHaveBeenCalledTimes(1));
    expect((await paymentState(first)).status).toBe('paid');
    expect((await paymentState(second)).status).toBe('unpaid');
  });

  it('still undoes after the screen that offered it has gone', async () => {
    const id = await createEntry();
    const before = await paymentState(id);
    const record = await recordPayment(id, 355000);
    const onUndone = vi.fn();
    const { result, unmount } = renderUndo();

    act(() => result.current.offerUndo(record, 'Recorded', onUndone));
    unmount();
    pressUndo();

    await waitFor(() => expect(onUndone).toHaveBeenCalledTimes(1));
    expect(await paymentState(id)).toEqual(before);
  });

  it('says so when the undo fails, and leaves the payment recorded', async () => {
    const id = await createEntry();
    const record = await recordPayment(id, 355000);
    vi.spyOn(getRepositories().base.paymentRecords, 'delete').mockRejectedValueOnce(new Error('IndexedDB closed'));
    const onUndone = vi.fn();
    const { result } = renderUndo();

    act(() => result.current.offerUndo(record, 'Recorded', onUndone));
    pressUndo();

    await waitFor(() =>
      expect(toasts()).toEqual([
        expect.objectContaining({ message: "Couldn't undo. The payment is still recorded.", type: 'error' }),
      ]),
    );
    expect(onUndone).not.toHaveBeenCalled();
    expect((await paymentState(id)).status).toBe('paid');
  });
});
