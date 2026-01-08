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

    it('should return undefined if no default exists', async () => {
      await businessProfileRepo.create(createTestProfile({ isDefault: false }));

      const fetched = await businessProfileRepo.getDefault();

      expect(fetched).toBeUndefined();
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

  describe('delete', () => {
    it('should permanently delete a profile', async () => {
      const profile = await businessProfileRepo.create(createTestProfile());

      await businessProfileRepo.delete(profile.id);

      const deleted = await businessProfileRepo.get(profile.id);
      expect(deleted).toBeUndefined();
    });
  });
});
