import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../../db/database';
import type { BusinessProfile } from '../../types';

/**
 * MUT-88 (ADR-071): the seed reads "does the person already have a default?"
 * before its transaction. If the welcome modal creates "Default Profile" in
 * that gap, the seed used to write a second default, and the sample business
 * sat beside the person's own with a Default badge. The seed now settles the
 * default inside its own transaction, and a real profile outranks a sample.
 */

// Simulate the stale read: whatever the seed saw, it builds a default sample.
vi.mock('../seedData/profile', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../seedData/profile')>();
  return { ...actual, createDemoProfiles: () => actual.createDemoProfiles({ existingDefault: false }) };
});

vi.setConfig({ testTimeout: 15_000 });

const { seedDemoData } = await import('../seedData');

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()));
});

describe('seedDemoData keeps the person\'s default', () => {
  it('leaves exactly one default, and it is the person\'s own profile, after a stale read', async () => {
    const later = new Date(Date.now() + 60_000).toISOString(); // created after the sample rows were stamped
    await db.businessProfiles.add({
      id: 'mine', name: 'Default Profile', defaultCurrency: 'USD', isDefault: true, createdAt: later, updatedAt: later,
    } as BusinessProfile);

    await seedDemoData({ announceFeatures: false });

    const defaults = (await db.businessProfiles.toArray()).filter((p) => p.isDefault);
    expect(defaults.map((p) => p.id)).toEqual(['mine']);
  });

  it('makes the first sample business the default in an empty database', async () => {
    await seedDemoData({ announceFeatures: false });

    const defaults = (await db.businessProfiles.toArray()).filter((p) => p.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].id.startsWith('demo_')).toBe(true);
  });
});
