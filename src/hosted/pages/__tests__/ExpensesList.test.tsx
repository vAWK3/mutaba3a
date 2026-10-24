import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { ORG_A, emptyProfileRoutes, locationOf, me, ok, profile, renderPortal, stubApi, type Handler } from '../../__tests__/harness';
import { PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';
import { C1, CUSTOMERS, page } from './fixtures';

/** MUT-44: the expenses list and the drawer it opens. */

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
});
afterEach(() => vi.unstubAllGlobals());

const CATEGORIES = { items: [{ id: 'cat-1', name: 'Software', color: null, archived: false, version: 1, createdAt: '', updatedAt: '' }] };

function expense(overrides: Record<string, unknown> = {}) {
  return {
    id: 'e1',
    occurredOn: '2026-10-01',
    amount: '45.50',
    currency: 'ILS',
    title: 'Office supplies',
    vendor: null,
    categoryId: 'cat-1',
    customerId: C1,
    projectId: null,
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
    'GET /v1/customers': () => ok(page(CUSTOMERS)),
    'GET /v1/expense-categories': () => ok(CATEGORIES),
    'GET /v1/expenses': () => ok(page([])),
    ...routes,
  });
  return { ...renderPortal(path), api };
}

describe('ExpensesList', () => {
  it('lists expenses with date, title, category, client and amount', async () => {
    portal(`/p/${ORG_A}/expenses`, { 'GET /v1/expenses': () => ok(page([expense()])) });
    const table = await screen.findByRole('table', { name: 'Expenses' });
    const row = within(table).getAllByRole('row')[1];
    expect(row).toHaveTextContent('Office supplies');
    expect(row).toHaveTextContent('Software');
    expect(row).toHaveTextContent('Al-Quds Bakery');
    expect(row).toHaveTextContent('₪45.50');
  });

  it('shows an empty state with a "Record expense" action when there are none', async () => {
    portal(`/p/${ORG_A}/expenses`);
    expect(await screen.findByText('No expenses recorded on this profile yet')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Record expense' }).length).toBeGreaterThan(0);
  });

  it('opens the drawer in create mode via the header button and sets ?newExpense=1', async () => {
    const { user, router } = portal(`/p/${ORG_A}/expenses`);
    await screen.findByText('No expenses recorded on this profile yet');
    await user.click(screen.getAllByRole('button', { name: 'Record expense' })[0]);
    expect(await screen.findByText('Record expense', { selector: '.drawer-title' })).toBeInTheDocument();
    expect(locationOf(router)).toContain('newExpense=true');
  });

  it('does not refetch the list when the drawer opens or closes (cache key excludes drawer state)', async () => {
    const { user, api } = portal(`/p/${ORG_A}/expenses`, { 'GET /v1/expenses': () => ok(page([expense()])) });
    await screen.findByText('Office supplies');
    const before = api.count('GET /v1/expenses');
    expect(before).toBeGreaterThan(0);

    await user.click(screen.getAllByRole('button', { name: 'Record expense' })[0]);
    await screen.findByText('Record expense', { selector: '.drawer-title' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByText('Record expense', { selector: '.drawer-title' })).not.toBeInTheDocument());

    expect(api.count('GET /v1/expenses')).toBe(before);
  });

  it('opens the drawer in edit mode by clicking a row, with ?expense=<id>', async () => {
    const { user, router } = portal(`/p/${ORG_A}/expenses`, { 'GET /v1/expenses': () => ok(page([expense()])), 'GET /v1/expenses/e1': () => ok(expense({ receipts: [] })) });
    const table = await screen.findByRole('table', { name: 'Expenses' });
    await user.click(within(table).getAllByRole('row')[1]);
    expect(await screen.findByText('Edit expense', { selector: '.drawer-title' })).toBeInTheDocument();
    expect(locationOf(router)).toContain(`expense=e1`);
  });

  it('clears the drawer search params on close', async () => {
    const { user, router } = portal(`/p/${ORG_A}/expenses`);
    await screen.findByText('No expenses recorded on this profile yet');
    await user.click(screen.getAllByRole('button', { name: 'Record expense' })[0]);
    await screen.findByText('Record expense', { selector: '.drawer-title' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(locationOf(router)).not.toContain('newExpense'));
  });

  it('is the Spent destination in the sidebar nav, at the same URL (MUT-424)', async () => {
    portal(`/p/${ORG_A}`);
    const nav = await screen.findByRole('navigation', { name: 'Sections' });
    expect(within(nav).getByRole('link', { name: 'Spent' })).toHaveAttribute('href', `/p/${ORG_A}/expenses`);
  });
});
