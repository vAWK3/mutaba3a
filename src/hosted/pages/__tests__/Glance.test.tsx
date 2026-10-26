import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import type { BillingEntitlement, Verdict } from '../../api/client';
import { ORG_A, ORG_B, emptyProfileRoutes, fail, locationOf, me, never, ok, profile, renderPortal, stubApi, type Handler } from '../../__tests__/harness';
import { PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';
import type { Me } from '../../session/me';

/**
 * MUT-448: the Glance at /reports — the verdict across profiles as rows, kept and owed (AC1–AC3, AC6), with the page
 * states the design review added: first run (DD4), all locked (D7), a refresh that fails while figures show (DD6).
 */

const LOCKED: BillingEntitlement = { state: 'LOCKED', source: 'TRIAL', tier: 'FREELANCER', until: null };

type VerdictProfile = Verdict['profiles'][number];
const line = (net: string, received = net, spent = '0.00') => ({ currency: 'ILS' as const, received, spent, net });

function vp(profileId: string, name: string, over: Partial<VerdictProfile> = {}): VerdictProfile {
  return { profileId, name, kind: 'BUSINESS', shared: false, currencies: [line('9040.00', '10000.00', '960.00')], converted: { received: '10000.00', spent: '960.00', net: '9040.00' }, history: [], owed: { currencies: [], overdueCount: 0 }, omittedCurrencies: [], ...over };
}

function verdict(over: Partial<Verdict> = {}): Verdict {
  return {
    from: '2026-10-01',
    to: '2026-10-31',
    asOf: '2026-10-26',
    base: 'ILS',
    rates: { date: '2026-10-23', source: 'live' },
    profiles: [vp(ORG_A, 'Haddad & Partners'), vp(ORG_B, 'Personal', { kind: 'PERSONAL', currencies: [line('-6350.00', '0.00', '6350.00')], converted: { received: '0.00', spent: '6350.00', net: '-6350.00' } })],
    total: { label: 'kept', currencies: [{ currency: 'ILS', net: '2690.00' }], converted: '2690.00', inCurrencyOnly: null, sharedInFull: false, partial: false },
    usual: '2000.00',
    owed: { currencies: [{ currency: 'ILS', outstanding: '11500.00', overdue: '3000.00' }], overdueCount: 2, converted: '11500.00' },
    unavailable: [],
    ...over,
  };
}

const twoProfiles = () => me([profile({ owned: true }), profile({ id: ORG_B, name: 'Personal', owned: true, isPersonalDefault: true })]);

function portal(path: string, verdictHandler: Handler, body: Me = twoProfiles()) {
  const api = stubApi({
    'GET /v1/me': () => ok(body),
    ...emptyProfileRoutes(),
    'GET /v1/billing': () => ok({ configured: false }),
    'GET /v1/summaries/verdict': verdictHandler,
  });
  return { ...renderPortal(path), api };
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener: () => {}, removeEventListener: () => {} }));
});
afterEach(() => vi.unstubAllGlobals());

const list = () => screen.findByRole('list', { name: 'Your profiles' });

