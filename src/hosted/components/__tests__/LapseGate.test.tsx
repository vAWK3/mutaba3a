import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { ORG_A, ORG_B, emptyProfileRoutes, fail, locationOf, me, ok, profile, renderPortal, stubApi, type Handler } from '../../__tests__/harness';
import type { BillingEntitlement, BillingOverview, Me } from '../../api/client';
import { PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';

/**
 * MUT-361 (ADR-181): the lapse gate in the portal, through the real router, shell and query client with /v1 stubbed:
 * the GRACE and read-only banners, read-only lists and drawers, the locked screen, and a refusal that arrives late.
 */

const DAY = 24 * 60 * 60 * 1000;
const iso = (days: number) => new Date(Date.now() + days * DAY).toISOString();
const ent = (state: BillingEntitlement['state'], source: BillingEntitlement['source'], until: string | null = null): BillingEntitlement => ({ state, source, tier: source === 'NONE' ? null : 'FREELANCER', until });

const overview = (over: Partial<BillingOverview> = {}): BillingOverview => ({
  configured: true,
  subscription: null,
  canManage: false,
  trial: { startedAt: iso(-20), endsAt: iso(-6), lockAt: iso(10) },
  catalog: { ILS: { month: 4900, year: 49000 }, USD: { month: 1600, year: 16000 } },
  countries: { consumer: [], consumerEverywhere: true, customTaxId: ['IL', 'JO'] },
  coveredProfileIds: [ORG_B],
  ...over,
});

const personal = (billing: BillingEntitlement) =>
  profile({ id: ORG_B, name: 'Personal', isPersonalDefault: true, owned: true, type: 'PERSONAL', writerOfRecord: null, access: { payments: 'read-write', expenses: 'read-write', capture: 'read-write' }, income: { received: true, owed: true, customer: 'optional' }, billing });

const EXPENSE = { id: 'e1', occurredOn: '2026-10-01', amount: '45.50', currency: 'ILS', title: 'Office supplies', vendor: null, categoryId: null, customerId: null, projectId: null, notes: null, createdByUserId: 'u1', version: 1, createdAt: '', updatedAt: '', receipts: [{ id: 'r1', filename: 'receipt.png', status: 'READY', mimeType: 'image/png', sizeBytes: 4 }] };

function portal(path: string, opts: { billing: BillingEntitlement; standing?: Me['billingStanding']; locale?: 'en' | 'ar'; covered?: string[]; routes?: Record<string, Handler>; others?: ReturnType<typeof profile>[] }) {
  const body = { ...me([personal(opts.billing), ...(opts.others ?? [])], opts.locale ?? 'en'), billingStanding: opts.standing === undefined ? 'read-only' : opts.standing };
  const api = stubApi({
    'GET /v1/me': () => ok(body),
    'GET /v1/billing': () => ok(overview(opts.covered ? { coveredProfileIds: opts.covered } : {})),
    ...emptyProfileRoutes(),
    'GET /v1/expense-categories': () => ok({ items: [] }),
    'GET /v1/expenses': () => ok({ items: [EXPENSE], nextCursor: null }),
    [`GET /v1/expenses/e1`]: () => ok(EXPENSE),
    ...opts.routes,
  });
  return { ...renderPortal(path), api };
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
});
afterEach(() => vi.unstubAllGlobals());

