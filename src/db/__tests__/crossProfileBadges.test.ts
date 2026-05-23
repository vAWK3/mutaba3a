import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../database';
import { getCrossProfileClientStats } from '../crossProfileStats';

describe('getCrossProfileClientStats', () => {
  const profileA = 'profile-a';
  const profileB = 'profile-b';
  const clientX = 'client-x';
  const clientY = 'client-y';

  beforeEach(async () => {
    await db.transactions.clear();
    await db.clients.clear();
    await db.businessProfiles.clear();

    await db.businessProfiles.bulkAdd([
      { id: profileA, name: 'Profile A', isDefault: true, createdAt: '2024-01-01T00:00:00Z' },
      { id: profileB, name: 'Profile B', createdAt: '2024-01-01T00:00:00Z' },
    ]);

    await db.clients.bulkAdd([
      { id: clientX, name: 'Client X', profileId: profileA, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
      { id: clientY, name: 'Client Y', profileId: profileB, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
    ]);
  });

  afterEach(async () => {
    await db.transactions.clear();
    await db.clients.clear();
    await db.businessProfiles.clear();
  });

  it('should return empty map for clients with no cross-profile transactions', async () => {
    // Client X has transactions only in Profile A (its home profile)
    await db.transactions.add({
      id: 'tx-1', kind: 'income', status: 'paid', amountMinor: 10000, currency: 'USD',
      occurredAt: '2024-01-15', profileId: profileA, clientId: clientX,
      createdAt: '2024-01-15T00:00:00Z', updatedAt: '2024-01-15T00:00:00Z',
    });

    const stats = await getCrossProfileClientStats();
    // Client X only has transactions in one profile, so no cross-profile badge needed
    expect(stats.has(clientX)).toBe(false);
  });

  it('should return stats for clients with transactions in multiple profiles', async () => {
    // Client X has transactions in both profiles
    await db.transactions.bulkAdd([
      {
        id: 'tx-a1', kind: 'income', status: 'paid', amountMinor: 10000, currency: 'USD',
        occurredAt: '2024-01-15', profileId: profileA, clientId: clientX,
        createdAt: '2024-01-15T00:00:00Z', updatedAt: '2024-01-15T00:00:00Z',
      },
      {
        id: 'tx-a2', kind: 'income', status: 'unpaid', amountMinor: 5000, currency: 'USD',
        occurredAt: '2024-01-20', profileId: profileA, clientId: clientX,
        createdAt: '2024-01-20T00:00:00Z', updatedAt: '2024-01-20T00:00:00Z',
      },
      {
        id: 'tx-b1', kind: 'income', status: 'paid', amountMinor: 20000, currency: 'USD',
        occurredAt: '2024-02-15', profileId: profileB, clientId: clientX,
        createdAt: '2024-02-15T00:00:00Z', updatedAt: '2024-02-15T00:00:00Z',
      },
    ]);

    const stats = await getCrossProfileClientStats();
    expect(stats.has(clientX)).toBe(true);

    const clientStats = stats.get(clientX)!;
    expect(clientStats).toHaveLength(2);

    const profileAStats = clientStats.find(s => s.profileId === profileA)!;
    expect(profileAStats.txCount).toBe(2);
    expect(profileAStats.totalMinor).toBe(15000);

    const profileBStats = clientStats.find(s => s.profileId === profileB)!;
    expect(profileBStats.txCount).toBe(1);
    expect(profileBStats.totalMinor).toBe(20000);
  });

  it('should exclude soft-deleted transactions', async () => {
    await db.transactions.bulkAdd([
      {
        id: 'tx-live', kind: 'income', status: 'paid', amountMinor: 10000, currency: 'USD',
        occurredAt: '2024-01-15', profileId: profileA, clientId: clientX,
        createdAt: '2024-01-15T00:00:00Z', updatedAt: '2024-01-15T00:00:00Z',
      },
      {
        id: 'tx-deleted', kind: 'income', status: 'paid', amountMinor: 20000, currency: 'USD',
        occurredAt: '2024-01-15', profileId: profileB, clientId: clientX,
        deletedAt: '2024-01-16T00:00:00Z',
        createdAt: '2024-01-15T00:00:00Z', updatedAt: '2024-01-15T00:00:00Z',
      },
    ]);

    const stats = await getCrossProfileClientStats();
    // Only one profile has live transactions, so no cross-profile badge
    expect(stats.has(clientX)).toBe(false);
  });

  it('should include profile names in the stats', async () => {
    await db.transactions.bulkAdd([
      {
        id: 'tx-a', kind: 'income', status: 'paid', amountMinor: 10000, currency: 'USD',
        occurredAt: '2024-01-15', profileId: profileA, clientId: clientX,
        createdAt: '2024-01-15T00:00:00Z', updatedAt: '2024-01-15T00:00:00Z',
      },
      {
        id: 'tx-b', kind: 'income', status: 'paid', amountMinor: 20000, currency: 'USD',
        occurredAt: '2024-02-15', profileId: profileB, clientId: clientX,
        createdAt: '2024-02-15T00:00:00Z', updatedAt: '2024-02-15T00:00:00Z',
      },
    ]);

    const stats = await getCrossProfileClientStats();
    const clientStats = stats.get(clientX)!;

    expect(clientStats.find(s => s.profileId === profileA)!.profileName).toBe('Profile A');
    expect(clientStats.find(s => s.profileId === profileB)!.profileName).toBe('Profile B');
  });
});
