/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { db } from '../../../db/database';
import { useDrawerStore } from '../../../lib/stores';
import { LanguageProvider } from '../../../lib/i18n';
import { IncomeDrawer } from '../IncomeDrawer';

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

const now = new Date().toISOString();

function Wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>{children}</LanguageProvider>
    </QueryClientProvider>
  );
}

// An entry an exported document locked before MUT-145. The lock fields stay
// in the row (no rewrite, ADR-029); nothing reads them any more.
async function seedLegacyLockedEntry() {
  await db.businessProfiles.add({ id: 'p1', name: 'Studio', isDefault: true, createdAt: now } as never);
  await db.clients.add({ id: 'c1', name: 'Acme', createdAt: now, updatedAt: now } as never);
  await db.transactions.add({
    id: 'tx-legacy',
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
}

async function clearAll() {
  await Promise.all([db.transactions.clear(), db.clients.clear(), db.businessProfiles.clear(), db.settings.clear()]);
}

beforeEach(async () => {
  await clearAll();
  await seedLegacyLockedEntry();
});

afterEach(async () => {
  useDrawerStore.getState().closeIncomeDrawer();
  await clearAll();
});

describe('IncomeDrawer on an entry a document once locked (MUT-145)', () => {
  it('opens fully editable: no locked notice, Save and Delete enabled', async () => {
    useDrawerStore.setState((state) => ({
      incomeDrawer: { ...state.incomeDrawer, isOpen: true, mode: 'edit', transactionId: 'tx-legacy' },
    }));
    render(<IncomeDrawer />, { wrapper: Wrapper });

    await waitFor(() => expect(screen.getByRole('button', { name: /^Save$/i })).toBeEnabled());
    expect(screen.getByRole('button', { name: /^Delete$/i })).toBeEnabled();
    expect(screen.queryByTestId('income-locked-notice')).toBeNull();
  });

  it('saves an edit to the entry', async () => {
    useDrawerStore.setState((state) => ({
      incomeDrawer: { ...state.incomeDrawer, isOpen: true, mode: 'edit', transactionId: 'tx-legacy' },
    }));
    render(<IncomeDrawer />, { wrapper: Wrapper });

    const title = (await waitFor(() => {
      const input = document.querySelector('input[name="title"]') as HTMLInputElement | null;
      expect(input?.value).toBe('Design sprint');
      return input as HTMLInputElement;
    }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^Save$/i })).toBeEnabled());
    fireEvent.change(title, { target: { value: 'Design sprint, round 2' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));

    await waitFor(async () => expect((await db.transactions.get('tx-legacy'))?.title).toBe('Design sprint, round 2'));
  });
});
