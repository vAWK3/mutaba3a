import { describe, it, expect } from 'vitest';
import { ApiError } from '../../api/client';
import { mapIncomeError, mapSettleError } from '../incomeApiErrors';

const v = (reason: string, extra: Record<string, unknown> = {}) => new ApiError(422, 'VALIDATION_FAILED', reason, { reason, ...extra });

describe('mapIncomeError (MUT-133)', () => {
  it('puts field-owned reasons inline', () => {
    expect(mapIncomeError(v('AMOUNT_INVALID')).fields).toEqual([{ field: 'amount', key: 'hosted.income.errors.amountInvalid' }]);
    expect(mapIncomeError(v('DATE_INVALID', { field: 'occurredOn' })).fields[0].field).toBe('occurredOn');
    expect(mapIncomeError(v('DATE_INVALID', { field: 'dueDate' })).fields[0].field).toBe('dueDate');
    expect(mapIncomeError(v('CUSTOMER_REQUIRED_FOR_OWED')).fields).toEqual([{ field: 'customerId', key: 'hosted.income.errors.clientRequiredOwed' }]);
    expect(mapIncomeError(v('CUSTOMER_NOT_FOUND')).fields[0]).toEqual({ field: 'customerId', key: 'hosted.income.errors.clientNotFound' });
    expect(mapIncomeError(v('PROJECT_NOT_FOUND')).fields[0]).toEqual({ field: 'projectId', key: 'hosted.income.errors.matterNotFound' });
    expect(mapIncomeError(v('PROJECT_CUSTOMER_MISMATCH')).fields[0]).toEqual({ field: 'customerId', key: 'hosted.income.errors.matterMismatch' });
  });

  it('says "more than ten years ago" when the server reports the past bound, and "later than today" otherwise (MUT-227)', () => {
    expect(mapIncomeError(v('DATE_INVALID', { field: 'occurredOn', bound: 'past' })).fields).toEqual([{ field: 'occurredOn', key: 'hosted.income.errors.dateTooOld' }]);
    expect(mapIncomeError(v('DATE_INVALID', { field: 'occurredOn', bound: 'future' })).fields).toEqual([{ field: 'occurredOn', key: 'hosted.income.errors.dateFuture' }]);
    // An older server sends no bound: keep today's message.
    expect(mapIncomeError(v('DATE_INVALID', { field: 'occurredOn' })).fields).toEqual([{ field: 'occurredOn', key: 'hosted.income.errors.dateFuture' }]);
  });

  it('uses the §7.4 sentence for a stale read-only profile', () => {
    expect(mapIncomeError(new ApiError(403, 'READ_ONLY_PROFILE', 'x', { writerOfRecord: 'MALAFAT' })).toast).toBe('hosted.readOnly.malafat');
    expect(mapIncomeError(new ApiError(403, 'READ_ONLY_PROFILE', 'x', { writerOfRecord: null })).toast).toBe('hosted.readOnly.none');
  });

  it('toasts the network and anything unowned', () => {
    expect(mapIncomeError(new ApiError(0, 'NETWORK', 'x')).toast).toBe('hosted.income.errors.network');
    expect(mapIncomeError(new Error('boom')).toast).toBe('hosted.income.errors.network');
    expect(mapIncomeError(v('IDEMPOTENCY_KEY_REUSED')).toast).toBe('hosted.income.errors.saveFailed');
  });
});

describe('mapSettleError (MUT-133)', () => {
  it('shows the new outstanding inline and re-reads when a partial landed meanwhile (R2)', () => {
    expect(mapSettleError(v('ALLOCATION_EXCEEDS_OUTSTANDING', { outstanding: '3000.00' }))).toEqual({
      fields: [{ field: 'amount', key: 'hosted.settle.errors.exceedsNow', params: { outstanding: '3000.00' } }],
      reread: true,
    });
  });

  it('puts a future paidAt on the date field', () => {
    expect(mapSettleError(v('DATE_INVALID', { field: 'paidAt' })).fields[0].field).toBe('paidAt');
  });

  it('says which end of the range a paidAt crossed (MUT-227)', () => {
    expect(mapSettleError(v('DATE_INVALID', { field: 'paidAt', bound: 'past' })).fields).toEqual([{ field: 'paidAt', key: 'hosted.income.errors.dateTooOld' }]);
    expect(mapSettleError(v('DATE_INVALID', { field: 'paidAt', bound: 'future' })).fields).toEqual([{ field: 'paidAt', key: 'hosted.income.errors.dateFuture' }]);
  });

  it('toasts and re-reads when the entry is gone, closed or changed', () => {
    expect(mapSettleError(v('RECEIVABLE_NOT_OPEN'))).toEqual({ fields: [], toast: 'hosted.settle.errors.gone', reread: true });
    expect(mapSettleError(new ApiError(404, 'NOT_FOUND', 'x'))).toEqual({ fields: [], toast: 'hosted.settle.errors.gone', reread: true });
    expect(mapSettleError(new ApiError(409, 'CONFLICT', 'x', { reason: 'VERSION_MISMATCH' }))).toEqual({ fields: [], toast: 'hosted.settle.errors.changed', reread: true });
  });
});
