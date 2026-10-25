import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { ORG_A, emptyProfileRoutes, locationOf, me, ok, profile, renderPortal, stubApi, type Handler } from '../../__tests__/harness';
import { PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';
import { page } from './fixtures';

/** MUT-161: the conversions list and the drawer it opens; MUT-194 adds the edit drawer, delete and JOD. */

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
    version: 1,
    createdAt: '',
    updatedAt: '',
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

  it('opens the edit drawer by clicking a row, with ?conversion=<id> (MUT-194)', async () => {
    const { user, router } = portal(`/p/${ORG_A}/conversions`, { 'GET /v1/conversions': () => ok(page([conversion()])), 'GET /v1/conversions/c1': () => ok(conversion()) });
    const table = await screen.findByRole('table', { name: 'Conversions' });
    await user.click(within(table).getAllByRole('row')[1]!);
    expect(await screen.findByText('Edit conversion', { selector: '.drawer-title' })).toBeInTheDocument();
    expect(locationOf(router)).toContain('conversion=c1');
    expect((screen.getByLabelText('From amount') as HTMLInputElement).value).toBe('100.00');
  });

  it('opens the edit drawer with Enter on the focused row button (D8/D11)', async () => {
    const { user, router } = portal(`/p/${ORG_A}/conversions`, { 'GET /v1/conversions': () => ok(page([conversion()])), 'GET /v1/conversions/c1': () => ok(conversion()) });
    const table = await screen.findByRole('table', { name: 'Conversions' });
    const rowButton = within(within(table).getAllByRole('row')[1]!).getByRole('button');
    rowButton.focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByText('Edit conversion', { selector: '.drawer-title' })).toBeInTheDocument();
    expect(locationOf(router)).toContain('conversion=c1');
  });

  it('closing the edit drawer clears ?conversion', async () => {
    const { user, router } = portal(`/p/${ORG_A}/conversions?conversion=c0000000-0000-4000-8000-000000000001`, {
      'GET /v1/conversions': () => ok(page([conversion({ id: 'c0000000-0000-4000-8000-000000000001' })])),
      'GET /v1/conversions/c0000000-0000-4000-8000-000000000001': () => ok(conversion({ id: 'c0000000-0000-4000-8000-000000000001' })),
    });
    await screen.findByText('Edit conversion', { selector: '.drawer-title' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(locationOf(router)).not.toContain('conversion='));
  });

  it('deleting the anchored conversion drops the anchor and closes the drawer', async () => {
    const ID = 'c0000000-0000-4000-8000-000000000002';
    vi.stubGlobal('confirm', vi.fn(() => true));
    let deleted = false;
    const { user, router, api } = portal(`/p/${ORG_A}/conversions?anchor=${ID}&conversion=${ID}`, {
      'GET /v1/conversions': () => ok(page(deleted ? [] : [conversion({ id: ID })])),
      [`GET /v1/conversions/${ID}`]: () => ok(conversion({ id: ID })),
      [`DELETE /v1/conversions/${ID}`]: () => {
        deleted = true;
        return new Response(null, { status: 204 });
      },
    });
    await screen.findByText('Edit conversion', { selector: '.drawer-title' });
    await waitFor(() => expect((screen.getByLabelText('From amount') as HTMLInputElement).value).toBe('100.00'));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(locationOf(router)).not.toContain('anchor='));
    expect(locationOf(router)).not.toContain('conversion=');
    expect(api.count(`DELETE /v1/conversions/${ID}`)).toBe(1);
  });

  it('offers JOD in the currency filter (D7, TD-117)', async () => {
    portal(`/p/${ORG_A}/conversions`, { 'GET /v1/conversions': () => ok(page([conversion()])) });
    await screen.findByRole('table', { name: 'Conversions' });
    const filter = screen.getByLabelText('Currency') as HTMLSelectElement;
    expect(Array.from(filter.options).map((o) => o.value)).toContain('JOD');
  });

  it('is one level in under Paid, at the same URL (MUT-424)', async () => {
    portal(`/p/${ORG_A}/payments`);
    const deeper = await screen.findByRole('navigation', { name: 'More in Paid' });
    expect(within(deeper).getByRole('link', { name: /^Currency conversions/ })).toHaveAttribute('href', `/p/${ORG_A}/conversions`);
  });
});
