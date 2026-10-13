import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { db } from '../../../db/database';
import { businessProfileRepo, transactionRepo } from '../../../db/repository';
import { useDrawerStore } from '../../../lib/stores';
import { ConversionsPage } from '../ConversionsPage';
import { LanguageProvider } from '../../../lib/i18n';
import { todayISO } from '../../../lib/utils';

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

function renderPage() {
  return render(
    <TestWrapper>
      <ConversionsPage />
    </TestWrapper>
  );
}

describe('ConversionsPage', () => {
  let testProfileId: string;

  beforeEach(async () => {
    await db.transactions.clear();
    await db.businessProfiles.clear();
    const profile = await businessProfileRepo.create({ name: 'Test Profile', defaultCurrency: 'USD' });
    testProfileId = profile.id;
  });

  afterEach(async () => {
    await db.transactions.clear();
    await db.businessProfiles.clear();
    useDrawerStore.setState({ conversionDrawer: { isOpen: false, mode: 'create' } });
  });

  it('shows the empty state with no conversions logged', async () => {
    renderPage();
    expect(await screen.findByText('No conversions logged yet')).toBeInTheDocument();
  });

  it('renders a row with both currency amounts and the implied rate', async () => {
    // 500 JOD -> 704.50 USD: an implied rate of 1.4090
    await transactionRepo.create({
      kind: 'conversion',
      status: 'paid',
      amountMinor: 500000,
      currency: 'JOD',
      toAmountMinor: 70450,
      toCurrency: 'USD',
      occurredAt: `${todayISO()}T00:00:00.000Z`,
      profileId: testProfileId,
      notes: 'Moved savings',
    });

    renderPage();

    expect(await screen.findByText('JOD 500')).toBeInTheDocument();
    expect(await screen.findByText('$704.5')).toBeInTheDocument();
    expect(screen.getByText('1.4090')).toBeInTheDocument();
    expect(screen.getByText('Moved savings')).toBeInTheDocument();
  });

  it('excludes a conversion outside the default this-month range', async () => {
    await transactionRepo.create({
      kind: 'conversion',
      status: 'paid',
      amountMinor: 500000,
      currency: 'JOD',
      toAmountMinor: 70450,
      toCurrency: 'USD',
      occurredAt: '2020-01-01T00:00:00.000Z',
      profileId: testProfileId,
    });

    renderPage();

    expect(await screen.findByText('No conversions logged yet')).toBeInTheDocument();
  });

  it('filters by search text', async () => {
    const user = userEvent.setup();
    await transactionRepo.create({
      kind: 'conversion', status: 'paid', amountMinor: 500000, currency: 'JOD',
      toAmountMinor: 70450, toCurrency: 'USD', occurredAt: `${todayISO()}T00:00:00.000Z`,
      profileId: testProfileId, notes: 'Rent transfer',
    });
    await transactionRepo.create({
      kind: 'conversion', status: 'paid', amountMinor: 10000, currency: 'USD',
      toAmountMinor: 9100, toCurrency: 'EUR', occurredAt: `${todayISO()}T00:00:00.000Z`,
      profileId: testProfileId, notes: 'Savings move',
    });

    renderPage();
    await screen.findByText('Rent transfer');
    expect(screen.getByText('Savings move')).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('Search transactions...'), 'Rent');

    await waitFor(() => expect(screen.queryByText('Savings move')).not.toBeInTheDocument());
    expect(await screen.findByText('Rent transfer')).toBeInTheDocument();
  });

  it('opens the edit drawer on row click', async () => {
    const user = userEvent.setup();
    const existing = await transactionRepo.create({
      kind: 'conversion', status: 'paid', amountMinor: 500000, currency: 'JOD',
      toAmountMinor: 70450, toCurrency: 'USD', occurredAt: `${todayISO()}T00:00:00.000Z`,
      profileId: testProfileId,
    });

    renderPage();
    const row = await screen.findByText('JOD 500');
    await user.click(row);

    expect(useDrawerStore.getState().conversionDrawer).toMatchObject({
      isOpen: true,
      mode: 'edit',
      transactionId: existing.id,
    });
  });
});
