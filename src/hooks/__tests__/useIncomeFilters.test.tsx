/**
 * @vitest-environment jsdom
 *
 * MUT-83: /income's filters live in the URL as one object, written with
 * `replace` so filter changes never pile up in the browser history.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from '@tanstack/react-router';
import { useIncomeFilters } from '../useIncomeFilters';
import { parseIncomeSearch, type IncomeSearch } from '../../lib/incomeSearch';

let setSearch: (patch: Partial<IncomeSearch>) => void = () => {};

function Probe() {
  const filters = useIncomeFilters();
  setSearch = filters.setSearch;
  return <output data-testid="search">{JSON.stringify(filters.search)}</output>;
}

function renderAt(url: string) {
  const rootRoute = createRootRoute({ component: Outlet });
  const incomeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/income',
    validateSearch: parseIncomeSearch,
    component: Probe,
  });
  const history = createMemoryHistory({ initialEntries: [url] });
  const router = createRouter({ routeTree: rootRoute.addChildren([incomeRoute]), history });
  render(<RouterProvider router={router} />);
  return { router, history };
}

const shown = () => JSON.parse(screen.getByTestId('search').textContent ?? '{}');

describe('useIncomeFilters', () => {
  it('reads the filters from the URL', async () => {
    renderAt('/income?client=none&status=unpaid&dateFrom=2000-01-01&dateTo=2100-12-31');

    await screen.findByTestId('search');
    expect(shown()).toEqual({ client: 'none', status: 'unpaid', dateFrom: '2000-01-01', dateTo: '2100-12-31' });
  });

  it('writes a change into the URL, keeping the other filters, without adding a history entry', async () => {
    const { router, history } = renderAt('/income?client=archived');
    await screen.findByTestId('search');
    const entriesBefore = history.length;

    await act(async () => setSearch({ status: 'overdue' }));

    expect(router.state.location.search).toEqual({ client: 'archived', status: 'overdue' });
    expect(shown()).toEqual({ client: 'archived', status: 'overdue' });
    expect(history.length).toBe(entriesBefore);
  });

  it('drops a cleared filter from the URL', async () => {
    const { router } = renderAt('/income?client=none&q=acme');
    await screen.findByTestId('search');

    await act(async () => setSearch({ client: undefined }));

    expect(router.state.location.search).toEqual({ q: 'acme' });
  });
});
