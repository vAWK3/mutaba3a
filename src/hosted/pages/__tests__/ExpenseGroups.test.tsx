import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { ORG_A, emptyProfileRoutes, fail, locationOf, me, never, ok, profile, renderPortal, stubApi, type Handler } from '../../__tests__/harness';
import type { Expense, ExpenseGroup, ExpenseGroupSummary } from '../../api/client';
import { PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';

/** MUT-268: Expenses › Groups, a group's page, its drawers, and "In groups" on an expense. */

const G1 = 'a0000000-0000-4000-8000-000000000001';
const G2 = 'a0000000-0000-4000-8000-000000000002';
const G3 = 'a0000000-0000-4000-8000-000000000003';
const RENT = 'c0000000-0000-4000-8000-00000000000a';
const TRAVEL = 'c0000000-0000-4000-8000-00000000000b';
const BASE = `/p/${ORG_A}/expenses/groups`;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-18T09:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function group(over: Partial<ExpenseGroup> = {}): ExpenseGroup {
  return {
    id: G1,
    name: 'Jordan trip',
    startOn: '2026-10-03',
    endOn: '2026-10-07',
    windowEnd: '2026-10-07',
    notes: null,
    currencies: [],
    memberCount: 0,
    createdByUserId: 'u1',
    version: 1,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    ...over,
  };
}

function expense(id: string, over: Partial<Expense> = {}): Expense {
  return { id, occurredOn: '2026-10-05', amount: '10.000', currency: 'JOD', title: id, categoryId: null, customerId: null, projectId: null, vendor: null, notes: null, version: 1, createdAt: '', updatedAt: '', ...over } as Expense;
}

type Block = ExpenseGroupSummary['currencies'][number];
function summaryOf(rows: Expense[], seriesFrom = '2026-10-03', seriesTo = '2026-10-07'): ExpenseGroupSummary {
  const currencies = new Map<string, Block>();
  const exp = (c: string) => (c === 'JOD' ? 3 : 2);
  const add = (a: string, b: string, c: string) => ((Math.round(Number(a) * 10 ** exp(c)) + Math.round(Number(b) * 10 ** exp(c))) / 10 ** exp(c)).toFixed(exp(c));
  for (const row of rows) {
    const block = currencies.get(row.currency) ?? { currency: row.currency, total: (0).toFixed(exp(row.currency)), count: 0, byCategory: [], byCustomer: [], byDay: [] };
    block.total = add(block.total, row.amount, row.currency);
    block.count += 1;
    const position = row.occurredOn < seriesFrom ? 'before' : row.occurredOn > seriesTo ? 'after' : 'in';
    const day = block.byDay.find((d) => d.date === row.occurredOn) ?? (block.byDay.push({ date: row.occurredOn, position, total: (0).toFixed(exp(row.currency)), count: 0 }), block.byDay.at(-1)!);
    day.total = add(day.total, row.amount, row.currency);
    day.count += 1;
    const cat = block.byCategory.find((c) => c.categoryId === row.categoryId) ?? (block.byCategory.push({ categoryId: row.categoryId, total: (0).toFixed(exp(row.currency)), count: 0 }), block.byCategory.at(-1)!);
    cat.total = add(cat.total, row.amount, row.currency);
    cat.count += 1;
    currencies.set(row.currency, block);
  }
  // The API zero-fills every series day per currency (MUT-267 D8)
  for (const block of currencies.values()) {
    for (let d = new Date(`${seriesFrom}T00:00:00Z`); d.toISOString().slice(0, 10) <= seriesTo; d.setUTCDate(d.getUTCDate() + 1)) {
      const date = d.toISOString().slice(0, 10);
      if (!block.byDay.some((b) => b.date === date)) block.byDay.push({ date, position: 'in', total: (0).toFixed(exp(block.currency)), count: 0 });
    }
    block.byDay.sort((a, b) => (a.date < b.date ? -1 : 1));
  }
  return { groupId: G1, seriesFrom, seriesTo, currencies: [...currencies.values()] };
}

const categories = { items: [{ id: RENT, name: 'Rent', color: null, archived: false, version: 1, createdAt: '', updatedAt: '' }, { id: TRAVEL, name: 'Travel', color: null, archived: false, version: 1, createdAt: '', updatedAt: '' }] };

const rates = { base: 'ILS', rateDate: '2026-10-17', fetchedAt: '2026-10-18T06:00:00Z', source: 'live', rates: [{ currency: 'ILS', rate: 1, derived: false }, { currency: 'USD', rate: 0.27, derived: false }, { currency: 'EUR', rate: 0.25, derived: false }, { currency: 'JOD', rate: 0.191428, derived: true }] };

interface World {
  groups?: ExpenseGroup[];
  members?: Expense[];
  excluded?: Expense[];
  pool?: Expense[];
  summary?: ExpenseGroupSummary;
  routes?: Record<string, Handler>;
  locale?: 'en' | 'ar';
}

function portal(path: string, world: World = {}) {
  const g = world.groups ?? [group()];
  const members = world.members ?? [];
  const api = stubApi({
    'GET /v1/me': () => ok(me([profile({ access: { payments: 'read', expenses: 'read-write', capture: 'read-write' } })], world.locale ?? 'en')),
    ...emptyProfileRoutes(),
    'GET /v1/expense-categories': () => ok(categories),
    'GET /v1/expenses': ({ url }) => {
      const membership = url.searchParams.get('groupMembership');
      if (membership === 'member') return ok({ items: members, nextCursor: null });
      if (membership === 'excluded') return ok({ items: world.excluded ?? [], nextCursor: null });
      return ok({ items: world.pool ?? [], nextCursor: null });
    },
    'GET /v1/expense-groups': ({ url }) => ok({ items: url.searchParams.get('expenseId') ? g.slice(0, 1) : g }),
    [`GET /v1/expense-groups/${G1}`]: () => ok({ ...g[0], excludedCount: (world.excluded ?? []).length }),
    [`GET /v1/expense-groups/${G1}/summary`]: () => ok(world.summary ?? summaryOf(members)),
    'GET /v1/fx-rates': () => ok(rates),
    ...world.routes,
  });
  return { ...renderPortal(path), api };
}

describe('Expenses · Groups tabs (17A)', () => {
  it('marks the ledger as the current section on /expenses and Groups on /expenses/groups', async () => {
    portal(`/p/${ORG_A}/expenses`, { routes: { 'GET /v1/expenses': () => ok({ items: [], nextCursor: null }) } });
    const tabs = await screen.findByRole('navigation', { name: 'Expenses pages' });
    expect(within(tabs).getByRole('link', { name: 'Expenses' })).toHaveAttribute('aria-current', 'page');
    expect(within(tabs).getByRole('link', { name: 'Groups' })).not.toHaveAttribute('aria-current');
  });
});

describe('Groups list (3A, 8A)', () => {
  it('invites the first group when there is none', async () => {
    portal(BASE, { groups: [] });
    expect(await screen.findByRole('heading', { name: "Group a trip's spending" })).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Expenses pages' })).getByRole('link', { name: 'Groups' })).toHaveAttribute('aria-current', 'page');
  });

  it('lists ongoing, then upcoming, then past, with dates, days, counts and at most two totals', async () => {
    portal(BASE, {
      groups: [
        group({ id: G3, name: 'Istanbul', startOn: '2026-11-12', endOn: '2026-11-18', windowEnd: '2026-11-18' }),
        group({ id: G2, name: 'Office renovation', startOn: '2025-11-15', endOn: null, windowEnd: '2026-11-15', memberCount: 4, currencies: [{ currency: 'ILS', total: '18400.00', count: 4 }] }),
        group({ memberCount: 23, currencies: [{ currency: 'JOD', total: '412.500', count: 17 }, { currency: 'USD', total: '230.00', count: 5 }, { currency: 'ILS', total: '85.00', count: 1 }] }),
      ],
    });
    const list = await screen.findByRole('list', { name: 'Expense groups' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((li) => within(li).getAllByRole('link')[0]!.textContent)).toEqual([expect.stringContaining('Office renovation'), expect.stringContaining('Istanbul'), expect.stringContaining('Jordan trip')]);
    expect(items[0]).toHaveTextContent('Ongoing');
    expect(items[0]).toHaveTextContent('338 days');
    expect(items[0]).toHaveTextContent('Still going? Add an end date');
    expect(items[1]).toHaveTextContent('Upcoming');
    expect(items[1]).toHaveTextContent('nothing yet');
    expect(items[2]).toHaveTextContent('Past');
    expect(items[2]).toHaveTextContent('5 days · 23 expenses');
    expect(items[2]).toHaveTextContent('+1');
    expect(items[2]).not.toHaveTextContent('85.00');
  });

  it('says when an open group reached a year', async () => {
    portal(BASE, { groups: [group({ startOn: '2025-10-01', endOn: null, windowEnd: '2026-10-01' })] });
    expect(await screen.findByText('This group reached a year — new expenses no longer join')).toBeInTheDocument();
  });

  it('shows the unreachable card and retries', async () => {
    const { user, api } = portal(BASE, { routes: { 'GET /v1/expense-groups': () => fail(503, 'UNAVAILABLE') } });
    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(api.count('GET /v1/expense-groups')).toBe(2));
  });
});

describe('New group (14A, 9A, 10A)', () => {
  it('defaults From to today, needs a name and an end, then lands on the group with a toast', async () => {
    const created = group({ id: G1, startOn: '2026-10-03', endOn: '2026-10-07' });
    const { user, api, router } = portal(BASE, { groups: [], routes: { 'POST /v1/expense-groups': () => ok(created, 201) } });
    await user.click((await screen.findAllByRole('button', { name: 'New group' }))[0]!);
    const drawer = await screen.findByRole('dialog', { name: 'New group' });
    expect(locationOf(router)).toContain('newGroup=true');
    expect(within(drawer).getByLabelText('From')).toHaveValue('2026-10-18');
    expect(within(drawer).getByLabelText('Still going (no end date yet)')).not.toBeChecked();
    expect(within(drawer).getByText('Up to Oct 18, 2027')).toBeInTheDocument();
    await user.click(within(drawer).getByRole('button', { name: 'Create group' }));
    expect(within(drawer).getByText('Give the group a name')).toBeInTheDocument();
    expect(within(drawer).getByText('Pick an end date, or tick Still going')).toBeInTheDocument();
    expect(api.count('POST /v1/expense-groups')).toBe(0);

    await user.type(within(drawer).getByLabelText('Name'), 'Jordan trip');
    await user.clear(within(drawer).getByLabelText('From'));
    await user.type(within(drawer).getByLabelText('From'), '2026-10-03');
    await user.type(within(drawer).getByLabelText('To'), '2026-10-07');
    await user.click(within(drawer).getByRole('button', { name: 'Create group' }));
    await waitFor(() => expect(locationOf(router)).toBe(`${BASE}/${G1}`));
    const post = api.calls.find((c) => c.method === 'POST');
    expect(post?.body).toEqual({ name: 'Jordan trip', startOn: '2026-10-03', endOn: '2026-10-07' });
    expect(post?.headers.get('idempotency-key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(await screen.findByText('Jordan trip created')).toBeInTheDocument();
  });

  it('needs a From date', async () => {
    const { user, api } = portal(`${BASE}?newGroup=1`, { groups: [] });
    const drawer = await screen.findByRole('dialog', { name: 'New group' });
    await user.type(within(drawer).getByLabelText('Name'), 'Trip');
    await user.clear(within(drawer).getByLabelText('From'));
    await user.click(within(drawer).getByLabelText('Still going (no end date yet)'));
    await user.click(within(drawer).getByRole('button', { name: 'Create group' }));
    expect(within(drawer).getByText('Pick the day it starts')).toBeInTheDocument();
    expect(api.count('POST /v1/expense-groups')).toBe(0);
  });

  it('says the profile is full, and a resubmit gets a fresh key instead of the cached refusal (TD-163)', async () => {
    let answer: Handler = () => fail(422, 'VALIDATION_FAILED', { reason: 'GROUP_LIMIT', max: 200 });
    const { user, api } = portal(`${BASE}?newGroup=1`, { groups: [], routes: { 'POST /v1/expense-groups': (r) => answer(r) } });
    const drawer = await screen.findByRole('dialog', { name: 'New group' });
    await user.type(within(drawer).getByLabelText('Name'), 'Trip');
    await user.click(within(drawer).getByLabelText('Still going (no end date yet)'));
    await user.click(within(drawer).getByRole('button', { name: 'Create group' }));
    expect(await within(drawer).findByRole('alert')).toHaveTextContent('This profile already has 200 groups');
    answer = () => ok(group(), 201);
    await user.click(within(drawer).getByRole('button', { name: 'Create group' }));
    await waitFor(() => expect(api.count('POST /v1/expense-groups')).toBe(2));
    const [first, second] = api.calls.filter((c) => c.method === 'POST');
    expect(first!.body).toEqual({ name: 'Trip', startOn: '2026-10-18' });
    expect(second!.headers.get('idempotency-key')).not.toBe(first!.headers.get('idempotency-key'));
  });
});

const taxi = expense('taxi', { occurredOn: '2026-10-03', amount: '18.000', categoryId: TRAVEL, title: 'Airport taxi' });
const rent = expense('rent', { occurredOn: '2026-10-03', amount: '30.000', categoryId: RENT, title: 'Rent October' });
const pass = expense('pass', { occurredOn: '2026-10-05', amount: '66.000', title: 'Dead Sea day pass' });
const esim = expense('esim', { occurredOn: '2026-10-05', amount: '40.00', currency: 'USD', title: 'eSIM top-up' });
const flight = expense('flight', { occurredOn: '2026-09-12', amount: '120.000', categoryId: TRAVEL, title: 'Flight TLV AMM' });

describe('Group page (2A, 4A, 5A, 6A, 7A)', () => {
  it('heads with every currency and ≈ the profile currency at today’s rate, then scopes the chart to the busiest currency', async () => {
    portal(`${BASE}/${G1}`, { members: [flight, taxi, rent, pass, esim] });
    const headline = await screen.findByRole('group', { name: 'Total spent' });
    expect(headline).toHaveTextContent('JOD 234.000');
    expect(headline).toHaveTextContent('4 expenses');
    expect(headline).toHaveTextContent('$40.00');
    expect(headline).toHaveTextContent('1 expense');
    expect(await screen.findByText(/at today's ECB rate \(Oct 17, 2026\)/)).toBeInTheDocument();
    expect(screen.getByText(/1 JOD = 5\.2239 ILS \(USD peg\)/)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'JOD' })).toHaveAttribute('aria-selected', 'true');
    const chart = screen.getByRole('group', { name: 'JOD per day. Arrow keys move between days.' });
    expect(within(chart).getByRole('button', { name: /Sep 12, JOD 120\.000, 1 expense, before the trip/ })).toBeInTheDocument();
    expect(within(chart).getByRole('button', { name: /Wed, Oct 7, no JOD/ })).toBeInTheDocument();
    // Per day: 114.000 in the dates over 5 days; the kept flight doesn't count
    expect(screen.getByText('Per day').parentElement).toHaveTextContent('JOD 22.800');
  });

  it('lists members by day, oldest first, the kept flight under "before the trip"', async () => {
    portal(`${BASE}/${G1}`, { members: [pass, taxi, flight] });
    const table = await screen.findByRole('table', { name: 'Expenses in this group' });
    const rows = within(table).getAllByRole('row').slice(1).map((r) => r.textContent);
    expect(rows[0]).toMatch(/Sep 12.*before the trip/);
    expect(rows[1]).toMatch(/Flight TLV AMM.*Kept/);
    expect(rows[2]).toMatch(/Oct 3/);
    expect(rows[4]).toMatch(/Oct 5/);
    expect(within(table).getByRole('button', { name: 'Remove: Flight TLV AMM' })).toBeInTheDocument();
    expect(within(table).getByRole('button', { name: 'Leave out: Airport taxi' })).toBeInTheDocument();
  });

  it('leaves one out at once: totals drop before the server answers, it moves to Left out, and Undo brings it back', async () => {
    let release: () => void = () => {};
    const { user, api } = portal(`${BASE}/${G1}`, {
      members: [taxi, pass],
      routes: {
        [`PUT /v1/expense-groups/${G1}/expenses/pass`]: () => new Promise<Response>((resolve) => (release = () => resolve(ok({})))),
        [`DELETE /v1/expense-groups/${G1}/expenses/pass`]: () => new Response(null, { status: 204 }),
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Leave out: Dead Sea day pass' }));
    expect(screen.getByRole('group', { name: 'Total spent' })).toHaveTextContent('JOD 18.000');
    expect(screen.getByText('Left out (1)')).toBeInTheDocument();
    expect(api.calls.find((c) => c.method === 'PUT')?.body).toEqual({ mode: 'excluded' });
    release();
    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(api.count(`DELETE /v1/expense-groups/${G1}/expenses/pass`)).toBe(1));
  });

  it('filters by a category and leaves all of it out in one go, one save at a time', async () => {
    const rent2 = expense('rent2', { occurredOn: '2026-10-04', amount: '20.000', categoryId: RENT, title: 'Rent deposit' });
    const { user, api, router } = portal(`${BASE}/${G1}`, {
      members: [taxi, rent, rent2],
      routes: {
        [`PUT /v1/expense-groups/${G1}/expenses/rent`]: () => ok({}),
        [`PUT /v1/expense-groups/${G1}/expenses/rent2`]: () => ok({}),
      },
    });
    await user.click(await screen.findByRole('button', { name: /^Rent/ }));
    await waitFor(() => expect(locationOf(router)).toContain(`category=${RENT}`));
    const table = screen.getByRole('table', { name: 'Expenses in this group' });
    expect(within(table).queryByText('Airport taxi')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Leave out all 2 Rent' }));
    await waitFor(() => expect(api.calls.filter((c) => c.method === 'PUT').map((c) => c.url.pathname.split('/').pop())).toEqual(['rent', 'rent2']));
    expect(await screen.findByText('Left out 2 · Rent')).toBeInTheDocument();
  });

  it('keeps the currency tab while pruning, even when another currency becomes the busiest', async () => {
    const usd2 = expense('usd2', { occurredOn: '2026-10-06', amount: '5.00', currency: 'USD', title: 'Water' });
    const { user } = portal(`${BASE}/${G1}`, {
      members: [taxi, pass, rent, esim, usd2],
      routes: {
        [`PUT /v1/expense-groups/${G1}/expenses/taxi`]: never,
        [`PUT /v1/expense-groups/${G1}/expenses/pass`]: never,
      },
    });
    expect(await screen.findByRole('tab', { name: 'JOD' })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('button', { name: 'Leave out: Airport taxi' }));
    await user.click(screen.getByRole('button', { name: 'Leave out: Dead Sea day pass' }));
    expect(screen.getByRole('group', { name: 'Total spent' })).toHaveTextContent('1 expense');
    expect(screen.getByRole('tab', { name: 'JOD' })).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps the next day’s rows in place when a day empties, so focus moves to the next row', async () => {
    const { user } = portal(`${BASE}/${G1}`, { members: [taxi, pass], routes: { [`PUT /v1/expense-groups/${G1}/expenses/taxi`]: never } });
    const next = await screen.findByRole('button', { name: 'Leave out: Dead Sea day pass' });
    await user.click(screen.getByRole('button', { name: 'Leave out: Airport taxi' }));
    expect(screen.getByRole('button', { name: 'Leave out: Dead Sea day pass' })).toBe(next);
  });

  it('says Uncategorized for expenses with no category, last', async () => {
    portal(`${BASE}/${G1}`, { members: [taxi, pass] });
    await waitFor(() => {
      const buttons = screen.getAllByRole('button', { pressed: false }).filter((b) => b.classList.contains('hp-catbar'));
      expect(buttons.map((b) => b.querySelector('.hp-catbar-name')?.textContent)).toEqual(['Travel', 'Uncategorized']);
    });
  });
});

describe('Group page states (8A)', () => {
  it('a past group with nothing in it offers Add from outside these dates', async () => {
    portal(`${BASE}/${G1}`);
    expect(await screen.findByRole('heading', { name: 'Nothing dated in these days yet' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Add from outside these dates' }).length).toBeGreaterThan(0);
  });

  it('an upcoming group says when it starts', async () => {
    portal(`${BASE}/${G1}`, { groups: [group({ name: 'Istanbul', startOn: '2026-11-12', endOn: '2026-11-18', windowEnd: '2026-11-18' })] });
    expect(await screen.findByRole('heading', { name: 'Istanbul starts Nov 12, 2026' })).toBeInTheDocument();
  });

  it('everything left out opens Left out', async () => {
    portal(`${BASE}/${G1}`, { excluded: [pass] });
    expect(await screen.findByRole('heading', { name: 'Everything here is left out' })).toBeInTheDocument();
    expect(screen.getByText('Left out (1)').closest('details')).toHaveAttribute('open');
  });

  it('Left out failing to load says so in place and retries just that list', async () => {
    let fails = true;
    const { user, api } = portal(`${BASE}/${G1}`, {
      members: [pass],
      routes: {
        'GET /v1/expenses': ({ url }) =>
          url.searchParams.get('groupMembership') === 'excluded'
            ? fails
              ? fail(422, 'VALIDATION_FAILED')
              : ok({ items: [taxi], nextCursor: null })
            : ok({ items: [pass], nextCursor: null }),
      },
    });
    expect(await screen.findByText(/Couldn't load this list\./)).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Total spent' })).toBeInTheDocument();
    fails = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Left out (1)')).toBeInTheDocument();
    expect(api.calls.filter((c) => c.url.searchParams.get('groupMembership') === 'excluded').length).toBe(2);
  });

  it('a deleted group says so and links back', async () => {
    portal(`${BASE}/${G1}`, { routes: { [`GET /v1/expense-groups/${G1}`]: () => fail(404, 'NOT_FOUND') } });
    expect(await screen.findByRole('heading', { name: 'This group was deleted' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Groups' })).toHaveAttribute('href', BASE);
  });

  it('no ≈ line while rates are unavailable; "rate from" when they are stale', async () => {
    portal(`${BASE}/${G1}`, { members: [pass, esim], routes: { 'GET /v1/fx-rates': () => fail(503, 'FX_RATES_UNAVAILABLE') } });
    await screen.findByRole('group', { name: 'Total spent' });
    expect(screen.queryByText(/ECB/)).toBeNull();
  });

  it('shows a stale rate’s date', async () => {
    portal(`${BASE}/${G1}`, { members: [pass, esim], routes: { 'GET /v1/fx-rates': () => ok({ ...rates, source: 'stale', rateDate: '2026-10-14' }) } });
    expect(await screen.findByText(/rate from Oct 14, 2026/)).toBeInTheDocument();
  });

  it('opens in Arabic, right to left, by default', async () => {
    localStorage.clear();
    portal(`${BASE}/${G1}`, { members: [pass], locale: 'ar' });
    expect(await screen.findByRole('group', { name: 'إجمالي المصروف' })).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
  });
});

describe('Edit and delete (9A)', () => {
  it('saves with If-Match, and Delete confirms with the count, then returns to Groups', async () => {
    const g = group({ memberCount: 3 });
    const { user, api, router } = portal(`${BASE}/${G1}?editGroup=1`, {
      groups: [g],
      routes: { [`PATCH /v1/expense-groups/${G1}`]: () => ok({ ...g, name: 'Amman', version: 2 }), [`DELETE /v1/expense-groups/${G1}`]: () => new Response(null, { status: 204 }) },
    });
    const drawer = await screen.findByRole('dialog', { name: 'Edit group' });
    expect(within(drawer).getByText('Changing dates re-checks which expenses belong; kept and left-out choices stay.')).toBeInTheDocument();
    await user.clear(within(drawer).getByLabelText('Name'));
    await user.type(within(drawer).getByLabelText('Name'), 'Amman');
    await user.click(within(drawer).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.count(`PATCH /v1/expense-groups/${G1}`)).toBe(1));
    const patch = api.calls.find((c) => c.method === 'PATCH')!;
    expect(patch.headers.get('if-match')).toBe('1');
    expect(patch.body).toEqual({ name: 'Amman', startOn: '2026-10-03', endOn: '2026-10-07', notes: null });

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const again = await screen.findByRole('dialog', { name: 'Edit group' });
    await user.click(within(again).getByRole('button', { name: 'Delete group' }));
    expect(within(again).getByText('Its 3 expenses stay in Expenses.')).toBeInTheDocument();
    await user.click(within(again).getAllByRole('button', { name: 'Delete group' }).at(-1)!);
    await waitFor(() => expect(locationOf(router)).toBe(BASE));
  });
});

describe('Add from outside these dates (12A)', () => {
  it('offers the 30 days before minus members, saves picks one at a time, and reports a partial result', async () => {
    const visa = expense('visa', { occurredOn: '2026-09-28', title: 'Visa fee' });
    const hotel = expense('hotel', { occurredOn: '2026-09-25', title: 'Hotel deposit' });
    const { user, api } = portal(`${BASE}/${G1}?addToGroup=1`, {
      members: [flight],
      pool: [flight, hotel, visa],
      routes: {
        [`PUT /v1/expense-groups/${G1}/expenses/hotel`]: () => fail(500, 'INTERNAL'),
        [`PUT /v1/expense-groups/${G1}/expenses/visa`]: () => ok({}),
      },
    });
    const drawer = await screen.findByRole('dialog', { name: 'Add to Jordan trip' });
    expect(within(drawer).getByText('Sep 3, 2026 – Oct 2, 2026, not already in this group.')).toBeInTheDocument();
    const pool = api.calls.find((c) => c.url.pathname === '/v1/expenses' && c.url.searchParams.get('from'));
    expect([pool?.url.searchParams.get('from'), pool?.url.searchParams.get('to')]).toEqual(['2026-09-03', '2026-10-02']);
    expect(within(drawer).queryByText(/Flight TLV AMM/)).toBeNull();
    await user.click(await within(drawer).findByLabelText(/Hotel deposit/));
    await user.click(within(drawer).getByLabelText(/Visa fee/));
    await user.click(within(drawer).getByRole('button', { name: 'Add (2)' }));
    expect(await within(drawer).findByRole('alert')).toHaveTextContent('Added 1 of 2 · 1 failed');
    expect(api.calls.filter((c) => c.method === 'PUT').map((c) => [c.url.pathname.split('/').pop(), c.body])).toEqual([
      ['hotel', { mode: 'included' }],
      ['visa', { mode: 'included' }],
    ]);
    expect(within(drawer).getByRole('button', { name: 'Retry 1' })).toBeInTheDocument();
  });
});

describe('In groups on an expense (11A)', () => {
  it('lists its groups with the right verb, and adds it to another group', async () => {
    const other = group({ id: G2, name: 'Amman conference', startOn: '2026-10-10', endOn: '2026-10-12', windowEnd: '2026-10-12' });
    const { user, api } = portal(`/p/${ORG_A}/expenses?expense=${'e0000000-0000-4000-8000-000000000001'}`, {
      groups: [group(), other],
      routes: {
        'GET /v1/expenses/e0000000-0000-4000-8000-000000000001': () => ok({ ...pass, id: 'e0000000-0000-4000-8000-000000000001', receipts: [] }),
        'GET /v1/expenses': () => ok({ items: [], nextCursor: null }),
        [`PUT /v1/expense-groups/${G2}/expenses/e0000000-0000-4000-8000-000000000001`]: () => ok({}),
      },
    });
    const drawer = await screen.findByRole('dialog', { name: 'Edit expense' });
    expect(await within(drawer).findByRole('link', { name: 'Jordan trip' })).toHaveAttribute('href', `${BASE}/${G1}`);
    expect(within(drawer).getByRole('button', { name: 'Leave out: Jordan trip' })).toBeInTheDocument();
    await user.click(within(drawer).getByRole('button', { name: 'Add to group…' }));
    const menu = within(drawer).getByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Amman conference']);
    await user.click(within(menu).getByRole('menuitem', { name: 'Amman conference' }));
    await waitFor(() => expect(api.calls.find((c) => c.method === 'PUT')?.body).toEqual({ mode: 'included' }));
  });

  it('is left out while the groups load', async () => {
    portal(`/p/${ORG_A}/expenses?expense=${'e0000000-0000-4000-8000-000000000001'}`, {
      routes: {
        'GET /v1/expenses/e0000000-0000-4000-8000-000000000001': () => ok({ ...pass, id: 'e0000000-0000-4000-8000-000000000001', receipts: [] }),
        'GET /v1/expenses': () => ok({ items: [], nextCursor: null }),
        'GET /v1/expense-groups': never,
      },
    });
    const drawer = await screen.findByRole('dialog', { name: 'Edit expense' });
    expect(within(drawer).queryByText('In groups')).toBeNull();
  });
});
