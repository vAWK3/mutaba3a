import { Prisma, type PrismaClient } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import type { CorrectAgreementInput } from '../ports.js';
import { isLockConflict, isTransactionTimeout, PrismaLedgerStore } from '../prisma.js';

/** MUT-100 review: a deadlock or serialization failure in an outcome write is retryable `stale`, not a 500. */
describe('isLockConflict', () => {
  const known = (code: string, meta?: Record<string, unknown>) => new Prisma.PrismaClientKnownRequestError('x', { code, clientVersion: 'test', ...(meta ? { meta } : {}) });

  it('recognizes Prisma’s transaction conflict and a raw query aborted with 40P01 / 40001', () => {
    expect(isLockConflict(known('P2034'))).toBe(true);
    expect(isLockConflict(known('P2010', { code: '40P01' }))).toBe(true);
    expect(isLockConflict(known('P2010', { code: '40001' }))).toBe(true);
  });

  it('leaves every other failure alone', () => {
    expect(isLockConflict(known('P2010', { code: '23505' }))).toBe(false);
    expect(isLockConflict(known('P2002'))).toBe(false);
    expect(isLockConflict(new Error('deadlock detected'))).toBe(false);
    expect(isLockConflict(undefined)).toBe(false);
  });
});

/** MUT-443 review 1: a correction that outlasts its transaction's time limit rolled back whole, so it is retryable too. */
describe('isTransactionTimeout', () => {
  const known = (code: string) => new Prisma.PrismaClientKnownRequestError('x', { code, clientVersion: 'test' });

  it('recognizes Prisma’s interactive-transaction timeout (P2028)', () => {
    expect(isTransactionTimeout(known('P2028'))).toBe(true);
  });

  it('leaves every other failure alone', () => {
    expect(isTransactionTimeout(known('P2034'))).toBe(false);
    expect(isTransactionTimeout(new Error('Transaction already closed'))).toBe(false);
    expect(isTransactionTimeout(undefined)).toBe(false);
  });
});

/** MUT-444: a terms correction that outlasts its 15 s limit rolled back whole; the caller previews again (409), not a 500. */
describe('agreements.correct and P2028', () => {
  it('answers stale when the transaction times out', async () => {
    const timeout = new Prisma.PrismaClientKnownRequestError('Transaction already closed', { code: 'P2028', clientVersion: 'test' });
    const client = { $transaction: async () => Promise.reject(timeout) } as unknown as PrismaClient;
    const input = { expectedVersion: 1 } as unknown as CorrectAgreementInput;
    expect(await new PrismaLedgerStore(client).agreements.correct('org', 'agreement', input, new Date())).toEqual({ kind: 'stale' });
  });
});
