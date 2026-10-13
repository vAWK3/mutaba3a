import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { db } from '../../db/database';
import { businessProfileRepo } from '../../db/repository';
import { useDrawerStore } from '../../lib/stores';
import { ConversionDrawer } from '../drawers/ConversionDrawer';
import { LanguageProvider } from '../../lib/i18n';

// userEvent + a real Dexie db round-trip take longer under full-suite CPU
// contention than alone; the 5 s default turns that load into failures (TD-073).
vi.setConfig({ testTimeout: 15_000 });

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

function renderDrawer() {
  return render(
    <TestWrapper>
      <ConversionDrawer />
    </TestWrapper>
  );
}

const fromAmountInput = () => screen.getByLabelText(/^From amount/) as HTMLInputElement;
const fromCurrencySelect = () => screen.getByLabelText(/^From currency/) as HTMLSelectElement;
const toAmountInput = () => screen.getByLabelText(/^To amount/) as HTMLInputElement;
const toCurrencySelect = () => screen.getByLabelText(/^To currency/) as HTMLSelectElement;
const saveButton = () => screen.getByRole('button', { name: /save/i });

describe('ConversionDrawer', () => {
  let testProfileId: string;

  beforeEach(async () => {
    await db.transactions.clear();
    await db.businessProfiles.clear();

    const profile = await businessProfileRepo.create({ name: 'Test Profile', defaultCurrency: 'USD' });
    testProfileId = profile.id;

    useDrawerStore.setState({
      conversionDrawer: { isOpen: true, mode: 'create', defaultProfileId: testProfileId },
    });
  });

  afterEach(async () => {
    await db.transactions.clear();
    await db.businessProfiles.clear();
    useDrawerStore.setState({ conversionDrawer: { isOpen: false, mode: 'create' } });
  });

  it('creates a conversion row with both currency pairs and status paid', async () => {
    const user = userEvent.setup();
    renderDrawer();

    await screen.findByText('Log Conversion');
    await user.type(fromAmountInput(), '500');
    await user.selectOptions(fromCurrencySelect(), 'JOD');
    await user.type(toAmountInput(), '704.50');
    await user.selectOptions(toCurrencySelect(), 'USD');

    await user.click(saveButton());

    await waitFor(async () => {
      const rows = await db.transactions.toArray();
      expect(rows).toHaveLength(1);
    });

    const [row] = await db.transactions.toArray();
    expect(row.kind).toBe('conversion');
    expect(row.status).toBe('paid');
    expect(row.currency).toBe('JOD');
    expect(row.amountMinor).toBe(500000); // 500.000 JOD at 3 decimals
    expect(row.toCurrency).toBe('USD');
    expect(row.toAmountMinor).toBe(70450); // 704.50 USD at 2 decimals
    expect(row.profileId).toBe(testProfileId);
  });

  it('shows the implied rate once both amounts are valid', async () => {
    const user = userEvent.setup();
    renderDrawer();

    await screen.findByText('Log Conversion');
    await user.type(fromAmountInput(), '500');
    await user.selectOptions(fromCurrencySelect(), 'JOD');
    await user.type(toAmountInput(), '704.50');
    await user.selectOptions(toCurrencySelect(), 'USD');

    expect(await screen.findByText(/Rate: 1 JOD = 1\.4090 USD/)).toBeInTheDocument();
  });

  it('rejects converting a currency to itself', async () => {
    const user = userEvent.setup();
    renderDrawer();

    await screen.findByText('Log Conversion');
    await user.type(fromAmountInput(), '100');
    await user.selectOptions(fromCurrencySelect(), 'USD');
    await user.type(toAmountInput(), '100');
    await user.selectOptions(toCurrencySelect(), 'USD');

    await user.click(saveButton());

    expect(await screen.findByText('Choose a different currency to convert to')).toBeInTheDocument();
    expect(await db.transactions.count()).toBe(0);
  });

  it('loads an existing conversion in edit mode and re-saves it', async () => {
    const user = userEvent.setup();
    const { transactionRepo } = await import('../../db/repository');
    const existing = await transactionRepo.create({
      kind: 'conversion',
      status: 'paid',
      amountMinor: 500000,
      currency: 'JOD',
      toAmountMinor: 70450,
      toCurrency: 'USD',
      occurredAt: '2024-01-15T00:00:00.000Z',
      profileId: testProfileId,
      notes: 'Moved savings',
    });

    useDrawerStore.setState({
      conversionDrawer: { isOpen: true, mode: 'edit', transactionId: existing.id },
    });
    renderDrawer();

    await screen.findByText('Edit Conversion');
    expect(await screen.findByDisplayValue('500')).toBeInTheDocument();
    expect(await screen.findByDisplayValue('704.50')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Moved savings')).toBeInTheDocument();

    await user.click(saveButton());

    await waitFor(async () => {
      const row = await db.transactions.get(existing.id);
      expect(row?.notes).toBe('Moved savings');
    });
  });
});
