import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { ORG_A, ORG_B, emptyProfileRoutes, fail, locationOf, me, ok, profile, renderPortal, stubApi, type Handler } from '../../__tests__/harness';
import type { ActivitySummary, HostedProfile } from '../../api/client';
import { PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';

/** MUT-175: Reports — stages, ≈ totals, All profiles, failures, Arabic (plan §7 ACs, D3/D4, DR6/DR12, DS1–DS5). */

const BASE = `/p/${ORG_A}/reports`;
const CLIENT = 'c1000000-0000-4000-8000-000000000001';
const FOOD = 'ca000000-0000-4000-8000-00000000000f';

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-24T09:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

interface Rec {
  on: string;
  kind: 'in' | 'out';
  /** Minor units (2-digit currencies only in these fixtures). */
  minor: number;
  currency?: 'ILS' | 'USD';
  customerId?: string | null;
  categoryId?: string | null;
}

const dec = (minor: number) => (minor / 100).toFixed(2);
/** Text without the bidi isolates that keep names and amounts whole inside a sentence. */
const plain = (element: Element) => (element.textContent ?? '').replace(/[\u2066-\u2069]/g, '');
const addMonth = (month: string, n: number) => {
  const d = new Date(`${month}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
};

/** What GET /v1/summaries/activity answers for these records (the server's rules, in miniature). */
function activityOf(records: Rec[], url: URL, extra: Partial<ActivitySummary> = {}): ActivitySummary {
  const from = url.searchParams.get('from')!;
  const to = url.searchParams.get('to')!;
  const bucket = (url.searchParams.get('bucket') ?? 'day') as 'day' | 'month';
  const currencyOf = (r: Rec) => r.currency ?? 'ILS';
  const block = (rows: Rec[]) =>
    [...new Set(rows.map(currencyOf))].sort().map((currency) => {
      const own = rows.filter((r) => currencyOf(r) === currency);
      const sum = (kind: Rec['kind']) => own.filter((r) => r.kind === kind).reduce((s, r) => s + r.minor, 0);
      const group = (kind: Rec['kind'], key: (r: Rec) => string | null) => {
        const map = new Map<string | null, number>();
        for (const r of own.filter((x) => x.kind === kind)) map.set(key(r), (map.get(key(r)) ?? 0) + r.minor);
        return [...map].sort((a, b) => b[1] - a[1]);
      };
      return {
        currency,
        received: dec(sum('in')),
        spent: dec(sum('out')),
        byCategory: group('out', (r) => r.categoryId ?? null).map(([categoryId, m]) => ({ categoryId, total: dec(m), count: 1 })),
        byCustomer: group('in', (r) => r.customerId ?? null).map(([customerId, m]) => ({ customerId, total: dec(m), count: 1 })),
      };
    }) as ActivitySummary['currencies'];
  const inPeriod = records.filter((r) => r.on >= from && r.on <= to);
  const currencies = block(inPeriod);
  const starts: string[] = [];
  if (bucket === 'day') for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) starts.push(d.toISOString().slice(0, 10));
  else for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = addMonth(m, 1)) starts.push(`${m}-01`);
  const keyOf = (on: string) => (bucket === 'day' ? on : `${on.slice(0, 7)}-01`);
  const months = Array.from({ length: 12 }, (_, i) => addMonth(to.slice(0, 7), i - 11));
  return {
    from,
    to,
    bucket,
    asOf: '2026-10-24',
    dataSince: records.map((r) => r.on).sort()[0] ?? null,
    earlierData: false,
    buckets: starts.map((start) => ({
      start,
      currencies: currencies.map((c) => {
        const rows = inPeriod.filter((r) => keyOf(r.on) === start && currencyOf(r) === c.currency);
        return { currency: c.currency, received: dec(rows.filter((r) => r.kind === 'in').reduce((s, r) => s + r.minor, 0)), spent: dec(rows.filter((r) => r.kind === 'out').reduce((s, r) => s + r.minor, 0)) };
      }),
    })),
    currencies,
    history: months.map((month) => ({ month, currencies: block(records.filter((r) => r.on.slice(0, 7) === month)) })),
    daysToPaid: { overall: null, byCustomer: [] },
    ...extra,
  };
}

const personal = profile({ id: ORG_A, name: 'Personal', writerOfRecord: null, owned: true, type: 'PERSONAL', isPersonalDefault: true, access: { payments: 'read-write', expenses: 'read-write', capture: 'read-write' }, income: { received: true, owed: true, customer: 'optional' } });
const studio = profile({ id: ORG_B, name: 'Studio', writerOfRecord: null, owned: true, type: 'BUSINESS', access: { payments: 'read-write', expenses: 'read-write', capture: 'read-write' }, income: { received: true, owed: true, customer: 'optional' } });

const rates = { base: 'ILS', rateDate: '2026-10-23', fetchedAt: '2026-10-24T06:00:00Z', source: 'live', rates: [{ currency: 'ILS', rate: 1, derived: false }, { currency: 'USD', rate: 0.25, derived: false }, { currency: 'EUR', rate: 0.24, derived: false }, { currency: 'JOD', rate: 0.19, derived: true }] };

interface World {
  profiles?: HostedProfile[];
  records?: Record<string, Rec[]>;
  activity?: Record<string, Handler>;
  extra?: Partial<ActivitySummary>;
  routes?: Record<string, Handler>;
  locale?: 'en' | 'ar';
}

function portal(path: string, world: World = {}) {
  const api = stubApi({
    'GET /v1/me': () => ok(me(world.profiles ?? [personal], world.locale ?? 'en')),
    ...emptyProfileRoutes(),
    'GET /v1/expense-categories': () => ok({ items: [{ id: FOOD, name: 'Food', color: null, archived: false, version: 1, createdAt: '', updatedAt: '' }] }),
    'GET /v1/customers': () => ok({ items: [{ id: CLIENT, name: 'Haddad' }], nextCursor: null }),
    'GET /v1/fx-rates': () => ok(rates),
    'GET /v1/summaries/activity': (request) => {
      const profileId = request.headers.get('X-Mutaba3a-Profile') ?? ORG_A;
      const custom = world.activity?.[profileId];
      if (custom) return custom(request);
      return ok(activityOf(world.records?.[profileId] ?? [], request.url, world.extra));
    },
    ...world.routes,
  });
  return { ...renderPortal(path), api };
}

const thisMonth: Rec[] = [
  { on: '2026-10-03', kind: 'in', minor: 150000, customerId: CLIENT },
  { on: '2026-10-05', kind: 'out', minor: 40000, categoryId: FOOD },
];

describe('Reports: reaching it and the first run (AC1, DR6, DR8)', () => {
  it('is a nav item after Overview and opens on the current profile', async () => {
    portal(`/p/${ORG_A}`, { records: { [ORG_A]: thisMonth } });
    const link = await screen.findByRole('link', { name: 'Reports' });
    expect(link).toHaveAttribute('href', BASE);
  });

  it('with no records shows one block and the two capture actions', async () => {
    portal(BASE);
    expect(await screen.findByRole('heading', { name: 'Your reports start with your first payment or expense' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '+ Add income' })).toHaveAttribute('href', `/p/${ORG_A}/payments?newIncome=received`);
    expect(screen.getByRole('link', { name: 'Record expense' })).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });
});

describe('Reports: stage 1 (AC2, AC5, B8)', () => {
  it('heads with Received, then Spent and Kept, the Owed line and a teaser naming the unlock month', async () => {
    portal(BASE, {
      records: { [ORG_A]: thisMonth },
      routes: { 'GET /v1/summaries/organization': () => ok({ asOf: '2026-10-24', currencies: [{ currency: 'ILS', outstanding: '700.00', overdue: '0.00', dueToday: '0.00', notYetDue: '700.00', unallocated: '0.00', proposed: '0.00', counts: { customers: 1, overdueCustomers: 0, unallocatedPayments: 0, openProposals: 0 }, customers: [] }] }) },
    });
    const hero = await screen.findByRole('region', { name: 'Reports' });
    expect(within(hero).getByText('Received')).toBeInTheDocument();
    await waitFor(() => expect(within(hero).getAllByText('₪1,500').length).toBeGreaterThan(0));
    expect(within(hero).getAllByText('₪400').length).toBeGreaterThan(0);
    expect(within(hero).getAllByText('₪1,100').length).toBeGreaterThan(0);
    expect(within(hero).getByText('October 2026 · so far')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Owed to you' })).toHaveTextContent('Owed to you now ₪700');
    expect(screen.getByText('Your first monthly recap arrives in November.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Lately' })).toBeNull();
    expect(document.body.textContent).not.toMatch(/billed/i);
  });

  it('locks Year until stage 3 and says when it unlocks', async () => {
    portal(BASE, { records: { [ORG_A]: thisMonth } });
    const year = await screen.findByRole('radio', { name: 'Year' });
    expect(year).toHaveAttribute('aria-disabled', 'true');
    expect(year).toHaveAttribute('title', 'Unlocks in December');
  });

  it('draws received and spent per day, the days to come faint, and a selected day’s values', async () => {
    portal(BASE, { records: { [ORG_A]: thisMonth } });
    const chart = await screen.findByRole('group', { name: 'Received and spent per day. Arrow keys move between days.' });
    expect(within(chart).getAllByRole('button')).toHaveLength(24);
    expect(chart.querySelectorAll('.hp-daybar-future')).toHaveLength(7);
    // DR26: the selected day defaults to today, its values said once in a live line
    const selected = document.querySelector('.hp-report-selected')!;
    expect(selected).toHaveAttribute('aria-live', 'polite');
    expect(selected).toHaveTextContent('Sat, Oct 24 · Received ₪0.00 · Spent ₪0.00');
  });
});

describe('Reports: stage 3 insights (AC5, D2, DR16)', () => {
  const months: Rec[] = [
    { on: '2026-07-01', kind: 'in', minor: 100000, customerId: CLIENT },
    { on: '2026-08-04', kind: 'in', minor: 120000, customerId: CLIENT },
    { on: '2026-08-04', kind: 'out', minor: 10000, categoryId: FOOD },
    { on: '2026-09-04', kind: 'in', minor: 90000, customerId: CLIENT },
    { on: '2026-09-04', kind: 'out', minor: 30000, categoryId: FOOD },
    ...thisMonth,
  ];

  it('lists up to three insights under Lately and opens Year', async () => {
    portal(BASE, { records: { [ORG_A]: months }, extra: { daysToPaid: { overall: { median: 12, n: 4 }, byCustomer: [{ customerId: CLIENT, median: 12, n: 4 }] } } });
    const lately = await screen.findByRole('heading', { name: 'Lately' });
    const items = within(lately.closest('section')!).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items.map(plain)).toEqual([
      'Food: ₪300.00 in September, ₪200.00 more than August.',
      'Haddad paid 100% of what you received in the last 3 months.',
      'Clients typically pay in full 12 days after you log what they owe.',
    ]);
    expect(screen.getByRole('radio', { name: 'Year' })).not.toHaveAttribute('aria-disabled');
  });

  it('keeps the same insights while stepping to another period', async () => {
    const { user, router } = portal(BASE, { records: { [ORG_A]: months } });
    await screen.findByRole('heading', { name: 'Lately' });
    const before = screen.getAllByRole('listitem').map((li) => li.textContent);
    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    await waitFor(() => expect(locationOf(router)).toContain('at=2026-09-01'));
    expect(await screen.findByText('September 2026')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').map((li) => li.textContent).slice(0, before.length)).toEqual(before);
    expect(screen.getByRole('button', { name: 'Next month' })).toBeEnabled();
  });
});

describe('Reports: currencies (AC3, B5, D3)', () => {
  const twoCurrencies: Rec[] = [...thisMonth, { on: '2026-10-06', kind: 'in', minor: 10000, currency: 'USD', customerId: CLIENT }];

  it('shows one ≈ total at today’s rate, and the exact amount per currency on tap', async () => {
    const { user } = portal(BASE, { records: { [ORG_A]: twoCurrencies } });
    const trigger = await screen.findByRole('button', { name: /≈/ });
    expect(trigger).toHaveAttribute('aria-description', 'Show the exact amount in each currency');
    expect(trigger).toHaveAccessibleName('≈ ₪1,900');
    await user.click(trigger);
    const panel = screen.getByRole('group', { name: 'Exact amounts' });
    expect(within(panel).getByRole('row', { name: /USD/ })).toHaveTextContent('$100.00');
    expect(within(panel).getByRole('row', { name: /ILS/ })).toHaveTextContent('₪1,500.00');
    expect(panel).toHaveTextContent('1 USD = 4 ILS');
    expect(panel).toHaveTextContent('ECB · Oct 23, 2026 · today’s rate'.replace('’', "'"));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('group', { name: 'Exact amounts' })).toBeNull();
  });

  it('falls back to each currency on its own when a rate is missing', async () => {
    portal(BASE, { records: { [ORG_A]: twoCurrencies }, routes: { 'GET /v1/fx-rates': () => fail(503, 'FX_RATES_UNAVAILABLE') } });
    const hero = await screen.findByRole('region', { name: 'Reports' }, { timeout: 4000 });
    await waitFor(() => expect(within(hero).getAllByText('$100').length).toBeGreaterThan(0));
    expect(within(hero).getAllByText('₪1,500').length).toBeGreaterThan(0);
    expect(hero.textContent).not.toContain('≈');
  });
});

describe('Reports: All profiles (AC4, AC7, D4, DS1–DS5)', () => {
  const studioRecords: Rec[] = [{ on: '2026-10-10', kind: 'in', minor: 50000, customerId: CLIENT }];

  it('the switch is off by default; on, it combines every profile, says so, and keeps it in the URL', async () => {
    const { user, router } = portal(BASE, { profiles: [personal, studio], records: { [ORG_A]: thisMonth, [ORG_B]: studioRecords } });
    const toggle = await screen.findByRole('switch', { name: 'All profiles' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await user.click(toggle);
    await waitFor(() => expect(locationOf(router)).toContain('scope=all'));
    expect(await screen.findByRole('button', { name: 'All 2 profiles' })).toBeInTheDocument();
    expect(screen.getByText(/combined · other currencies at today's rate/)).toBeInTheDocument();
    expect(await screen.findByText('Of which Personal: ≈ ₪1,500')).toBeInTheDocument();
    const hero = screen.getByRole('region', { name: 'Reports' });
    await waitFor(() => expect(within(hero).getAllByText('₪2,000').length).toBeGreaterThan(0));
    const whoPaid = screen.getByRole('region', { name: 'Who paid' });
    expect(within(whoPaid).getAllByText('Haddad')).toHaveLength(2);
    expect(within(whoPaid).getByText('Studio')).toBeInTheDocument();
  });

  it('names a profile that failed and retries only it; the rest still render', async () => {
    let studioFails = true;
    const { user } = portal(`${BASE}?scope=all`, {
      profiles: [personal, studio],
      records: { [ORG_A]: thisMonth },
      activity: { [ORG_B]: ({ url }) => (studioFails ? fail(500, 'INTERNAL') : ok(activityOf(studioRecords, url))) },
    });
    expect(await screen.findByText(/1 of 2 profiles · Studio couldn't load/)).toBeInTheDocument();
    const hero = screen.getByRole('region', { name: 'Reports' });
    expect(within(hero).getAllByText('₪1,500').length).toBeGreaterThan(0);
    studioFails = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Reports' })).getAllByText('₪2,000').length).toBeGreaterThan(0));
    expect(screen.queryByText(/couldn't load/)).toBeNull();
  });

  it('offers the combined insights from a young profile when the others are older (DS5)', async () => {
    const older: Rec[] = [
      { on: '2026-07-02', kind: 'in', minor: 10000 },
      { on: '2026-08-02', kind: 'in', minor: 10000 },
      { on: '2026-09-02', kind: 'in', minor: 10000 },
    ];
    const { user, router } = portal(BASE, { profiles: [personal, studio], records: { [ORG_A]: thisMonth, [ORG_B]: older } });
    const teaser = await screen.findByText('Personal started in October; insights unlock in November.');
    await user.click(within(teaser.closest('.hp-teaser')!).getByRole('button', { name: 'See insights across all profiles' }));
    await waitFor(() => expect(locationOf(router)).toContain('scope=all'));
  });
});

describe('Reports: refusals and errors (AC7, DR12, D4)', () => {
  it('explains a profile whose payments the person can’t see', async () => {
    portal(BASE, { records: {}, activity: { [ORG_A]: () => fail(403, 'INSUFFICIENT_SCOPE') } });
    expect(await screen.findByRole('heading', { name: "You can't see this profile's payments" })).toBeInTheDocument();
  });

  it('shows the error card when the one profile fails', async () => {
    portal(BASE, { activity: { [ORG_A]: () => fail(500, 'INTERNAL') } });
    expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});

describe('Reports in Arabic (AC1, RTL)', () => {
  it('reads right to left with the Arabic copy', async () => {
    localStorage.setItem(PORTAL_LANGUAGE_KEY, 'ar');
    portal(BASE, { records: { [ORG_A]: thisMonth }, locale: 'ar' });
    expect(await screen.findByRole('heading', { level: 1, name: 'التقارير' })).toBeInTheDocument();
    expect(document.documentElement.getAttribute('dir') ?? document.querySelector('[dir]')?.getAttribute('dir')).toBe('rtl');
    expect(await screen.findByRole('radio', { name: 'شهر' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: 'الشهر السابق' })).toBeInTheDocument();
  });
});