describe('the Glance', () => {
  it('shows a business and a personal profile as two rows, then what was kept and what is owed (AC1)', async () => {
    const { api } = portal(`/reports?back=${encodeURIComponent(`/p/${ORG_A}/payments`)}`, () => ok(verdict()));
    const rows = within(await list()).getAllByRole('link');
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual(['Haddad & Partners, net +₪9,040', 'Personal, spent ₪6,350']);
    expect(screen.getByRole('heading', { level: 1, name: 'Reports' })).toBeInTheDocument();
    const hero = screen.getByRole('region', { name: 'Kept' });
    expect(within(hero).getByText('₪2,690', { selector: '.sr-only' })).toBeInTheDocument();
    expect(screen.getByText('Still owed to you')).toBeInTheDocument();
    expect(screen.getByText('2 overdue')).toBeInTheDocument();
    // D4: this month is the server's pick, asked with no dates and no profile header
    const call = api.calls.find((c) => c.url.pathname === '/v1/summaries/verdict')!;
    expect(call.url.search).toBe('');
    expect(call.headers.has('x-mutaba3a-profile')).toBe(false);
  });

  it('opens a row’s own Reports for the same period, and amounts sit in <bdi> (AC6)', async () => {
    portal('/reports', () => ok(verdict()));
    const row = within(await list()).getByRole('link', { name: /^Haddad/ });
    expect(row).toHaveAttribute('href', `/p/${ORG_A}/reports?period=month&at=2026-10-01`);
    expect(row.querySelector('.hp-glance-amount bdi')).toHaveTextContent('+₪9,040');
  });

  it('hides the usual while the month runs, and compares a finished month with it (DD1)', async () => {
    const { user } = portal('/reports', ({ url }) => ok(url.searchParams.get('from') === '2026-09-01' ? verdict({ from: '2026-09-01', to: '2026-09-30' }) : verdict()));
    await list();
    expect(screen.queryByText(/your usual/)).not.toBeInTheDocument();
    expect(screen.getByText('October 2026 · so far')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(await screen.findByText(/above your usual/)).toHaveTextContent('▲ ₪690 above your usual');
  });

  it('keeps `back` in the URL while stepping periods', async () => {
    const back = `/p/${ORG_A}/payments`;
    const { user, router } = portal(`/reports?back=${encodeURIComponent(back)}`, () => ok(verdict()));
    await list();
    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    await waitFor(() => expect(locationOf(router)).toContain('at=2026-09-01'));
    expect(new URL(locationOf(router), 'http://x').searchParams.get('back')).toBe(back);
  });

  it('shows a negative kept with its sentence (AC3)', async () => {
    portal('/reports', () => ok(verdict({ total: { ...verdict().total, currencies: [{ currency: 'ILS', net: '-1200.00' }], converted: '-1200.00' } })));
    await list();
    expect(screen.getByText('Spent more than came in')).toBeInTheDocument();
    expect(document.querySelector('.hp-glance-figure.is-negative')).not.toBeNull();
  });

  it('says what a quiet profile and an expense-less business are, never a blank (AC3)', async () => {
    const quiet = vp(ORG_B, 'Personal', { kind: 'PERSONAL', currencies: [], converted: { received: '0.00', spent: '0.00', net: '0.00' } });
    const incomeOnly = vp(ORG_A, 'Haddad & Partners', { currencies: [line('500.00', '500.00', '0.00')], converted: { received: '500.00', spent: '0.00', net: '500.00' } });
    portal('/reports', () => ok(verdict({ profiles: [incomeOnly, quiet] })));
    const rows = within(await list()).getAllByRole('link');
    expect(rows[0]).toHaveAccessibleName('Haddad & Partners, income only +₪500');
    expect(rows[1]).toHaveAccessibleName('Personal, spent Nothing recorded');
  });

  it('says nothing is owed when nothing is open (DD3)', async () => {
    portal('/reports', () => ok(verdict({ owed: { currencies: [], overdueCount: 0, converted: '0.00' } })));
    await list();
    expect(screen.getByText('Nothing owed to you')).toBeInTheDocument();
    expect(screen.queryByText(/overdue/)).not.toBeInTheDocument();
  });

  it('starts a new account at the first-run block, not a ledger of zeros (DD4)', async () => {
    const blank = (p: VerdictProfile) => ({ ...p, currencies: [], converted: { received: '0.00', spent: '0.00', net: '0.00' } });
    const v = verdict();
    portal('/reports', () => ok(verdict({ profiles: v.profiles.map(blank), total: { ...v.total, currencies: [], converted: '0.00' }, owed: { currencies: [], overdueCount: 0, converted: '0.00' } })));
    expect(await screen.findByRole('heading', { name: 'Your reports start with your first payment or expense' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Your profiles' })).not.toBeInTheDocument();
  });

  it('shows the locked screen without asking for the verdict when every profile is locked (D7)', async () => {
    const locked = me([profile({ owned: true, billing: LOCKED }), profile({ id: ORG_B, name: 'Personal', owned: true, billing: LOCKED })]);
    const { api } = portal('/reports', () => ok(verdict()), { ...locked, billingStanding: 'LOCKED' } as Me);
    expect(await screen.findByRole('heading', { name: 'Subscribe or download your records' })).toBeInTheDocument();
    expect(api.count('GET /v1/summaries/verdict')).toBe(0);
  });

  it('shows the locked screen when the verdict is refused for a lapse after all (D7)', async () => {
    portal('/reports', () => fail(402, 'SUBSCRIPTION_LAPSED'));
    expect(await screen.findByRole('heading', { name: 'Subscribe or download your records' })).toBeInTheDocument();
  });

  it('keeps the figures and offers Retry when a refresh fails (DD6)', async () => {
    let calls = 0;
    const { queryClient } = portal('/reports', () => (++calls === 1 ? ok(verdict()) : fail(500, 'INTERNAL')));
    await list();
    // A focus refetch of the period on screen fails (eng D9)
    await queryClient.refetchQueries({ queryKey: ['verdict'] });
    expect(await screen.findByText(/Couldn't refresh/)).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Your profiles' })).toBeInTheDocument();
  });

  it('shows the error card when there is nothing to show yet', async () => {
    portal('/reports', () => fail(500, 'INTERNAL'));
    expect(await screen.findByRole('button', { name: /retry|try again/i })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Your profiles' })).not.toBeInTheDocument();
  });

  it('shows a ledger-shaped skeleton while the first answer loads (DD5)', async () => {
    portal('/reports', never);
    await waitFor(() => expect(document.querySelectorAll('.hp-glance-skeleton-row')).toHaveLength(3));
  });

  it('reads right to left in Arabic with Arabic row names (AC6)', async () => {
    localStorage.setItem(PORTAL_LANGUAGE_KEY, 'ar');
    portal('/reports', () => ok(verdict()), { ...twoProfiles(), user: { ...twoProfiles().user, locale: 'ar' } });
    const rows = within(await screen.findByRole('list', { name: 'ملفاتك' })).getAllByRole('link');
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(rows[1]!.getAttribute('aria-label')).toMatch(/^Personal، مصروف /);
    expect(screen.getByRole('region', { name: 'تبقّى لك' })).toBeInTheDocument();
  });
});
