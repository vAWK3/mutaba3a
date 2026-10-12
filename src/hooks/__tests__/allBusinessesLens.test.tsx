/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { db } from '../../db/database';
import { useProfileStore } from '../../lib/profileStore';
import { useOwedScreenSync, useOwedLens, useProfileFilter, useActiveProfile } from '../useActiveProfile';
import type { BusinessProfile } from '../../types';

/**
 * MUT-89 AC3 with a real router (memory history), real stores and the real
 * profiles query: "All businesses" applies to the owed screens only. With it
 * on, Home reads every business, Income receives the working business, and
 * coming back to Home brings All back (O1, sticky).
 */

const STAMP = '2026-09-01T00:00:00.000Z';
const business = (id: string, name: string, isDefault = false): BusinessProfile => ({
  id,
  name,
  isDefault,
  createdAt: STAMP,
  updatedAt: STAMP,
});

function Root() {
  useOwedScreenSync();
  const { isAllProfiles, showAllProfilesOption } = useActiveProfile();
  return (
    <>
      <p>
        chrome: {isAllProfiles ? 'all' : 'one'} / option {showAllProfilesOption ? 'shown' : 'hidden'}
      </p>
      <Outlet />
    </>
  );
}

function Home() {
  const { scope } = useOwedLens();
  return <p>home reads {Array.isArray(scope) ? scope.join('+') : String(scope)}</p>;
}

function Income() {
  return <p>income reads {useProfileFilter()}</p>;
}

function buildRouter(initialPath: string) {
  const root = createRootRoute({ component: Root });
  const home = createRoute({ getParentRoute: () => root, path: '/', staticData: { owedLens: true }, component: Home });
  const clients = createRoute({
    getParentRoute: () => root,
    path: '/clients',
    staticData: { owedLens: true },
    component: () => <Outlet />,
  });
  const client = createRoute({ getParentRoute: () => clients, path: '$clientId', component: () => <p>client page</p> });
  const income = createRoute({ getParentRoute: () => root, path: '/income', component: Income });
  return createRouter({
    routeTree: root.addChildren([home, clients.addChildren([client]), income]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const router = buildRouter(path);
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe('All businesses across routes (MUT-89)', () => {
  beforeEach(async () => {
    await db.businessProfiles.clear();
    await db.businessProfiles.bulkAdd([business('studio', 'Studio', true), business('teaching', 'Teaching')]);
    act(() => {
      useProfileStore.getState().reset();
      useProfileStore.getState().setActiveProfile('teaching');
      useProfileStore.getState().setAllBusinesses(true);
    });
  });

  afterEach(async () => {
    await db.businessProfiles.clear();
    act(() => useProfileStore.getState().reset());
  });

  it('Home reads every business, and the chrome says All with the option shown', async () => {
    renderAt('/');
    expect(await screen.findByText('home reads studio+teaching')).toBeInTheDocument();
    expect(screen.getByText('chrome: all / option shown')).toBeInTheDocument();
  });

  it('Income receives the working business, and the chrome offers no All (AC3, O2)', async () => {
    const router = renderAt('/');
    await screen.findByText('home reads studio+teaching');

    await act(() => router.navigate({ to: '/income' }));
    expect(await screen.findByText('income reads teaching')).toBeInTheDocument();
    expect(screen.getByText('chrome: one / option hidden')).toBeInTheDocument();
  });

  it('coming back to Home brings All back (O1)', async () => {
    const router = renderAt('/income');
    await screen.findByText('income reads teaching');

    await act(() => router.navigate({ to: '/' }));
    expect(await screen.findByText('home reads studio+teaching')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('chrome: all / option shown')).toBeInTheDocument());
  });

  it('a client opened under the Clients layout is still an owed screen', async () => {
    renderAt('/clients/acme');
    await screen.findByText('client page');
    await waitFor(() => expect(useProfileStore.getState().onOwedScreen).toBe(true));
  });
});
