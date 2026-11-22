import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { ORG_A, emptyProfileRoutes, fail, locationOf, me, ok, profile, renderPortal, stubApi, type Handler } from '../../__tests__/harness';
import type { OrganizationSummary, ReceiptListItem } from '../../api/client';
import { PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';
import { CUSTOMERS, C1, C2, C3, page } from './fixtures';

/**
 * MUT-657: home, "Two lanes". An Add lane (drop zone, Add receipt, Take a photo, Add income) beside a Waiting lane of
 * groups (To review, Clients overdue), each hidden at 0, one calm sentence when nothing waits, and no totals.
 */

const R1 = 'b0000000-0000-4000-8000-000000000001';
const R2 = 'b0000000-0000-4000-8000-000000000002';
const STORAGE = 'https://storage.googleapis.com/qa-bucket';
const HOME = `/p/${ORG_A}`;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
});
afterEach(() => vi.unstubAllGlobals());

function receipt(id: string, over: Partial<ReceiptListItem> = {}): ReceiptListItem {
  return {
    id,
    expenseId: null,
    filename: `${id.slice(-1)}.pdf`,
    mimeType: 'application/pdf',
    sizeBytes: 1000,
    status: 'READY',
    filingStatus: 'TO_REVIEW',
    receivedOn: '2026-11-20',
    suggested: null,
    approved: null,
    approvedAt: null,
    version: 1,
    uploadedByUserId: null,
    createdAt: '2026-11-20T09:00:00Z',
    completedAt: '2026-11-20T09:00:01Z',
    reading: null,
    expense: null,
    ...over,
  };
}

function row(customerId: string, status: string, daysOverdue: number | null, overdue = '0.00') {
  return { customerId, status, daysOverdue, outstanding: '1500.00', overdue, dueToday: '0.00', notYetDue: '0.00', unallocated: '0.00', oldestOverdueDueDate: null, lastPaymentOn: null, proposals: [] };
}

function summary(rows: ReturnType<typeof row>[]): OrganizationSummary {
  return {
    asOf: '2026-11-22',
    currencies: [{ currency: 'ILS', outstanding: '4500.00', overdue: '3000.00', dueToday: '0.00', notYetDue: '0.00', unallocated: '0.00', proposed: '0.00', counts: { customers: rows.length, overdueCustomers: 0, unallocatedPayments: 0, openProposals: 0 }, customers: rows }],
  } as unknown as OrganizationSummary;
}

/** The person's own business profile: it records income and receipts (the harness default is Malafat-fed). */
const OWN = profile({ writerOfRecord: null, owned: true, type: 'BUSINESS', access: { payments: 'read-write', capture: 'read-write', expenses: 'read-write' }, income: { received: true, owed: true, customer: 'optional' } });

const BUSY = summary([row(C1, 'OVERDUE', 5, '1500.00'), row(C2, 'OVERDUE', 12, '1500.00'), row(C3, 'OUTSTANDING', null)]);

interface World {
  receipts?: ReceiptListItem[];
  counts?: Handler;
  summary?: OrganizationSummary;
  routes?: Record<string, Handler>;
  account?: ReturnType<typeof me>;
}

function portal(path: string = HOME, world: World = {}) {
  const items = world.receipts ?? [];
  const api = stubApi({
    'GET /v1/me': () => ok(world.account ?? me([OWN])),
    ...emptyProfileRoutes(),
    'GET /v1/customers': () => ok(page(CUSTOMERS)),
    'GET /v1/summaries/organization': () => ok(world.summary ?? summary([])),
    'GET /v1/receipts/counts': world.counts ?? (() => ok({ toReview: items.length, filed: 0 })),
    'GET /v1/receipts': () => ok({ items, nextCursor: null }),
    ...world.routes,
  });
  return { ...renderPortal(path), api };
}

const waitingLane = () => screen.findByRole('region', { name: 'Waiting for you' });

