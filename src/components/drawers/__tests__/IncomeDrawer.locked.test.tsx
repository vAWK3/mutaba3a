/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { db } from '../../../db/database';
import { getRepositories, setRepositories, resetRepositories, type Repositories } from '../../../db/provider';
import { DEFAULT_SETTINGS } from '../../../db/defaultSettings';
import { useDrawerStore } from '../../../lib/stores';
import { LanguageProvider } from '../../../lib/i18n';
import type { Settings } from '../../../types';
import { IncomeDrawer } from '../IncomeDrawer';

const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

const now = new Date().toISOString();

function installFakeSettings(initial: Partial<Settings> = {}) {
  const row: Settings = { ...DEFAULT_SETTINGS, ...initial };
  const settings = { get: vi.fn(async () => ({ ...row })), update: vi.fn(async () => {}) };
  const real = getRepositories();
  setRepositories({ ...real, base: { ...real.base, settings } } as Repositories);
  return settings;
}

function Wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>{children}</LanguageProvider>
    </QueryClientProvider>
  );
}

async function seedLockedTransaction() {
  await db.businessProfiles.add({ id: 'p1', name: 'Studio', isDefault: true, createdAt: now } as never);
  await db.clients.add({ id: 'c1', name: 'Acme', createdAt: now, updatedAt: now } as never);
  await db.documents.add({
    id: 'doc-1',
    number: 'INV-0007',
    type: 'invoice',
    status: 'sent',
    businessProfileId: 'p1',
    clientId: 'c1',
    createdAt: now,
    updatedAt: now,
    lockedAt: now,
  } as never);
  await db.transactions.add({
    id: 'tx-locked',
    kind: 'income',
    status: 'unpaid',
    amountMinor: 50000,
    currency: 'USD',
    occurredAt: '2026-10-01',
    clientId: 'c1',
    profileId: 'p1',
    title: 'Design sprint',
    lockedAt: now,
    lockedByDocumentId: 'doc-1',
    linkedDocumentId: 'doc-1',
    createdAt: now,
    updatedAt: now,
  } as never);
  await db.transactions.add({
    id: 'tx-open',
    kind: 'income',
    status: 'unpaid',
    amountMinor: 10000,
    currency: 'USD',
    occurredAt: '2026-10-02',
    clientId: 'c1',
    profileId: 'p1',
    title: 'Open entry',
    createdAt: now,
    updatedAt: now,
  } as never);
}

async function clearAll() {
  await Promise.all([db.transactions.clear(), db.documents.clear(), db.clients.clear(), db.businessProfiles.clear(), db.settings.clear()]);
}

function openEdit(transactionId: string) {
  useDrawerStore.setState((state) => ({
    incomeDrawer: { ...state.incomeDrawer, isOpen: true, mode: 'edit', transactionId },
  }));
}

beforeEach(async () => {
  await clearAll();
  await seedLockedTransaction();
  mockNavigate.mockClear();
});

afterEach(async () => {
  resetRepositories();
  useDrawerStore.getState().closeIncomeDrawer();
  await clearAll();
});

describe('IncomeDrawer on a document-locked entry (MUT-13)', () => {
  it('with invoices off: explains the lock, names the document, points at Settings, and disables Save and Delete', async () => {
    installFakeSettings();
    openEdit('tx-locked');
    render(<IncomeDrawer />, { wrapper: Wrapper });

    const notice = await screen.findByTestId('income-locked-notice');
    await waitFor(() => expect(notice).toHaveTextContent('INV-0007'));
    expect(notice).toHaveTextContent(/Settings/);
    expect(screen.queryByRole('button', { name: /View document/i })).toBeNull();

    expect(screen.getByRole('button', { name: /^Save$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Delete$/i })).toBeDisabled();
  });

  it('with invoices on: offers to open the document, which closes the drawer and navigates', async () => {
    installFakeSettings({ features: { invoices: true } });
    openEdit('tx-locked');
    render(<IncomeDrawer />, { wrapper: Wrapper });

    const view = await screen.findByRole('button', { name: /View document/i });
    expect(screen.getByRole('button', { name: /^Save$/i })).toBeDisabled();

    fireEvent.click(view);
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/documents/$documentId', params: { documentId: 'doc-1' } });
    expect(useDrawerStore.getState().incomeDrawer.isOpen).toBe(false);
  });

  it('shows nothing on an unlocked entry and keeps Save enabled', async () => {
    installFakeSettings({ features: { invoices: true } });
    openEdit('tx-open');
    render(<IncomeDrawer />, { wrapper: Wrapper });

    await waitFor(() => expect(screen.getByRole('button', { name: /^Save$/i })).toBeEnabled());
    expect(screen.queryByTestId('income-locked-notice')).toBeNull();
  });

  it('the repository still refuses an edit on a locked entry regardless of the flag', async () => {
    const { transactionRepo } = await import('../../../db/repository');
    await expect(transactionRepo.update('tx-locked', { title: 'Changed' })).rejects.toThrow(/locked/i);
    await expect(transactionRepo.update('tx-locked', { archivedAt: now })).resolves.toBeUndefined();
  });
});
