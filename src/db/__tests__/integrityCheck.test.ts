import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../database';
import { runIntegrityCheck } from '../integrityCheck';

describe('runIntegrityCheck', () => {
  beforeEach(async () => {
    await db.transactions.clear();
    await db.clients.clear();
    await db.projects.clear();
    await db.expenses.clear();
  });

  afterEach(async () => {
    await db.transactions.clear();
    await db.clients.clear();
    await db.projects.clear();
    await db.expenses.clear();
  });

  it('should return clean result for empty database', async () => {
    const result = await runIntegrityCheck();
    expect(result.isClean).toBe(true);
    expect(result.orphanedRecords).toHaveLength(0);
    expect(result.brokenReferences).toHaveLength(0);
    expect(result.totalRecords).toBe(0);
  });

  it('should detect transactions with missing profileId', async () => {
    await db.transactions.add({
      id: 'tx-orphan',
      kind: 'income',
      status: 'unpaid',
      amountMinor: 10000,
      currency: 'USD',
      occurredAt: '2024-01-15',
      createdAt: '2024-01-15T00:00:00Z',
      updatedAt: '2024-01-15T00:00:00Z',
      // no profileId
    });

    const result = await runIntegrityCheck();
    expect(result.isClean).toBe(false);
    expect(result.orphanedRecords).toHaveLength(1);
    expect(result.orphanedRecords[0]).toEqual({
      id: 'tx-orphan',
      table: 'transactions',
      issue: 'missing_profileId',
    });
  });

  it('should skip deleted transactions when checking profileId', async () => {
    await db.transactions.add({
      id: 'tx-deleted',
      kind: 'income',
      status: 'unpaid',
      amountMinor: 10000,
      currency: 'USD',
      occurredAt: '2024-01-15',
      createdAt: '2024-01-15T00:00:00Z',
      updatedAt: '2024-01-15T00:00:00Z',
      deletedAt: '2024-01-16T00:00:00Z',
      // no profileId — but deleted, so should not be flagged
    });

    const result = await runIntegrityCheck();
    expect(result.orphanedRecords).toHaveLength(0);
  });

  it('should detect broken clientId references', async () => {
    await db.transactions.add({
      id: 'tx-broken-ref',
      kind: 'income',
      status: 'paid',
      amountMinor: 5000,
      currency: 'USD',
      occurredAt: '2024-01-15',
      profileId: 'profile-1',
      clientId: 'non-existent-client',
      createdAt: '2024-01-15T00:00:00Z',
      updatedAt: '2024-01-15T00:00:00Z',
    });

    const result = await runIntegrityCheck();
    expect(result.brokenReferences).toHaveLength(1);
    expect(result.brokenReferences[0]).toEqual({
      id: 'tx-broken-ref',
      table: 'transactions',
      field: 'clientId',
      missingId: 'non-existent-client',
    });
  });

  it('should detect clients with missing profileId', async () => {
    await db.clients.add({
      id: 'client-orphan',
      name: 'Orphaned Client',
      createdAt: '2024-01-15T00:00:00Z',
      updatedAt: '2024-01-15T00:00:00Z',
      // no profileId
    });

    const result = await runIntegrityCheck();
    expect(result.orphanedRecords.some(
      r => r.id === 'client-orphan' && r.table === 'clients'
    )).toBe(true);
  });

  it('should return clean for properly structured data', async () => {
    const clientId = 'client-good';
    const profileId = 'profile-1';

    await db.clients.add({
      id: clientId,
      name: 'Good Client',
      profileId,
      createdAt: '2024-01-15T00:00:00Z',
      updatedAt: '2024-01-15T00:00:00Z',
    });

    await db.transactions.add({
      id: 'tx-good',
      kind: 'income',
      status: 'paid',
      amountMinor: 5000,
      currency: 'USD',
      occurredAt: '2024-01-15',
      profileId,
      clientId,
      createdAt: '2024-01-15T00:00:00Z',
      updatedAt: '2024-01-15T00:00:00Z',
    });

    const result = await runIntegrityCheck();
    expect(result.isClean).toBe(true);
    expect(result.totalRecords).toBe(2);
  });
});