describe('home, Receipts & to-dos (MUT-657)', () => {
  it('opens on the bare profile path with the Add lane first, then the Waiting lane', async () => {
    portal(HOME, { receipts: [receipt(R1)], summary: BUSY });
    expect(await screen.findByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument();
    const add = await screen.findByRole('region', { name: 'Add' });
    const waiting = await waitingLane();
    expect(add.compareDocumentPosition(waiting) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(await within(add).findByRole('button', { name: 'Add receipt' })).toBeInTheDocument();
    expect(within(add).getByRole('button', { name: 'Add income' })).toBeInTheDocument();
    expect(within(add).getByText('Drop receipts here')).toBeInTheDocument();
  });

  it('shows the receipts to review, at most 8, linking to the receipt and to the gallery', async () => {
    const { api } = portal(HOME, { receipts: [receipt(R1), receipt(R2)], counts: () => ok({ toReview: 9, filed: 0 }) });
    const group = await screen.findByRole('region', { name: 'To review' });
    await waitFor(() => expect(within(group).getAllByRole('listitem')).toHaveLength(2));
    expect(within(group).getByText('9 receipts to review')).toBeInTheDocument();
    expect(within(group).getByRole('link', { name: 'See all receipts to review' })).toHaveAttribute('href', `/p/${ORG_A}/expenses/receipts`);
    expect(within(group).getByRole('link', { name: `Open ${R1.slice(-1)}.pdf` })).toHaveAttribute('href', `/p/${ORG_A}/expenses/receipts/${R1}`);
    const list = api.calls.find((c) => c.url.pathname === '/v1/receipts');
    expect(list?.url.searchParams.get('limit')).toBe('8');
    expect(list?.url.searchParams.get('filingStatus')).toBe('TO_REVIEW');
  });

  it('names up to three overdue clients, most days late first, with no amounts, each opening the client', async () => {
    portal(HOME, { summary: BUSY });
    const group = await screen.findByRole('region', { name: 'Clients overdue' });
    const rows = await within(group).findAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual(['Nablus Trading12 days late', 'Al-Quds Bakery5 days late']);
    expect(within(group).getByRole('link', { name: /Nablus Trading/ })).toHaveAttribute('href', `/p/${ORG_A}/clients/${C2}`);
    expect(within(group).getByRole('link', { name: 'See all clients overdue' })).toHaveAttribute('href', `/p/${ORG_A}/owed`);
    expect(within(group).queryByRole('button', { name: /Remind/ })).toBeNull();
  });

  it('shows no totals anywhere on Receipts & to-dos', async () => {
    const filed = receipt(R2, { expense: { vendor: 'Spinneys', title: null, amount: '212.00', currency: 'ILS', occurredOn: '2026-11-20', categoryId: null } });
    portal(HOME, { receipts: [receipt(R1), filed], summary: BUSY });
    await screen.findByRole('region', { name: 'Clients overdue' });
    await screen.findByRole('region', { name: 'To review' });
    expect(screen.getByRole('main').querySelector('.hp-amount')).toBeNull();
  });

  it('hides each group at zero', async () => {
    portal(HOME, { receipts: [receipt(R1)], summary: summary([row(C3, 'OUTSTANDING', null)]) });
    await screen.findByRole('region', { name: 'To review' });
    expect(screen.queryByRole('region', { name: 'Clients overdue' })).toBeNull();
  });

  it('says one calm sentence when nothing waits', async () => {
    portal(HOME, { summary: summary([row(C3, 'OUTSTANDING', null)]) });
    expect(await screen.findByText('Nothing needs you right now.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'To review' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Clients overdue' })).toBeNull();
  });

  it('when the library is off, the receipt parts give way to the unavailable copy and overdue still shows', async () => {
    portal(HOME, { counts: () => fail(404, 'NOT_FOUND'), summary: BUSY });
    expect(await screen.findByText("Receipts aren't available here")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add receipt' })).toBeNull();
    expect(screen.queryByText('Drop receipts here')).toBeNull();
    expect(await screen.findByRole('region', { name: 'Clients overdue' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'To review' })).toBeNull();
  });

  it('uploads a picked file into To review with the gallery\'s rules', async () => {
    const { user, api } = portal(HOME, {
      routes: {
        'POST /v1/receipts/uploads': () => ok({ receipt: { id: R2, status: 'PENDING_UPLOAD' }, upload: { url: `${STORAGE}/upload/${R2}`, method: 'PUT', headers: {}, expiresAt: '2099-01-01T00:00:00Z' } }, 201),
        [`PUT /qa-bucket/upload/${R2}`]: () => new Response(null, { status: 200 }),
        [`POST /v1/receipts/${R2}/complete`]: () => ok({ id: R2, status: 'READY' }),
      },
    });
    await screen.findByRole('region', { name: 'Add' });
    await user.upload(await screen.findByTestId('home-receipt-input'), new File(['png'], 'lunch.png', { type: 'image/png' }));
    expect(await screen.findByText('1 receipt added to To review')).toBeInTheDocument();
    expect(api.count('POST /v1/receipts/uploads')).toBe(1);
  });

  it('offers Take a photo as a camera pick of a JPEG or PNG', async () => {
    portal(HOME);
    await screen.findByRole('region', { name: 'Add' });
    const camera = await screen.findByTestId('home-photo-input');
    expect(camera).toHaveAttribute('accept', 'image/jpeg,image/png');
    expect(camera).toHaveAttribute('capture', 'environment');
    expect(screen.getByRole('button', { name: 'Take a photo' })).toBeInTheDocument();
  });

  it('Add income opens the income drawer over home', async () => {
    const { user, router } = portal(HOME);
    await user.click(await screen.findByRole('button', { name: 'Add income' }));
    expect(locationOf(router)).toBe(`/p/${ORG_A}?newIncome=received`);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('a read-only profile adds nothing', async () => {
    portal(HOME, { account: { ...me([{ ...OWN, billing: { state: 'READ_ONLY', source: 'TRIAL', until: '2099-01-01T00:00:00Z' } as never }]), billingStanding: 'read-only' } as never, summary: BUSY });
    await screen.findByRole('region', { name: 'Clients overdue' });
    expect(screen.queryByRole('button', { name: 'Add receipt' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add income' })).toBeNull();
  });
});

const FOOD = 'f0000000-0000-4000-8000-000000000001';
const RENT = 'f0000000-0000-4000-8000-000000000002';

function activity() {
  return {
    from: '2026-11-01',
    to: '2026-11-30',
    bucket: 'day',
    asOf: '2026-11-22',
    dataSince: '2026-01-01',
    earlierData: false,
    buckets: [],
    currencies: [
      { currency: 'ILS', received: '12750.00', spent: '3980.00', byCategory: [{ categoryId: RENT, total: '1200.00', count: 1 }, { categoryId: FOOD, total: '1450.00', count: 4 }, { categoryId: null, total: '330.00', count: 2 }], byCustomer: [] },
      { currency: 'USD', received: '640.00', spent: '0.00', byCategory: [], byCustomer: [] },
    ],
    history: [],
  };
}

const IN_OUT: World['routes'] = {
  'GET /v1/summaries/activity': () => ok(activity()),
  'GET /v1/expense-categories': () => ok({ items: [{ id: FOOD, name: 'Food', color: null, archived: false, version: 1, createdAt: '', updatedAt: '' }, { id: RENT, name: 'Rent', color: null, archived: true, version: 1, createdAt: '', updatedAt: '' }] }),
};

describe('home, In & out (MUT-657)', () => {
  it('opens from ?view=in-out with this month in and out, owed and overdue now, and the ways on', async () => {
    const { api } = portal(`${HOME}?view=in-out`, { summary: BUSY, routes: IN_OUT });
    expect(await screen.findByRole('button', { name: 'In & out' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Receipts & to-dos' })).toHaveAttribute('aria-pressed', 'false');
    const moneyIn = await screen.findByRole('region', { name: 'Money in' });
    await within(moneyIn).findByText(/12,750\.00/);
    expect(within(moneyIn).getByText(/4,500\.00/)).toBeInTheDocument();
    expect(within(moneyIn).getByText(/3,000\.00/)).toBeInTheDocument();
    expect(within(moneyIn).getByRole('link', { name: /Open Owed/ })).toHaveAttribute('href', `/p/${ORG_A}/owed`);
    const moneyOut = screen.getByRole('region', { name: 'Money out' });
    expect(within(moneyOut).getByText(/3,980\.00/)).toBeInTheDocument();
    const bars = within(moneyOut).getAllByRole('listitem').map((li) => li.textContent);
    expect(bars[0]).toMatch(/^Food/);
    expect(bars[1]).toMatch(/^Rent/);
    expect(bars[2]).toMatch(/^Uncategorized/);
    expect(within(moneyOut).getByRole('link', { name: /Open Spent/ })).toHaveAttribute('href', `/p/${ORG_A}/expenses`);
    expect(screen.getByRole('link', { name: /Compare months in Reports/ })).toHaveAttribute('href', `/p/${ORG_A}/reports`);
    const read = api.calls.find((c) => c.url.pathname === '/v1/summaries/activity');
    expect(read?.url.searchParams.get('from')).toMatch(/-01$/);
    expect(read?.url.searchParams.get('bucket')).toBe('day');
    // No receipts read for this view
    expect(api.count('GET /v1/receipts')).toBe(0);
  });

  it('shows one currency at a time, picked on the page and never in the address', async () => {
    const { user, router } = portal(`${HOME}?view=in-out`, { summary: BUSY, routes: IN_OUT });
    const moneyIn = await screen.findByRole('region', { name: 'Money in' });
    await within(moneyIn).findByText(/12,750\.00/);
    await user.click(screen.getByRole('tab', { name: 'USD' }));
    expect(await within(moneyIn).findByText(/640\.00/)).toBeInTheDocument();
    expect(locationOf(router)).toBe(`/p/${ORG_A}?view=in-out`);
  });

  it('switches views in the address, and coming back to home opens Receipts & to-dos', async () => {
    const { user, router } = portal(HOME, { summary: BUSY, routes: IN_OUT });
    await user.click(await screen.findByRole('button', { name: 'In & out' }));
    expect(locationOf(router)).toBe(`/p/${ORG_A}?view=in-out`);
    await screen.findByRole('region', { name: 'Money in' });
    const nav = screen.getByRole('navigation', { name: 'Sections' });
    await user.click(within(nav).getByRole('link', { name: 'Paid' }));
    await user.click(within(nav).getByRole('link', { name: 'Home' }));
    expect(locationOf(router)).toBe(`/p/${ORG_A}`);
    expect(await screen.findByRole('button', { name: 'Receipts & to-dos' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('region', { name: 'Money in' })).toBeNull();
  });
});