describe('read-only (MUT-361)', () => {
  it('explains itself above every page with the lock date, Subscribe and Download my records', async () => {
    const { user, router } = portal(`/p/${ORG_B}/expenses`, { billing: ent('READ_ONLY', 'TRIAL', iso(10)) });
    const banner = await screen.findByRole('region', { name: 'Your plan' });
    expect(within(banner).getByText('This profile is read-only')).toBeInTheDocument();
    expect(within(banner).getByText(/Your free trial has ended\..*the profile locks until you subscribe/)).toBeInTheDocument();
    await user.click(await within(banner).findByRole('button', { name: 'Subscribe' }));
    expect(locationOf(router)).toContain('billing=true');
    expect(locationOf(router)).toContain('step=subscribe');
  });

  it('says a paid lapse never locks', async () => {
    portal(`/p/${ORG_B}`, { billing: ent('READ_ONLY', 'STRIPE') });
    expect(await screen.findByText(/Your subscription has ended\..*Nothing is deleted\./)).toBeInTheDocument();
  });

  it('tells someone whose payment wouldn’t cover the profile to ask its creator, with no Subscribe', async () => {
    portal(`/p/${ORG_B}`, { billing: ent('READ_ONLY', 'TRIAL', iso(10)), covered: [] });
    expect(await screen.findByText(/The person who created this profile pays for it/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Subscribe' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download my records' })).toBeInTheDocument();
  });

  it('lists expenses with no Record button; an expense opens to be read, with no Save or Delete; receipts still download', async () => {
    const { user } = portal(`/p/${ORG_B}/expenses`, { billing: ent('READ_ONLY', 'TRIAL', iso(10)) });
    const table = await screen.findByRole('table', { name: 'Expenses' });
    expect(screen.queryByRole('button', { name: 'Record expense' })).not.toBeInTheDocument();
    await user.click(within(table).getByText('Office supplies'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('This profile is read-only, so nothing here can be changed.')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Download' })).toBeEnabled();
    const amount = within(dialog).getAllByRole('textbox')[0]!;
    expect(amount).toBeDisabled();
  });

  it('a ?newExpense link opens nothing on a read-only profile', async () => {
    portal(`/p/${ORG_B}/expenses?newExpense=true`, { billing: ent('READ_ONLY', 'NONE') });
    await screen.findByRole('table', { name: 'Expenses' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('offers no Add income on Receivables', async () => {
    portal(`/p/${ORG_B}/receivables`, { billing: ent('READ_ONLY', 'NONE') });
    await screen.findByRole('region', { name: 'Your plan' });
    expect(screen.queryByRole('button', { name: 'Add income' })).not.toBeInTheDocument();
  });

  it('changes nothing while the server does not enforce the gate (billingStanding null)', async () => {
    portal(`/p/${ORG_B}/expenses`, { billing: ent('READ_ONLY', 'NONE'), standing: null });
    await screen.findByRole('table', { name: 'Expenses' });
    expect(screen.queryByRole('region', { name: 'Your plan' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Record expense' }).length).toBeGreaterThan(0);
  });
});

describe('a failed payment (GRACE)', () => {
  it('warns and links to Billing, and everything still works', async () => {
    const { user, router } = portal(`/p/${ORG_B}/expenses`, { billing: ent('GRACE', 'STRIPE', iso(3)), standing: 'open' });
    const banner = await screen.findByRole('region', { name: 'Your plan' });
    expect(within(banner).getByText('We couldn’t take your last payment'.replace('’', "'"))).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Record expense' }).length).toBeGreaterThan(0);
    await user.click(within(banner).getByRole('button', { name: 'Update your card' }));
    expect(locationOf(router)).toContain('billing=true');
  });
});

describe('locked (MUT-361)', () => {
  it('is one page: Subscribe and Download my records, no sections, no list read', async () => {
    const { user, router, api } = portal(`/p/${ORG_B}/expenses`, { billing: ent('LOCKED', 'TRIAL'), standing: 'locked' });
    expect(await screen.findByRole('heading', { name: 'Subscribe or download your records' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: /sections/i })).not.toBeInTheDocument();
    expect(api.count('GET /v1/expenses')).toBe(0);
    await user.click(screen.getByRole('button', { name: 'Download my records' }));
    expect(locationOf(router)).toContain('yourData=true');
  });

  it('Subscribe opens Billing’s Subscribe step', async () => {
    const { user, router } = portal(`/p/${ORG_B}`, { billing: ent('LOCKED', 'TRIAL'), standing: 'locked' });
    await user.click(await screen.findByRole('button', { name: 'Subscribe' }));
    expect(locationOf(router)).toContain('step=subscribe');
  });

  it('keeps the profile switcher, so a covered profile is a click away', async () => {
    const firm = profile({ id: ORG_A, name: 'Haddad & Partners', billing: ent('ACTIVE', 'OPERATOR') });
    portal(`/p/${ORG_B}`, { billing: ent('LOCKED', 'TRIAL'), standing: 'open', others: [firm] });
    await screen.findByRole('heading', { name: 'Subscribe or download your records' });
    expect(screen.getByRole('button', { name: /Personal/ })).toBeInTheDocument();
  });

  it('still offers Billing when Settings › Billing can’t be read (review: never nothing to press)', async () => {
    portal(`/p/${ORG_B}`, { billing: ent('LOCKED', 'TRIAL'), standing: 'locked', routes: { 'GET /v1/billing': () => fail(503, 'BILLING_NOT_CONFIGURED') } });
    await screen.findByRole('heading', { name: 'Subscribe or download your records' });
    expect(await screen.findByRole('button', { name: 'Billing' })).toBeInTheDocument();
  });

  it('says why New profile is off when the gate holds every profile', async () => {
    const { user } = portal(`/p/${ORG_B}`, { billing: ent('LOCKED', 'TRIAL'), standing: 'locked' });
    await screen.findByRole('heading', { name: 'Subscribe or download your records' });
    await user.click(screen.getByRole('button', { name: /Personal/ }));
    expect(await screen.findByText('Subscribe to add a profile: your plan has ended.')).toBeInTheDocument();
  });

  it('reads in Arabic, right to left', async () => {
    localStorage.setItem(PORTAL_LANGUAGE_KEY, 'ar');
    portal(`/p/${ORG_B}`, { billing: ent('LOCKED', 'TRIAL'), standing: 'locked', locale: 'ar' });
    expect(await screen.findByRole('heading', { name: 'اشترك أو نزّل سجلاتك' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'نزّل سجلاتي' })).toBeInTheDocument();
    expect(document.documentElement.dir).toBe('rtl');
  });
});

describe('a refusal that arrives after the page loaded', () => {
  it('re-reads /v1/me, and the page follows what it says', async () => {
    let state: BillingEntitlement = ent('ACTIVE', 'TRIAL', iso(1));
    let standing: Me['billingStanding'] = 'open';
    const api = stubApi({
      'GET /v1/me': () => ok({ ...me([personal(state)]), billingStanding: standing }),
      'GET /v1/billing': () => ok(overview()),
      ...emptyProfileRoutes(),
      'GET /v1/expense-categories': () => ok({ items: [] }),
      'GET /v1/expenses': () => (state.state === 'LOCKED' ? fail(402, 'SUBSCRIPTION_LAPSED') : ok({ items: [], nextCursor: null })),
    });
    const { queryClient } = renderPortal(`/p/${ORG_B}/expenses`);
    await screen.findByText('No expenses recorded on this profile yet');
    state = ent('LOCKED', 'TRIAL');
    standing = 'locked';
    await queryClient.invalidateQueries({ queryKey: ['p', ORG_B] });
    await waitFor(() => expect(api.count('GET /v1/me')).toBeGreaterThan(1));
    expect(await screen.findByRole('heading', { name: 'Subscribe or download your records' })).toBeInTheDocument();
  });
});
