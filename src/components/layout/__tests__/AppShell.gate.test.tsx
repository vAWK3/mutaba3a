/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { db } from '../../../db/database';
import { getRepositories, setRepositories, resetRepositories, type Repositories } from '../../../db/provider';
import { AppShell, BusinessesGate } from '../AppShell';
import { LanguageProvider } from '../../../lib/i18n';
import type { BusinessProfile } from '../../../types';

/**
 * MUT-89 D8: no page reads with a blank business. A blank business means
 * "every record" to the repositories, so while the businesses load the
 * routed page is held back, the way AppShell already holds it while the
 * visitor sample is prepared. One gate covers every page.
 */

// AppShell's chrome has its own suites; here only its content slot matters
vi.mock('../SidebarNav', () => ({ SidebarNav: () => null }));
vi.mock('../OrphanedRecordsBanner', () => ({ OrphanedRecordsBanner: () => null }));
vi.mock('../FeatureNoticeBanner', () => ({ FeatureNoticeBanner: () => null }));
vi.mock('../SavedFlashAnnouncer', () => ({ SavedFlashAnnouncer: () => null }));
vi.mock('../../ui/DemoBanner', () => ({ DemoBanner: () => null }));
vi.mock('../../ui/SampleDataBar', () => ({ SampleDataBar: () => null }));
vi.mock('../../ui/UpdateBanner', () => ({ UpdateBanner: () => null }));
vi.mock('../../modals', () => ({
  WelcomeModal: () => null,
  DemoSeedModal: () => null,
  MigrationWizard: () => null,
  WhatsNewModal: () => null,
  WhatsNewController: () => null,
}));
vi.mock('../../../demo/useVisitorSample', () => ({ useVisitorSampleEntry: () => {} }));
vi.mock('../../../lib/features/routeGuard', () => ({ useLeaveDisabledArea: () => {} }));

const STAMP = '2026-09-01T00:00:00.000Z';
const studio: BusinessProfile = { id: 'studio', name: 'Studio', isDefault: true, createdAt: STAMP, updatedAt: STAMP };

function renderGate() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={queryClient}>
      <BusinessesGate>
        <p>the page</p>
      </BusinessesGate>
    </QueryClientProvider>,
  );
}

describe('BusinessesGate', () => {
  beforeEach(async () => {
    await db.businessProfiles.clear();
  });

  afterEach(async () => {
    await db.businessProfiles.clear();
  });

  it('holds the page back until the businesses have loaded, then mounts it', async () => {
    await db.businessProfiles.add(studio);
    renderGate();

    expect(screen.queryByText('the page')).not.toBeInTheDocument();
    expect(await screen.findByText('the page')).toBeInTheDocument();
  });

  it('mounts the page when there is no business yet (D4: before Welcome creates one)', async () => {
    renderGate();
    expect(await screen.findByText('the page')).toBeInTheDocument();
  });
});

describe('AppShell', () => {
  afterEach(() => {
    resetRepositories();
  });

  function renderShell() {
    const root = createRootRoute({
      component: () => (
        <AppShell>
          <Outlet />
        </AppShell>
      ),
    });
    const page = createRoute({ getParentRoute: () => root, path: '/', component: () => <p>the routed page</p> });
    const router = createRouter({
      routeTree: root.addChildren([page]),
      history: createMemoryHistory({ initialEntries: ['/'] }),
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(
      <QueryClientProvider client={queryClient}>
        <LanguageProvider>
          <RouterProvider router={router} />
        </LanguageProvider>
      </QueryClientProvider>
    );
  }

  /** The businesses read never answers, or answers with one business */
  function installBusinesses(answer: 'never' | BusinessProfile[]) {
    const real = getRepositories();
    const pending = () => new Promise<never>(() => {});
    const businessProfiles = {
      ...real.base.businessProfiles,
      list: answer === 'never' ? pending : async () => answer,
      getDefault: answer === 'never' ? pending : async () => answer[0],
    };
    setRepositories({ ...real, base: { ...real.base, businessProfiles } } as Repositories);
  }

  it('routes every page through the businesses gate: no page while they load (D8)', async () => {
    installBusinesses('never');
    renderShell();

    await waitFor(() => expect(document.querySelector('.page-content[aria-busy="true"]')).toBeInTheDocument());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText('the routed page')).not.toBeInTheDocument();
  });

  it('shows the page once the businesses have loaded', async () => {
    installBusinesses([studio]);
    renderShell();

    expect(await screen.findByText('the routed page')).toBeInTheDocument();
  });
});
