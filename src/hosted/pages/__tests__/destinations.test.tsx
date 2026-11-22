import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { ORG_A, emptyProfileRoutes, locationOf, me, ok, profile, renderPortal, stubApi } from '../../__tests__/harness';
import { PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';
import { CUSTOMERS, page } from './fixtures';

/**
 * MUT-424: four destinations (Owed, Paid, Spent, Clients), everything else one level in with a way back. MUT-657: home
 * is the pill's first item, at the bare profile path; Owed's overview moved to `/owed`.
 */

const EMPTY = ok({ items: [], nextCursor: null });

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
});
afterEach(() => vi.unstubAllGlobals());

function portal(path: string) {
  stubApi({
    'GET /v1/me': () => ok(me([profile()])),
    ...emptyProfileRoutes(),
    'GET /v1/customers': () => ok(page(CUSTOMERS)),
    'GET /v1/expenses': () => EMPTY,
    'GET /v1/expense-groups': () => EMPTY,
    'GET /v1/conversions': () => EMPTY,
  });
  return renderPortal(path);
}

async function sections() {
  return screen.findByRole('navigation', { name: 'Sections' });
}

function lit(nav: HTMLElement) {
  return within(nav)
    .getAllByRole('link')
    .filter((link) => link.getAttribute('aria-current') === 'page')
    .map((link) => link.textContent);
}

const main = () => screen.getByRole('main');

describe('the shell (the floating pill, MUT-426)', () => {
  it('shows home, then the four destinations, in order', async () => {
    portal(`/p/${ORG_A}`);
    const nav = await sections();
    expect(within(nav).getAllByRole('link').map((link) => link.getAttribute('aria-label') ?? link.textContent)).toEqual(['Home', 'Owed', 'Paid', 'Spent', 'Clients']);
    expect(lit(nav)).toEqual(['Home']);
  });

  it.each([
    ['owed', 'Owed'],
    ['receivables', 'Owed'],
    ['conversions', 'Paid'],
    ['expenses/groups', 'Spent'],
    ['documents', 'Clients'],
  ])('lights the destination a page one level in belongs to (/%s → %s)', async (segment, destination) => {
    portal(`/p/${ORG_A}/${segment}`);
    expect(lit(await sections())).toEqual([destination]);
  });

  it('opens Reports from its corner icon (MUT-426), lighting no destination there; MUT-448: the account-level Glance', async () => {
    const { user, router } = portal(`/p/${ORG_A}`);
    const nav = await sections();
    await user.click(screen.getByRole('link', { name: 'Reports' }));
    expect(locationOf(router)).toBe(`/reports?back=${encodeURIComponent(`/p/${ORG_A}`)}`);
    expect(lit(nav)).toEqual([]);
    expect(screen.getByRole('link', { name: 'Reports' })).toHaveAttribute('aria-current', 'page');
  });

  it('names the destinations in Arabic', async () => {
    localStorage.setItem(PORTAL_LANGUAGE_KEY, 'ar');
    portal(`/p/${ORG_A}`);
    const nav = await screen.findByRole('navigation', { name: 'الأقسام' });
    expect(within(nav).getAllByRole('link').map((link) => link.getAttribute('aria-label') ?? link.textContent)).toEqual(['الرئيسية', 'المستحق', 'المدفوع', 'المصروف', 'العملاء']);
  });
});

describe('destination pages', () => {
  it.each([
    ['', 'Home'],
    ['/owed', 'Owed'],
    ['/payments', 'Paid'],
    ['/expenses', 'Spent'],
    ['/expenses/groups', 'Spent'],
    ['/clients', 'Clients'],
  ])('/p/:id%s is titled %s', async (suffix, title) => {
    portal(`/p/${ORG_A}${suffix}`);
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument();
  });

  it.each([
    ['/owed', 'More in Owed', 'Receivables', '/receivables'],
    ['/payments', 'More in Paid', 'Currency conversions', '/conversions'],
    ['/clients', 'More in Clients', 'Documents', '/documents'],
  ])('/p/:id%s links one level in', async (suffix, navName, row, target) => {
    const { user, router } = portal(`/p/${ORG_A}${suffix}`);
    const deeper = await screen.findByRole('navigation', { name: navName });
    await user.click(within(deeper).getByRole('link', { name: new RegExp(`^${row}`) }));
    expect(locationOf(router)).toBe(`/p/${ORG_A}${target}`);
  });

  it('adds no row to Spent, whose Expenses · Groups tabs already go one level in', async () => {
    portal(`/p/${ORG_A}/expenses`);
    await screen.findByRole('heading', { level: 1, name: 'Spent' });
    expect(screen.queryByRole('navigation', { name: 'More in Spent' })).toBeNull();
  });
});

describe('one level in, and back', () => {
  it.each([
    ['/receivables', 'Receivables', 'Owed', '/owed'],
    ['/conversions', 'Conversions', 'Paid', '/payments'],
    ['/documents', 'Documents', 'Clients', '/clients'],
  ])('%s keeps its own name and links back to its destination', async (suffix, title, back, target) => {
    const { user, router } = portal(`/p/${ORG_A}${suffix}`);
    await screen.findByRole('heading', { level: 1, name: title });
    await user.click(within(main()).getByRole('link', { name: back }));
    expect(locationOf(router)).toBe(`/p/${ORG_A}${target}`);
  });

  it('keeps the client page\'s "All clients" link, now drawn by the shared header', async () => {
    stubApi({
      'GET /v1/me': () => ok(me([profile()])),
      ...emptyProfileRoutes(),
      [`GET /v1/customers/${CUSTOMERS[0].id}`]: () => ok(CUSTOMERS[0]),
    });
    const { user, router } = renderPortal(`/p/${ORG_A}/clients/${CUSTOMERS[0].id}`);
    await user.click(await screen.findByRole('link', { name: 'All clients' }));
    expect(locationOf(router)).toBe(`/p/${ORG_A}/clients`);
  });
});

/** MUT-657 (E-1): every old link still lands. A bare `?currency=` was the overview's own key, so it means Owed. */
describe('the old Owed address', () => {
  it('sends a bare ?currency= to Owed, keeping the shell keys and replacing the history entry', async () => {
    const { router, history } = portal(`/p/${ORG_A}?currency=USD&billing=true`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Owed' })).toBeInTheDocument();
    const { pathname, search } = router.state.location;
    expect(pathname).toBe(`/p/${ORG_A}/owed`);
    expect(search).toMatchObject({ currency: 'USD', billing: true });
    expect(history.length).toBe(1);
  });

  it('opens home on the bare path with no currency', async () => {
    portal(`/p/${ORG_A}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument();
  });

  it("returns from Reports to home, the bare path (the shell's fallback)", async () => {
    const { user, router } = portal(`/p/${ORG_A}`);
    await sections();
    await user.click(screen.getByRole('link', { name: 'Reports' }));
    await user.click(screen.getByRole('link', { name: 'Reports' }));
    expect(locationOf(router)).toBe(`/p/${ORG_A}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument();
  });
});
