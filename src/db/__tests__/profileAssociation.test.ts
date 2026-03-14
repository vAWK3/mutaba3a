import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../database';
import { clientRepo, projectRepo, businessProfileRepo } from '../repository';

describe('Profile Association - Auto-assignment', () => {
  beforeEach(async () => {
    await db.clients.clear();
    await db.projects.clear();
    await db.businessProfiles.clear();
  });

  afterEach(async () => {
    await db.clients.clear();
    await db.projects.clear();
    await db.businessProfiles.clear();
  });

  describe('clientRepo.create', () => {
    it('should auto-assign default profile when no profileId provided', async () => {
      // Create a default profile
      const defaultProfile = await businessProfileRepo.create({
        name: 'Default Profile',
        email: 'default@example.com',
        businessType: 'none',
        defaultCurrency: 'USD',
        defaultLanguage: 'en',
        isDefault: true,
      });

      // Create client without profileId
      const client = await clientRepo.create({
        name: 'Test Client',
      });

      expect(client.profileId).toBe(defaultProfile.id);
    });

    it('should respect explicitly provided profileId', async () => {
      // Create two profiles
      const profile1 = await businessProfileRepo.create({
        name: 'Profile 1',
        email: 'profile1@example.com',
        businessType: 'none',
        defaultCurrency: 'USD',
        defaultLanguage: 'en',
        isDefault: true,
      });

      const profile2 = await businessProfileRepo.create({
        name: 'Profile 2',
        email: 'profile2@example.com',
        businessType: 'none',
        defaultCurrency: 'USD',
        defaultLanguage: 'en',
        isDefault: false,
      });

      // Create client with explicit profileId
      const client = await clientRepo.create({
        name: 'Test Client',
        profileId: profile2.id,
      });

      expect(client.profileId).toBe(profile2.id);
      expect(client.profileId).not.toBe(profile1.id);
    });

    it('should handle no profiles gracefully', async () => {
      // Create client when no profiles exist
      const client = await clientRepo.create({
        name: 'Test Client',
      });

      expect(client.profileId).toBeUndefined();
    });

    it('should not assign profile when no default is set', async () => {
      // Create profile without isDefault flag
      await businessProfileRepo.create({
        name: 'Only Profile',
        email: 'only@example.com',
        businessType: 'none',
        defaultCurrency: 'USD',
        defaultLanguage: 'en',
        isDefault: false,
      });

      const client = await clientRepo.create({
        name: 'Test Client',
      });

      // Should not auto-assign if no default profile exists
      expect(client.profileId).toBeUndefined();
    });
  });

  describe('projectRepo.create', () => {
    it('should auto-assign default profile when no profileId provided', async () => {
      // Create a default profile
      const defaultProfile = await businessProfileRepo.create({
        name: 'Default Profile',
        email: 'default@example.com',
        businessType: 'none',
        defaultCurrency: 'USD',
        defaultLanguage: 'en',
        isDefault: true,
      });

      // Create project without profileId
      const project = await projectRepo.create({
        name: 'Test Project',
      });

      expect(project.profileId).toBe(defaultProfile.id);
    });

    it('should respect explicitly provided profileId', async () => {
      // Create two profiles
      const profile1 = await businessProfileRepo.create({
        name: 'Profile 1',
        email: 'profile1@example.com',
        businessType: 'none',
        defaultCurrency: 'USD',
        defaultLanguage: 'en',
        isDefault: true,
      });

      const profile2 = await businessProfileRepo.create({
        name: 'Profile 2',
        email: 'profile2@example.com',
        businessType: 'none',
        defaultCurrency: 'USD',
        defaultLanguage: 'en',
        isDefault: false,
      });

      // Create project with explicit profileId
      const project = await projectRepo.create({
        name: 'Test Project',
        profileId: profile2.id,
      });

      expect(project.profileId).toBe(profile2.id);
      expect(project.profileId).not.toBe(profile1.id);
    });

    it('should handle no profiles gracefully', async () => {
      // Create project when no profiles exist
      const project = await projectRepo.create({
        name: 'Test Project',
      });

      expect(project.profileId).toBeUndefined();
    });

    it('should auto-assign profile even with other fields', async () => {
      const defaultProfile = await businessProfileRepo.create({
        name: 'Default Profile',
        email: 'default@example.com',
        businessType: 'none',
        defaultCurrency: 'USD',
        defaultLanguage: 'en',
        isDefault: true,
      });

      const client = await clientRepo.create({
        name: 'Test Client',
      });

      const project = await projectRepo.create({
        name: 'Test Project',
        clientId: client.id,
        field: 'Development',
        notes: 'Test notes',
      });

      expect(project.profileId).toBe(defaultProfile.id);
      expect(project.clientId).toBe(client.id);
      expect(project.field).toBe('Development');
      expect(project.notes).toBe('Test notes');
    });
  });

  describe('Profile filtering', () => {
    it('should filter clients by profileId', async () => {
      const profile1 = await businessProfileRepo.create({
        name: 'Profile 1',
        email: 'profile1@example.com',
        businessType: 'none',
        defaultCurrency: 'USD',
        defaultLanguage: 'en',
        isDefault: true,
      });

      const profile2 = await businessProfileRepo.create({
        name: 'Profile 2',
        email: 'profile2@example.com',
        businessType: 'none',
        defaultCurrency: 'USD',
        defaultLanguage: 'en',
        isDefault: false,
      });

      await clientRepo.create({ name: 'Client 1', profileId: profile1.id });
      await clientRepo.create({ name: 'Client 2', profileId: profile2.id });
      await clientRepo.create({ name: 'Client 3', profileId: profile1.id });

      const profile1Clients = await clientRepo.list({ profileId: profile1.id });
      const profile2Clients = await clientRepo.list({ profileId: profile2.id });

      expect(profile1Clients).toHaveLength(2);
      expect(profile2Clients).toHaveLength(1);
    });

    it('should filter projects by profileId', async () => {
      const profile1 = await businessProfileRepo.create({
        name: 'Profile 1',
        email: 'profile1@example.com',
        businessType: 'none',
        defaultCurrency: 'USD',
        defaultLanguage: 'en',
        isDefault: true,
      });

      const profile2 = await businessProfileRepo.create({
        name: 'Profile 2',
        email: 'profile2@example.com',
        businessType: 'none',
        defaultCurrency: 'USD',
        defaultLanguage: 'en',
        isDefault: false,
      });

      await projectRepo.create({ name: 'Project 1', profileId: profile1.id });
      await projectRepo.create({ name: 'Project 2', profileId: profile2.id });
      await projectRepo.create({ name: 'Project 3', profileId: profile1.id });
      await projectRepo.create({ name: 'Project 4', profileId: profile1.id });

      const profile1Projects = await projectRepo.list({ profileId: profile1.id });
      const profile2Projects = await projectRepo.list({ profileId: profile2.id });

      expect(profile1Projects).toHaveLength(3);
      expect(profile2Projects).toHaveLength(1);
    });

    it('should return all records when profileId filter is undefined', async () => {
      const profile1 = await businessProfileRepo.create({
        name: 'Profile 1',
        email: 'profile1@example.com',
        businessType: 'none',
        defaultCurrency: 'USD',
        defaultLanguage: 'en',
        isDefault: true,
      });

      await clientRepo.create({ name: 'Client 1', profileId: profile1.id });
      await clientRepo.create({ name: 'Client 2', profileId: profile1.id });

      const allClients = await clientRepo.list({ profileId: undefined });

      expect(allClients).toHaveLength(2);
    });
  });
});
