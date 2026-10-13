import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../database';
import { businessProfileRepo } from '../repository';
import type { BusinessProfile } from '../../types';

describe('businessProfileRepo', () => {
  beforeEach(async () => {
    // Clear the database before each test
    await db.businessProfiles.clear();
  });

  afterEach(async () => {
    await db.businessProfiles.clear();
  });

  const createTestProfile = (overrides: Partial<BusinessProfile> = {}): Omit<BusinessProfile, 'id' | 'createdAt' | 'updatedAt'> => ({
    name: 'شركة اختبار',
    nameEn: 'Test Company',
    email: 'test@example.com',
    phone: '+972501234567',
    taxId: '123456789',
    businessType: 'company',
    address1: 'شارع الاختبار 123',
    address1En: '123 Test Street',
    city: 'القدس',
    cityEn: 'Jerusalem',
    country: 'فلسطين',
    countryEn: 'Palestine',
    postalCode: '12345',
    logoDataUrl: undefined,
    primaryColor: '#3b82f6',
    defaultCurrency: 'USD',
    defaultLanguage: 'en',
    isDefault: false,
    archivedAt: undefined,
    ...overrides,
  });

  describe('create', () => {
    it('should create a new business profile', async () => {
      const data = createTestProfile();
      const profile = await businessProfileRepo.create(data);

      expect(profile.id).toBeDefined();
      expect(profile.name).toBe('شركة اختبار');
      expect(profile.nameEn).toBe('Test Company');
      expect(profile.email).toBe('test@example.com');
      expect(profile.createdAt).toBeDefined();
      expect(profile.updatedAt).toBeDefined();
    });

    it('should set isDefault to false for other profiles when creating a default', async () => {
      // Create first profile as default
      const first = await businessProfileRepo.create(createTestProfile({ isDefault: true }));
      expect(first.isDefault).toBe(true);

      // Create second profile as default
      const second = await businessProfileRepo.create(createTestProfile({ name: 'Second', isDefault: true }));
      expect(second.isDefault).toBe(true);

      // First should no longer be default
      const updatedFirst = await businessProfileRepo.get(first.id);
      expect(updatedFirst?.isDefault).toBe(false);
    });
  });

  describe('list', () => {
    it('should return all non-archived profiles sorted by name', async () => {
      await businessProfileRepo.create(createTestProfile({ name: 'Zebra Corp' }));
      await businessProfileRepo.create(createTestProfile({ name: 'Alpha Inc' }));
      await businessProfileRepo.create(createTestProfile({ name: 'Beta LLC' }));

      const profiles = await businessProfileRepo.list();

      expect(profiles).toHaveLength(3);
      expect(profiles[0].name).toBe('Alpha Inc');
      expect(profiles[1].name).toBe('Beta LLC');
      expect(profiles[2].name).toBe('Zebra Corp');
    });

    it('should exclude archived profiles by default', async () => {
      const active = await businessProfileRepo.create(createTestProfile({ name: 'Active' }));
      const toArchive = await businessProfileRepo.create(createTestProfile({ name: 'To Archive' }));
      await businessProfileRepo.archive(toArchive.id);

      const profiles = await businessProfileRepo.list();

      expect(profiles).toHaveLength(1);
      expect(profiles[0].id).toBe(active.id);
    });

    it('should include archived profiles when requested', async () => {
      await businessProfileRepo.create(createTestProfile({ name: 'Active' }));
      const toArchive = await businessProfileRepo.create(createTestProfile({ name: 'To Archive' }));
      await businessProfileRepo.archive(toArchive.id);

      const profiles = await businessProfileRepo.list(true);

      expect(profiles).toHaveLength(2);
    });
  });

  describe('get', () => {
    it('should return a profile by id', async () => {
      const created = await businessProfileRepo.create(createTestProfile());
      const fetched = await businessProfileRepo.get(created.id);

      expect(fetched).toBeDefined();
      expect(fetched?.id).toBe(created.id);
      expect(fetched?.name).toBe(created.name);
    });

    it('should return undefined for non-existent id', async () => {
      const fetched = await businessProfileRepo.get('non-existent-id');
      expect(fetched).toBeUndefined();
    });
  });

  describe('getDefault', () => {
    it('should return the default profile', async () => {
      await businessProfileRepo.create(createTestProfile({ name: 'Not Default', isDefault: false }));
      const defaultProfile = await businessProfileRepo.create(createTestProfile({ name: 'Default', isDefault: true }));

      const fetched = await businessProfileRepo.getDefault();

      expect(fetched).toBeDefined();
      expect(fetched?.id).toBe(defaultProfile.id);
      expect(fetched?.isDefault).toBe(true);
    });

    // MUT-88 (ADR-071): while any active profile exists, one of them is the
    // default; a list with no default can no longer be written.
    it('makes the only active profile the default even when created as non-default', async () => {
      const only = await businessProfileRepo.create(createTestProfile({ isDefault: false }));

      const fetched = await businessProfileRepo.getDefault();

      expect(fetched?.id).toBe(only.id);
      expect(only.isDefault).toBe(true);
    });

    it('should not return archived default profiles', async () => {
      const defaultProfile = await businessProfileRepo.create(createTestProfile({ isDefault: true }));
      await businessProfileRepo.archive(defaultProfile.id);

      const fetched = await businessProfileRepo.getDefault();

      expect(fetched).toBeUndefined();
    });
  });

  describe('update', () => {
    it('should update profile fields', async () => {
      const profile = await businessProfileRepo.create(createTestProfile());

      await businessProfileRepo.update(profile.id, { name: 'Updated Name', email: 'new@email.com' });

      const updated = await businessProfileRepo.get(profile.id);
      expect(updated?.name).toBe('Updated Name');
      expect(updated?.email).toBe('new@email.com');
      // updatedAt should be set (may be same timestamp if test runs quickly)
      expect(updated?.updatedAt).toBeDefined();
    });

    it('should unset other defaults when updating isDefault to true', async () => {
      const first = await businessProfileRepo.create(createTestProfile({ isDefault: true }));
      const second = await businessProfileRepo.create(createTestProfile({ name: 'Second', isDefault: false }));

      await businessProfileRepo.update(second.id, { isDefault: true });

      const updatedFirst = await businessProfileRepo.get(first.id);
      const updatedSecond = await businessProfileRepo.get(second.id);

      expect(updatedFirst?.isDefault).toBe(false);
      expect(updatedSecond?.isDefault).toBe(true);
    });
  });

  describe('setDefault', () => {
    it('should set a profile as default and unset others', async () => {
      const first = await businessProfileRepo.create(createTestProfile({ isDefault: true }));
      const second = await businessProfileRepo.create(createTestProfile({ name: 'Second', isDefault: false }));

      await businessProfileRepo.setDefault(second.id);

      const updatedFirst = await businessProfileRepo.get(first.id);
      const updatedSecond = await businessProfileRepo.get(second.id);

      expect(updatedFirst?.isDefault).toBe(false);
      expect(updatedSecond?.isDefault).toBe(true);
    });
  });

  describe('archive', () => {
    it('should archive a profile', async () => {
      const profile = await businessProfileRepo.create(createTestProfile());

      await businessProfileRepo.archive(profile.id);

      const archived = await businessProfileRepo.get(profile.id);
      expect(archived?.archivedAt).toBeDefined();
      expect(archived?.isDefault).toBe(false);
    });

    it('should set another profile as default when archiving the default', async () => {
      const first = await businessProfileRepo.create(createTestProfile({ isDefault: true }));
      const second = await businessProfileRepo.create(createTestProfile({ name: 'Second', isDefault: false }));

      await businessProfileRepo.archive(first.id);

      const archivedFirst = await businessProfileRepo.get(first.id);
      const updatedSecond = await businessProfileRepo.get(second.id);

      expect(archivedFirst?.archivedAt).toBeDefined();
      expect(archivedFirst?.isDefault).toBe(false);
      expect(updatedSecond?.isDefault).toBe(true);
    });
  });

  // MUT-88 (ADR-071): exactly one default, decided by one rule for every writer.
  describe('exactly one default', () => {
    const at = (iso: string) => ({ createdAt: iso, updatedAt: iso });
    const countDefaults = async () => (await db.businessProfiles.toArray()).filter((p) => p.isDefault).length;

    it('never leaves two defaults after two default creates', async () => {
      await businessProfileRepo.create(createTestProfile({ isDefault: true }));
      await businessProfileRepo.create(createTestProfile({ name: 'Second', isDefault: true }));
      expect(await countDefaults()).toBe(1);
    });

    it('archiving the default hands it to the earliest real profile, not a sample one', async () => {
      await db.businessProfiles.bulkAdd([
        { ...createTestProfile({ isDefault: true }), id: 'old-default', ...at('2026-01-01T00:00:00.000Z') },
        { ...createTestProfile({ name: 'Sample' }), id: 'demo_business_profile_1', ...at('2026-02-01T00:00:00.000Z') },
        { ...createTestProfile({ name: 'Later' }), id: 'later', ...at('2026-04-01T00:00:00.000Z') },
        { ...createTestProfile({ name: 'Earlier' }), id: 'earlier', ...at('2026-03-01T00:00:00.000Z') },
      ]);

      await businessProfileRepo.archive('old-default');

      expect((await businessProfileRepo.getDefault())?.id).toBe('earlier');
      expect(await countDefaults()).toBe(1);
    });

    it('turning the only default off moves the flag to another active profile', async () => {
      const first = await businessProfileRepo.create(createTestProfile({ isDefault: true }));
      const second = await businessProfileRepo.create(createTestProfile({ name: 'Second' }));

      await businessProfileRepo.update(first.id, { isDefault: false });

      expect((await businessProfileRepo.getDefault())?.id).toBe(second.id);
    });

    it('repairs a table that already had two defaults on the next profile write', async () => {
      await db.businessProfiles.bulkAdd([
        { ...createTestProfile({ isDefault: true }), id: 'demo_business_profile_1', ...at('2026-01-01T00:00:00.000Z') },
        { ...createTestProfile({ isDefault: true, name: 'Mine' }), id: 'mine', ...at('2026-05-01T00:00:00.000Z') },
      ]);

      await businessProfileRepo.update('mine', { name: 'Mine, renamed' });

      expect((await businessProfileRepo.getDefault())?.id).toBe('mine');
      expect(await countDefaults()).toBe(1);
    });
  });

  describe('delete', () => {
    it('should permanently delete a profile', async () => {
      const profile = await businessProfileRepo.create(createTestProfile());

      await businessProfileRepo.delete(profile.id);

      const deleted = await businessProfileRepo.get(profile.id);
      expect(deleted).toBeUndefined();
    });
  });
});
