import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { db } from '../../db/database';
import { businessProfileRepo, settingsRepo } from '../../db/repository';
import { useDrawerStore } from '../../lib/stores';
import { RetainerDrawer } from '../drawers/RetainerDrawer';
import { LanguageProvider } from '../../lib/i18n';

/**
 * MUT-16 (review #2): the retainer drawer's optional project picker follows
 * the Projects switch like the income and expense drawers do.
 */
const PROJECT_LABEL = 'Project (optional)';

function TestWrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>{children}</LanguageProvider>
    </QueryClientProvider>
  );
}

async function clearAll() {
  await db.retainerAgreements.clear();
  await db.businessProfiles.clear();
  await db.settings.clear();
}

describe('RetainerDrawer — Projects area switch (MUT-16)', () => {
  beforeEach(async () => {
    await clearAll();
    const profile = await businessProfileRepo.create({ name: 'Test Profile', defaultCurrency: 'USD' });
    useDrawerStore.setState({
      retainerDrawer: { isOpen: true, mode: 'create', defaultProfileId: profile.id },
    });
  });

  afterEach(async () => {
    await clearAll();
    useDrawerStore.setState({ retainerDrawer: { isOpen: false, mode: 'create' } });
  });

  it('renders no project picker while projects is off', async () => {
    render(
      <TestWrapper>
        <RetainerDrawer />
      </TestWrapper>
    );

    await screen.findByText('New Retainer');
    await waitFor(() => expect(screen.getAllByRole('textbox').length).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.queryByText(PROJECT_LABEL)).not.toBeInTheDocument();
  });

  it('renders the project picker while projects is on', async () => {
    await settingsRepo.update({ features: { projects: true } });

    render(
      <TestWrapper>
        <RetainerDrawer />
      </TestWrapper>
    );

    expect(await screen.findByText(PROJECT_LABEL)).toBeInTheDocument();
  });
});
