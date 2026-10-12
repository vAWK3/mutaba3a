/**
 * @vitest-environment jsdom
 *
 * MUT-84: the Clients list's search and sort live in the URL as one object,
 * on the list and on a client's URL alike, written with `replace` so a sort
 * or a keystroke never piles up in the browser history.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from '@tanstack/react-router';
import { useClientsSearch } from '../useClientsSearch';
import { parseClientsSearch } from '../clientsSearch';

function Probe() {
  const { search, setSearch } = useClientsSearch();
  return (
    <>
      <output data-testid="search">{JSON.stringify(search)}</output>
      <button onClick={() => setSearch({ sort: 'name', dir: 'asc' })}>by name</button>
      <button onClick={() => setSearch({ q: '' })}>clear search</button>
      <button onClick={() => setSearch({ sort: 'owed', dir: 'desc' })}>default sort</button>
    </>
  );
}

function renderAt(url: string) {
  const rootRoute = createRootRoute({ component: Outlet });
  const clientsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/clients',
    validateSearch: parseClientsSearch,
    component: Probe,
  });
  const indexRoute = createRoute({ getParentRoute: () => clientsRoute, path: '/' });
  const detailRoute = createRoute({ getParentRoute: () => clientsRoute, path: '$clientId' });
  const history = createMemoryHistory({ initialEntries: [url] });
  const router = createRouter({
    routeTree: rootRoute.addChildren([clientsRoute.addChildren([indexRoute, detailRoute])]),
    history,
  });
  render(<RouterProvider router={router} />);
  return { router, history };
}

const shown = () => JSON.parse(screen.getByTestId('search').textContent ?? '{}');

describe('useClientsSearch', () => {
  it('reads the search and sort from the URL', async () => {
    renderAt('/clients?q=acme&sort=lastPayment&dir=asc');

    await screen.findByTestId('search');
    expect(shown()).toEqual({ q: 'acme', sort: 'lastPayment', dir: 'asc' });
  });

  it('writes a change on the list without adding a history entry, keeping the search', async () => {
    const { router, history } = renderAt('/clients?q=acme');
    await screen.findByTestId('search');
    const entriesBefore = history.length;

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'by name' })));

    expect(router.state.location.pathname).toBe('/clients');
    expect(router.state.location.search).toEqual({ q: 'acme', sort: 'name', dir: 'asc' });
    expect(shown()).toEqual({ q: 'acme', sort: 'name', dir: 'asc' });
    expect(history.length).toBe(entriesBefore);
  });

  it('writes on a client URL too, and stays on that client', async () => {
    const { router, history } = renderAt('/clients/acme?q=ac');
    await screen.findByTestId('search');
    const entriesBefore = history.length;

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'by name' })));

    expect(router.state.location.pathname).toBe('/clients/acme');
    expect(router.state.location.search).toEqual({ q: 'ac', sort: 'name', dir: 'asc' });
    expect(history.length).toBe(entriesBefore);
  });

  it('removes a cleared search and a default sort from the URL', async () => {
    const { router } = renderAt('/clients?q=acme&sort=name&dir=asc');
    await screen.findByTestId('search');

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'clear search' })));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'default sort' })));

    expect(router.state.location.search).toEqual({});
  });
});
