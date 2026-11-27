import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { ORG_A, emptyProfileRoutes, me, ok, profile, renderPortal, stubApi } from '../../__tests__/harness';
import { PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';
import { C1, C2, C3, customer, page } from './fixtures';

/**
 * MUT-774 (wireframe A): the clients list's one Balance column from GET /v1/customer-balances: one line per currency
 * stacked, never summed; below zero "Client in credit"; zero "Settled"; no movement "—".
 */
const C4 = 'c4444444-4444-4444-8444-444444444444';
const CUSTOMERS = [customer(C1, 'Amal Studio'), customer(C2, 'Bassam Law'), customer(C3, 'Carmel Co'), customer(C4, 'Dana Design')];
const BALANCES = {
  asOf: '2026-11-27',
  balances: [
    { customerId: C1, currency: 'USD', balance: '120.00' },
    { customerId: C1, currency: 'ILS', balance: '4500.00' },
    { customerId: C2, currency: 'ILS', balance: '-200.00' },
    { customerId: C3, currency: 'ILS', balance: '0.00' },
  ],
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
});
afterEach(() => vi.unstubAllGlobals());

function portal(locale: 'en' | 'ar' = 'en') {
  const api = stubApi({
    'GET /v1/me': () => ok(me([profile()], locale)),
    ...emptyProfileRoutes(),
    'GET /v1/customers': () => ok(page(CUSTOMERS)),
    'GET /v1/customer-balances': () => ok(BALANCES),
  });
  return { ...renderPortal(`/p/${ORG_A}/clients`), api };
}

const rowOf = async (name: string) => (await screen.findByRole('link', { name })).closest('tr')!;

describe('the clients list balance column (MUT-774)', () => {
  it('stacks each currency, never sums, says in credit and settled, and asks the server once', async () => {
    const { api } = portal();
    expect(await screen.findByRole('columnheader', { name: 'Balance' })).toBeInTheDocument();
    const amal = within(await rowOf('Amal Studio'));
    expect(amal.getByTestId('client-balance-ILS')).toHaveTextContent('4,500.00');
    expect(amal.getByTestId('client-balance-USD')).toHaveTextContent('120.00');
    expect(within(await rowOf('Bassam Law')).getByTestId('client-balance-ILS')).toHaveTextContent(/^Client in credit · .*200\.00$/);
    expect(within(await rowOf('Bassam Law')).getByTestId('client-balance-ILS')).not.toHaveTextContent('-');
    expect(within(await rowOf('Carmel Co')).getByText('Settled')).toBeInTheDocument();
    const dana = (await rowOf('Dana Design')).querySelectorAll('td');
    expect([...dana].some((td) => td.textContent === '—')).toBe(true);
    expect(api.count('GET /v1/customer-balances')).toBe(1);
  });

  it('Arabic: the column and the in-credit line read right to left', async () => {
    localStorage.setItem(PORTAL_LANGUAGE_KEY, 'ar');
    portal('ar');
    expect(await screen.findByRole('columnheader', { name: 'الرصيد' })).toBeInTheDocument();
    expect(within(await rowOf('Carmel Co')).getByText('مسدّد')).toBeInTheDocument();
  });
});
