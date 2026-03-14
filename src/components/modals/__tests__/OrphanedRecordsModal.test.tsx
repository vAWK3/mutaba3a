import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { db } from '../../../db/database';
import { clientRepo, businessProfileRepo } from '../../../db/repository';
import { OrphanedRecordsModal } from '../OrphanedRecordsModal';
import { LanguageProvider } from '../../../lib/i18n';

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function TestWrapper({ children }: { children: ReactNode }) {
  const queryClient = createTestQueryClient();
  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>{children}</LanguageProvider>
    </QueryClientProvider>
  );
}

describe('OrphanedRecordsModal', () => {
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

  describe('Clients mode', () => {
    it('should not render when no orphaned clients exist', async () => {
      const profile = await businessProfileRepo.create({
        name: 'Test Profile',
        email: 'test@example.com',
        businessType: 'none',
        defaultCurrency: 'USD',
        defaultLanguage: 'en',
        isDefault: true,
      });

      // Create client with profile
      await clientRepo.create({
        name: 'Client with Profile',
        profileId: profile.id,
      });

      const onClose = vi.fn();

      render(
        <TestWrapper>
          <OrphanedRecordsModal isOpen={true} onClose={onClose} type="clients" />
        </TestWrapper>
      );

      // Modal should not render since there are no orphaned clients
      await waitFor(() => {
        expect(screen.queryByText('Assign Profiles')).not.toBeInTheDocument();
      });
    });

    it('should render orphaned clients in table', async () => {
      await businessProfileRepo.create({
        name: 'Default Profile',
        email: 'default@example.com',
        businessType: 'none',
        defaultCurrency: 'USD',
        defaultLanguage: 'en',
        isDefault: true,
      });

      // Create orphaned clients (no profileId)
      await db.clients.add({
        id: 'client1',
        name: 'Orphaned Client 1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      await db.clients.add({
        id: 'client2',
        name: 'Orphaned Client 2',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const onClose = vi.fn();

      render(
        <TestWrapper>
          <OrphanedRecordsModal isOpen={true} onClose={onClose} type="clients" />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText('Assign Profiles')).toBeInTheDocument();
        expect(screen.getByText('Orphaned Client 1')).toBeInTheDocument();
        expect(screen.getByText('Orphaned Client 2')).toBeInTheDocument();
      });
    });

    it('should show default profile in assign all button', async () => {
      const profile = await businessProfileRepo.create({
        name: 'My Default Profile',
        email: 'default@example.com',
        businessType: 'none',
        defaultCurrency: 'USD',
        defaultLanguage: 'en',
        isDefault: true,
      });

      await db.clients.add({
        id: 'client1',
        name: 'Orphaned Client',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const onClose = vi.fn();

      render(
        <TestWrapper>
          <OrphanedRecordsModal isOpen={true} onClose={onClose} type="clients" />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(
          screen.getByText(/Assign All to Default Profile \(My Default Profile\)/i)
        ).toBeInTheDocument();
      });
    });

    it('should assign all orphaned clients to default profile', async () => {
      const user = userEvent.setup();

      const profile = await businessProfileRepo.create({
        name: 'Default Profile',
        email: 'default@example.com',
        businessType: 'none',
        defaultCurrency: 'USD',
        defaultLanguage: 'en',
        isDefault: true,
      });

      await db.clients.add({
        id: 'client1',
        name: 'Orphaned Client 1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      await db.clients.add({
        id: 'client2',
        name: 'Orphaned Client 2',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const onClose = vi.fn();

      render(
        <TestWrapper>
          <OrphanedRecordsModal isOpen={true} onClose={onClose} type="clients" />
        </TestWrapper>
      );

      const assignButton = await screen.findByText(
        /Assign All to Default Profile/i
      );
      await user.click(assignButton);

      await waitFor(async () => {
        const client1 = await db.clients.get('client1');
        const client2 = await db.clients.get('client2');

        expect(client1?.profileId).toBe(profile.id);
        expect(client2?.profileId).toBe(profile.id);
        expect(onClose).toHaveBeenCalled();
      });
    });

    it('should allow individual profile assignment', async () => {
      const user = userEvent.setup();

      await businessProfileRepo.create({
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

      await db.clients.add({
        id: 'client1',
        name: 'Orphaned Client 1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const onClose = vi.fn();

      render(
        <TestWrapper>
          <OrphanedRecordsModal isOpen={true} onClose={onClose} type="clients" />
        </TestWrapper>
      );

      // Wait for modal to render
      await waitFor(() => {
        expect(screen.getByText('Orphaned Client 1')).toBeInTheDocument();
      });

      // Wait for profiles to load in the dropdown
      await waitFor(() => {
        const selects = screen.getAllByRole('combobox');
        const clientSelect = selects[0] as HTMLSelectElement;
        const options = Array.from(clientSelect.options);
        expect(options.length).toBeGreaterThan(1); // Should have multiple profile options
      });

      // Find the select dropdown after profiles loaded
      const selects = screen.getAllByRole('combobox');
      const clientSelect = selects[0];

      // Change to Profile 2
      await user.selectOptions(clientSelect, profile2.id);

      // Click individual save button
      const saveButton = screen.getByRole('button', { name: /Save/i });
      await user.click(saveButton);

      await waitFor(async () => {
        const client1 = await db.clients.get('client1');
        expect(client1?.profileId).toBe(profile2.id);
        expect(onClose).toHaveBeenCalled();
      });
    });

    it('should not show archived clients', async () => {
      const profile = await businessProfileRepo.create({
        name: 'Default Profile',
        email: 'default@example.com',
        businessType: 'none',
        defaultCurrency: 'USD',
        defaultLanguage: 'en',
        isDefault: true,
      });

      // Create orphaned but archived client
      await db.clients.add({
        id: 'client1',
        name: 'Archived Orphaned Client',
        archivedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const onClose = vi.fn();

      render(
        <TestWrapper>
          <OrphanedRecordsModal isOpen={true} onClose={onClose} type="clients" />
        </TestWrapper>
      );

      // Modal should not render since archived clients are excluded
      await waitFor(() => {
        expect(screen.queryByText('Assign Profiles')).not.toBeInTheDocument();
      });
    });
  });

  describe('Projects mode', () => {
    it('should render orphaned projects in table', async () => {
      const profile = await businessProfileRepo.create({
        name: 'Default Profile',
        email: 'default@example.com',
        businessType: 'none',
        defaultCurrency: 'USD',
        defaultLanguage: 'en',
        isDefault: true,
      });

      // Create orphaned projects (no profileId)
      await db.projects.add({
        id: 'project1',
        name: 'Orphaned Project 1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      await db.projects.add({
        id: 'project2',
        name: 'Orphaned Project 2',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const onClose = vi.fn();

      render(
        <TestWrapper>
          <OrphanedRecordsModal isOpen={true} onClose={onClose} type="projects" />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText('Assign Profiles')).toBeInTheDocument();
        expect(screen.getByText('Orphaned Project 1')).toBeInTheDocument();
        expect(screen.getByText('Orphaned Project 2')).toBeInTheDocument();
      });
    });

    it('should assign all orphaned projects to default profile', async () => {
      const user = userEvent.setup();

      const profile = await businessProfileRepo.create({
        name: 'Default Profile',
        email: 'default@example.com',
        businessType: 'none',
        defaultCurrency: 'USD',
        defaultLanguage: 'en',
        isDefault: true,
      });

      await db.projects.add({
        id: 'project1',
        name: 'Orphaned Project 1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      await db.projects.add({
        id: 'project2',
        name: 'Orphaned Project 2',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const onClose = vi.fn();

      render(
        <TestWrapper>
          <OrphanedRecordsModal isOpen={true} onClose={onClose} type="projects" />
        </TestWrapper>
      );

      const assignButton = await screen.findByText(
        /Assign All to Default Profile/i
      );
      await user.click(assignButton);

      await waitFor(async () => {
        const project1 = await db.projects.get('project1');
        const project2 = await db.projects.get('project2');

        expect(project1?.profileId).toBe(profile.id);
        expect(project2?.profileId).toBe(profile.id);
        expect(onClose).toHaveBeenCalled();
      });
    });
  });

  describe('Modal interactions', () => {
    it('should close modal when clicking cancel', async () => {
      const user = userEvent.setup();

      await businessProfileRepo.create({
        name: 'Default Profile',
        email: 'default@example.com',
        businessType: 'none',
        defaultCurrency: 'USD',
        defaultLanguage: 'en',
        isDefault: true,
      });

      await db.clients.add({
        id: 'client1',
        name: 'Orphaned Client',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const onClose = vi.fn();

      render(
        <TestWrapper>
          <OrphanedRecordsModal isOpen={true} onClose={onClose} type="clients" />
        </TestWrapper>
      );

      const cancelButton = await screen.findByRole('button', { name: /Cancel/i });
      await user.click(cancelButton);

      expect(onClose).toHaveBeenCalled();
    });

    it('should close modal when clicking backdrop', async () => {
      const user = userEvent.setup();

      await businessProfileRepo.create({
        name: 'Default Profile',
        email: 'default@example.com',
        businessType: 'none',
        defaultCurrency: 'USD',
        defaultLanguage: 'en',
        isDefault: true,
      });

      await db.clients.add({
        id: 'client1',
        name: 'Orphaned Client',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const onClose = vi.fn();

      render(
        <TestWrapper>
          <OrphanedRecordsModal isOpen={true} onClose={onClose} type="clients" />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText('Orphaned Client')).toBeInTheDocument();
      });

      // Click the backdrop (the outer div)
      const backdrop = screen.getByRole('dialog').parentElement;
      if (backdrop) {
        await user.click(backdrop);
        expect(onClose).toHaveBeenCalled();
      }
    });
  });
});
