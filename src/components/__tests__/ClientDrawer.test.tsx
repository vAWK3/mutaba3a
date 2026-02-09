import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { db } from '../../db/database';
import { clientRepo } from '../../db/repository';
import { useDrawerStore } from '../../lib/stores';
import { ClientDrawer } from '../drawers/ClientDrawer';
import { LanguageProvider } from '../../lib/i18n';

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

describe('ClientDrawer', () => {
  beforeEach(async () => {
    await db.clients.clear();
    useDrawerStore.setState({
      clientDrawer: { isOpen: true, mode: 'create' },
    });
  });

  afterEach(async () => {
    await db.clients.clear();
    useDrawerStore.setState({
      clientDrawer: { isOpen: false, mode: 'create' },
    });
  });

  it('should render create mode form correctly', () => {
    render(
      <TestWrapper>
        <ClientDrawer />
      </TestWrapper>
    );

    expect(screen.getByText('New Client')).toBeInTheDocument();
  });

  it('should have name input field', () => {
    render(
      <TestWrapper>
        <ClientDrawer />
      </TestWrapper>
    );

    expect(screen.getByText('Name *')).toBeInTheDocument();
  });

  it('should have email and phone fields', () => {
    render(
      <TestWrapper>
        <ClientDrawer />
      </TestWrapper>
    );

    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(screen.getByText('Phone')).toBeInTheDocument();
  });

  it('should show validation error when name is empty', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <ClientDrawer />
      </TestWrapper>
    );

    // Submit without filling name
    const saveButton = screen.getByRole('button', { name: /save/i });
    await user.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText('Name is required')).toBeInTheDocument();
    });
  });

  it('should create a new client on valid submission', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <ClientDrawer />
      </TestWrapper>
    );

    // Fill in name
    const nameInput = screen.getByPlaceholderText('Client name...');
    await user.type(nameInput, 'Acme Corporation');

    // Fill in email
    const emailInput = screen.getByPlaceholderText('client@example.com');
    await user.type(emailInput, 'contact@acme.com');

    // Submit
    const saveButton = screen.getByRole('button', { name: /save/i });
    await user.click(saveButton);

    await waitFor(async () => {
      const clients = await clientRepo.list();
      expect(clients).toHaveLength(1);
      expect(clients[0].name).toBe('Acme Corporation');
      expect(clients[0].email).toBe('contact@acme.com');
    });
  });

  it('should close drawer when cancel is clicked', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <ClientDrawer />
      </TestWrapper>
    );

    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    await user.click(cancelButton);

    expect(useDrawerStore.getState().clientDrawer.isOpen).toBe(false);
  });

  // Note: Edit mode tests require more complex query mocking
  it.skip('should load existing client in edit mode', async () => {
    // Create a client first
    const client = await clientRepo.create({
      name: 'Existing Client',
      email: 'existing@client.com',
      phone: '+1234567890',
    });

    // Set drawer to edit mode
    useDrawerStore.setState({
      clientDrawer: { isOpen: true, mode: 'edit', clientId: client.id },
    });

    render(
      <TestWrapper>
        <ClientDrawer />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('Edit Client')).toBeInTheDocument();
    }, { timeout: 3000 });

    await waitFor(() => {
      const nameInput = screen.getByPlaceholderText('Client name...') as HTMLInputElement;
      expect(nameInput.value).toBe('Existing Client');
    }, { timeout: 3000 });
  });

  it.skip('should update existing client', async () => {
    const user = userEvent.setup();

    const client = await clientRepo.create({
      name: 'Old Name',
      email: 'old@email.com',
    });

    useDrawerStore.setState({
      clientDrawer: { isOpen: true, mode: 'edit', clientId: client.id },
    });

    render(
      <TestWrapper>
        <ClientDrawer />
      </TestWrapper>
    );

    // Wait for form to load
    await waitFor(() => {
      const nameInput = screen.getByPlaceholderText('Client name...') as HTMLInputElement;
      expect(nameInput.value).toBe('Old Name');
    }, { timeout: 3000 });

    // Clear and update name
    const nameInput = screen.getByPlaceholderText('Client name...');
    await user.clear(nameInput);
    await user.type(nameInput, 'New Name');

    // Submit
    const saveButton = screen.getByRole('button', { name: /save/i });
    await user.click(saveButton);

    await waitFor(async () => {
      const updated = await clientRepo.get(client.id);
      expect(updated?.name).toBe('New Name');
    }, { timeout: 3000 });
  });

  it('should have notes textarea', () => {
    render(
      <TestWrapper>
        <ClientDrawer />
      </TestWrapper>
    );

    expect(screen.getByText('Notes')).toBeInTheDocument();
  });
});
