import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../database';

describe('Migration v17 — profileId enforcement', () => {
  beforeEach(async () => {
    await db.transactions.clear();
    await db.clients.clear();
    await db.projects.clear();
    await db.expenses.clear();
    await db.businessProfiles.clear();
  });

  afterEach(async () => {
    await db.transactions.clear();
    await db.clients.clear();
    await db.projects.clear();
    await db.expenses.clear();
    await db.businessProfiles.clear();
  });

  it('should have needsReview index on transactions table', () => {
    // v17 schema adds needsReview as an indexed field
    const schema = db.transactions.schema;
    const indexNames = schema.indexes.map(idx => idx.name);
    expect(indexNames).toContain('needsReview');
  });

  it('should allow storing and querying needsReview flag', async () => {
    const profileId = 'test-profile';
    await db.businessProfiles.add({
      id: profileId,
      name: 'Test',
      isDefault: true,
      createdAt: new Date().toISOString(),
    });

    // Create a transaction with needsReview
    await db.transactions.add({
      id: 'tx-needs-review',
      kind: 'income',
      status: 'unpaid',
      amountMinor: 10000,
      currency: 'USD',
      occurredAt: '2024-01-15',
      profileId,
      needsReview: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Create a normal transaction
    await db.transactions.add({
      id: 'tx-normal',
      kind: 'income',
      status: 'paid',
      amountMinor: 5000,
      currency: 'USD',
      occurredAt: '2024-01-15',
      profileId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Query by needsReview
    const needsReview = await db.transactions
      .filter(tx => tx.needsReview === true)
      .toArray();
    expect(needsReview).toHaveLength(1);
    expect(needsReview[0].id).toBe('tx-needs-review');
  });

  it('should clear needsReview flag when updated', async () => {
    const profileId = 'test-profile';
    await db.businessProfiles.add({
      id: profileId,
      name: 'Test',
      isDefault: true,
      createdAt: new Date().toISOString(),
    });

    await db.transactions.add({
      id: 'tx-review',
      kind: 'income',
      status: 'unpaid',
      amountMinor: 10000,
      currency: 'USD',
      occurredAt: '2024-01-15',
      profileId,
      needsReview: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Clear the flag
    await db.transactions.update('tx-review', { needsReview: undefined });

    const needsReview = await db.transactions
      .filter(tx => tx.needsReview === true)
      .toArray();
    expect(needsReview).toHaveLength(0);
  });

  it('should correctly add transaction with all required fields post-v17', async () => {
    const profileId = 'test-profile';
    await db.businessProfiles.add({
      id: profileId,
      name: 'Test',
      isDefault: true,
      createdAt: new Date().toISOString(),
    });

    const tx = {
      id: 'tx-complete',
      kind: 'income' as const,
      status: 'unpaid' as const,
      amountMinor: 25000,
      currency: 'USD' as const,
      occurredAt: '2024-06-15',
      profileId,
      clientId: 'client-1',
      receivedAmountMinor: 10000,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await db.transactions.add(tx);
    const retrieved = await db.transactions.get('tx-complete');

    expect(retrieved).toBeDefined();
    expect(retrieved!.profileId).toBe(profileId);
    expect(retrieved!.receivedAmountMinor).toBe(10000);
    expect(retrieved!.needsReview).toBeUndefined();
  });
});
