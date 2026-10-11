/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
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
import { getRepositories, setRepositories, resetRepositories, type Repositories } from '../../../db/provider';
import { DEFAULT_SETTINGS } from '../../../db/defaultSettings';
import type { Settings } from '../../../types';
import { requireFeature, useLeaveDisabledArea } from '../routeGuard';

/**
 * MUT-15 AC 4: a user on a page whose area is switched off lands on Home.
 * A real router (memory history) and the real `requireFeature` guard, so the
 * test proves the hook re-runs the guards the app already has rather than a
 * copy of them.
 */

function installFakeSettings(initial: Partial<Settings> = {}) {
  let row: Settings = { ...DEFAULT_SETTINGS, ...initial };
  const settings = {
    get: vi.fn(async () => ({ ...row })),
    update: vi.fn(async (data: Partial<Settings>) => {
      row = { ...row, ...data, id: 'default' };
    }),
  };
  const real = getRepositories();
  setRepositories({ ...real, base: { ...real.base, settings } } as Repositories);
  return { set: (next: Partial<Settings>) => { row = { ...row, ...next }; } };
}

function Root() {
  useLeaveDisabledArea();
  return <Outlet />;
}

function buildRouter(initialPath: string) {
  const root = createRootRoute({ component: Root });
  const home = createRoute({ getParentRoute: () => root, path: '/', component: () => <p>home page</p> });
  const income = createRoute({ getParentRoute: () => root, path: '/income', component: () => <p>income page</p> });
  const expenses = createRoute({
    getParentRoute: () => root,
    path: '/expenses',
    beforeLoad: requireFeature('expenses'),
    component: () => <p>expenses page</p>,
  });
  return createRouter({
    routeTree: root.addChildren([home, income, expenses]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
}

async function renderAt(path: string, pageText: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const router = buildRouter(path);
  // spied before the first render, so a call during the first load would count
  const invalidate = vi.spyOn(router, 'invalidate');
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  expect(await screen.findByText(pageText)).toBeInTheDocument();
  // let the settings query resolve so the hook has seen the first flags
  await waitFor(() => expect(queryClient.getQueryState(['settings'])?.status).toBe('success'));
  return { router, queryClient, invalidate };
}

async function settingsChanged(queryClient: QueryClient) {
  await act(async () => {
    await queryClient.invalidateQueries({ queryKey: ['settings'] });
  });
}

afterEach(() => {
  resetRepositories();
  vi.restoreAllMocks();
});

describe('useLeaveDisabledArea (MUT-15)', () => {
  it('moves the user home, replacing the entry, when the open page loses its area', async () => {
    const fake = installFakeSettings({ features: { expenses: true } });
    const { router, queryClient, invalidate } = await renderAt('/expenses', 'expenses page');

    fake.set({ features: { expenses: false } });
    await settingsChanged(queryClient);

    expect(await screen.findByText('home page')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    expect(invalidate).toHaveBeenCalledTimes(1);
    // replace, so Back cannot return to the dead page
    expect(router.history.length).toBe(1);
  });

  it('leaves a core page alone when an area is switched off', async () => {
    const fake = installFakeSettings({ features: { expenses: true } });
    const { router, queryClient } = await renderAt('/income', 'income page');

    fake.set({ features: { expenses: false } });
    await settingsChanged(queryClient);

    await waitFor(() => expect(router.state.status).toBe('idle'));
    expect(router.state.location.pathname).toBe('/income');
    expect(screen.getByText('income page')).toBeInTheDocument();
  });

  it('keeps the page when a different area is switched off (the guard re-runs and admits)', async () => {
    const fake = installFakeSettings({ features: { expenses: true, invoices: true } });
    const { router, queryClient, invalidate } = await renderAt('/expenses', 'expenses page');

    fake.set({ features: { expenses: true, invoices: false } });
    await settingsChanged(queryClient);

    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(router.state.status).toBe('idle'));
    expect(router.state.location.pathname).toBe('/expenses');
    expect(screen.getByText('expenses page')).toBeInTheDocument();
  });

  it('does not touch the router when an area is switched on', async () => {
    const fake = installFakeSettings({ features: { expenses: true } });
    const { queryClient, invalidate } = await renderAt('/expenses', 'expenses page');

    fake.set({ features: { expenses: true, projects: true } });
    await settingsChanged(queryClient);
    await waitFor(() => expect(queryClient.getQueryData<Settings>(['settings'])?.features?.projects).toBe(true));

    expect(invalidate).not.toHaveBeenCalled();
  });

  it('does not touch the router for a settings change that is not about areas', async () => {
    const fake = installFakeSettings({ features: { expenses: true } });
    const { queryClient, invalidate } = await renderAt('/expenses', 'expenses page');

    fake.set({ defaultCurrency: 'ILS' });
    await settingsChanged(queryClient);
    await waitFor(() => expect(queryClient.getQueryData<Settings>(['settings'])?.defaultCurrency).toBe('ILS'));

    expect(invalidate).not.toHaveBeenCalled();
  });

  it('does not treat the first load (flags read off while loading) as a switch-off', async () => {
    installFakeSettings({ features: { expenses: true } });
    const { router, invalidate } = await renderAt('/expenses', 'expenses page');

    expect(invalidate).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe('/expenses');
  });
});
