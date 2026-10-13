import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { ORG_A, emptyProfileRoutes, locationOf, me, ok, profile, renderPortal, stubApi, type Handler } from '../../__tests__/harness';
import { PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';
import { page } from './fixtures';

/** MUT-161: the conversions list and the create-only drawer it opens. */

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
});
afterEach(() => vi.unstubAllGlobals());

function conversion(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    occurredOn: '2026-10-01',
    amount: '100.00',
    currency: 'USD',
    toAmount: '365.00',
    toCurrency: 'ILS',
    notes: null,
    createdByUserId: 'u1',
    createdAt: '',
    ...overrides,
  };
}

function portal(path: string, routes: Record<string, Handler> = {}) {
  const api = stubApi({
    'GET /v1/me': () => ok(me([profile()])),
    ...emptyProfileRoutes(),
    'GET /v1/conversions': () => ok(page([])),
    ...routes,
  });
  return { ...renderPortal(path), api };
}

describe('ConversionsList', () => {
  it('lists conversions with date, from/to amounts and notes', async () => {
    portal(`/p/${ORG_A}/conversions`, { 'GET /v1/conversions': () => ok(page([conversion({ notes: 'Transferred to ILS account' })])) });
    const table = await screen.findByRole('table', { name: 'Conversions' });
    const row = within(table).getAllByRole('row')[1];
    expect(row).toHaveTextContent('$100.00');
    expect(row).toHaveTextContent('₪365.00');
    expect(row).toHaveTextContent('Transferred to ILS account');
  });

  it('shows an empty state with a "Log conversion" action when there are none', async () => {
    portal(`/p/${ORG_A}/conversions`);
    expect(await screen.findByText('No conversions logged on this profile yet')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Log conversion' }).length).toBeGreaterThan(0);
  });

  it('opens the drawer via the header button and sets ?newConversion=1', async () => {
    const { user, router } = portal(`/p/${ORG_A}/conversions`);
    await screen.findByText('No conversions logged on this profile yet');
    await user.click(screen.getAllByRole('button', { name: 'Log conversion' })[0]);
    expect(await screen.findByText('Log conversion', { selector: '.drawer-title' })).toBeInTheDocument();
    expect(locationOf(router)).toContain('newConversion=true');
  });

  it('does not refetch the list when the drawer opens or closes', async () => {
    const { user, api } = portal(`/p/${ORG_A}/conversions`, { 'GET /v1/conversions': () => ok(page([conversion()])) });
    await screen.findByText('$100.00');
    const before = api.count('GET /v1/conversions');
    expect(before).toBeGreaterThan(0);

    await user.click(screen.getAllByRole('button', { name: 'Log conversion' })[0]);
    await screen.findByText('Log conversion', { selector: '.drawer-title' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByText('Log conversion', { selector: '.drawer-title' })).not.toBeInTheDocument());

    expect(api.count('GET /v1/conversions')).toBe(before);
  });

  it('clears the drawer search params on close', async () => {
    const { user, router } = portal(`/p/${ORG_A}/conversions`);
    await screen.findByText('No conversions logged on this profile yet');
    await user.click(screen.getAllByRole('button', { name: 'Log conversion' })[0]);
    await screen.findByText('Log conversion', { selector: '.drawer-title' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(locationOf(router)).not.toContain('newConversion'));
  });

  it('has no row click — there is nothing to edit', async () => {
    portal(`/p/${ORG_A}/conversions`, { 'GET /v1/conversions': () => ok(page([conversion()])) });
    const table = await screen.findByRole('table', { name: 'Conversions' });
    const row = within(table).getAllByRole('row')[1]!;
    expect(row.className).not.toContain('clickable');
  });

  it('has a Conversions entry in the sidebar nav', async () => {
    portal(`/p/${ORG_A}`);
    expect(await screen.findByRole('link', { name: 'Conversions' })).toBeInTheDocument();
  });
});
