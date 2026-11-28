import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import type { AccountantClientWithStats, Schemas } from '../../../api/client';
import { emptyProfileRoutes, fail, locationOf, me, ok, profile, renderPortal, stubApi, type Handler } from '../../../__tests__/harness';
import { PORTAL_LANGUAGE_KEY } from '../../../i18n/HostedLanguageProvider';

/**
 * MUT-783 (MUT-782, ADR-343): the accountant's desk with each client's VAT period. A period, its filing day and a state
 * word on every row; filter chips with counts; a VAT drawer on `?vat=` to confirm, ask for more with a note, and
 * choose how often the client files. No column and no chips while the server's switch is off.
 */
const CAFE = '11111111-1111-4111-8111-111111111111';
const BAKERY = '22222222-2222-4222-8222-222222222222';
const STUDIO = '33333333-3333-4333-8333-333333333333';
const OLD = '44444444-4444-4444-8444-444444444444';
const KEY = '2026-B5';

const book = (profileId: string, name: string, over: Partial<AccountantClientWithStats> = {}): AccountantClientWithStats => ({
  profileId, name, ownerName: `${name} Owner`, sharedSince: '2026-11-01T09:00:00.000Z', profileType: 'business', status: 'active', endedReason: null, endedAt: null, entriesThisMonth: 3, lastActivityAt: '2026-11-20T09:00:00.000Z', needsPlan: false, ...over,
} as AccountantClientWithStats);
const view = (state: Schemas['VatPeriodState'], over: Partial<Schemas['VatPeriodView']> = {}): Schemas['VatPeriodView'] => ({
  periodKey: KEY, kind: 'BIMONTHLY', year: 2026, firstMonth: 9, lastMonth: 10, startDate: '2026-09-01', endDate: '2026-10-31', due: '2026-11-15', state, note: null, announcedAt: '2026-11-01T06:00:00.000Z', doneAt: null, ...over,
});
type Item = Schemas['ClientVatPeriodsResponse']['items'][number];
const item = (profileId: string, period: Schemas['VatPeriodView'] | null, chosenKind: Schemas['VatPeriodKind'] | null = null): Item => ({ profileId, kind: period ? period.kind : 'NONE', chosenKind, period });

const CLIENTS = [book(CAFE, 'Café Nour'), book(BAKERY, 'Bakery'), book(STUDIO, 'Studio'), book(OLD, 'Old client', { status: 'ended', endedReason: 'revoked', endedAt: '2026-11-10T09:00:00.000Z' })];

/** The desk with a mutable VAT state, so a write is visible on the next read like on the server. */
function desk(items: Item[] | null, routes: Record<string, Handler> = {}, path = '/client-books') {
  let current = items;
  const api = stubApi({
    'GET /v1/me': () => ok(me([profile({ owned: true, isPersonalDefault: true, type: 'personal' })])),
    ...emptyProfileRoutes(),
    'GET /v1/billing': () => ok({ configured: false }),
    'GET /v1/clients': () => ok({ items: CLIENTS }),
    'GET /v1/accountant/customers': () => fail(403, 'ACCOUNTANT_NOT_APPROVED'),
    'GET /v1/clients/vat-periods': () => (current === null ? fail(404, 'NOT_FOUND') : ok({ items: current })),
    ...routes,
  });
  return { ...renderPortal(path), api, set: (next: Item[]) => void (current = next) };
}

const rowOf = (table: HTMLElement, text: string) => within(table).getAllByRole('row').find((r) => r.textContent?.includes(text))!;
const THREE = [item(CAFE, view('OPEN')), item(BAKERY, view('CLIENT_DONE')), item(STUDIO, view('CONFIRMED'))];

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener: () => {}, removeEventListener: () => {} }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the desk: VAT period column and chips', () => {
  it('shows the period, its filing day and a state word on each client', async () => {
    desk(THREE);
    const table = await screen.findByRole('table', { name: 'Client books' });
    await within(table).findByText('Waiting for client');
    expect(rowOf(table, 'Café Nour')).toHaveTextContent('Sep – Oct 2026');
    expect(rowOf(table, 'Café Nour')).toHaveTextContent('Nov 15');
    expect(rowOf(table, 'Café Nour')).toHaveTextContent('Waiting for client');
    expect(rowOf(table, 'Bakery')).toHaveTextContent('Client sent');
    expect(rowOf(table, 'Studio')).toHaveTextContent('Confirmed');
    expect(within(table).getByRole('columnheader', { name: 'VAT' })).toBeInTheDocument();
  });

  it('shows "VAT period" for a client with none, and nothing for an ended client', async () => {
    desk([item(CAFE, null)]);
    const table = await screen.findByRole('table', { name: 'Client books' });
    await within(table).findAllByText('VAT period');
    expect(rowOf(table, 'Café Nour')).toHaveTextContent('VAT period');
    expect(within(rowOf(table, 'Old client')).queryByRole('button', { name: /VAT period:/ })).toBeNull();
  });

  it('counts clients per state in the chips and filters by one', async () => {
    const { user } = desk([...THREE, item(OLD, null)]);
    const chips = await screen.findByRole('group', { name: 'VAT state' });
    expect(within(chips).getByRole('button', { name: /^All/ })).toHaveTextContent('4');
    expect(within(chips).getByRole('button', { name: /Client sent/ })).toHaveTextContent('1');
    await user.click(within(chips).getByRole('button', { name: /Confirmed/ }));
    const table = screen.getByRole('table', { name: 'Client books' });
    expect(within(table).queryByText('Café Nour')).toBeNull();
    expect(within(table).getByText('Studio')).toBeInTheDocument();
  });

  it('says all confirmed when every client with a period has confirmed', async () => {
    desk([item(CAFE, view('CONFIRMED')), item(BAKERY, view('CONFIRMED')), item(STUDIO, null)]);
    expect(await screen.findByText('All confirmed')).toBeInTheDocument();
  });

  it('has no VAT column and no chips while the switch is off (404)', async () => {
    desk(null);
    const table = await screen.findByRole('table', { name: 'Client books' });
    await waitFor(() => expect(table).toBeInTheDocument());
    expect(within(table).queryByRole('columnheader', { name: 'VAT' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'VAT state' })).toBeNull();
  });

  it('writes the column in Arabic', async () => {
    localStorage.setItem(PORTAL_LANGUAGE_KEY, 'ar');
    desk([item(CAFE, view('CLIENT_DONE', { firstMonth: 1, lastMonth: 2 }))]);
    const table = await screen.findByRole('table');
    await within(table).findByText('أرسل العميل');
    expect(table).toHaveTextContent('كانون الثاني');
  });
});

describe('the VAT drawer, edge cases', () => {
  it('does not open from the URL while the switch is off, or for a client the server does not list', async () => {
    desk(null, {}, `/client-books?vat=${CAFE}`);
    await screen.findByRole('table', { name: 'Client books' });
    expect(screen.queryByRole('dialog', { name: 'Café Nour' })).toBeNull();
  });

  it('after Confirm the footer no longer offers Confirm, so it cannot be sent twice', async () => {
    const { user, api, set } = desk(THREE, {
      [`POST /v1/clients/${BAKERY}/vat-periods/${KEY}/review`]: () => {
        set([item(CAFE, view('OPEN')), item(BAKERY, view('CONFIRMED')), item(STUDIO, view('CONFIRMED'))]);
        return ok(view('CONFIRMED'));
      },
    }, `/client-books?vat=${BAKERY}`);
    const drawer = await screen.findByRole('dialog', { name: 'Bakery' });
    await user.click(await within(drawer).findByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(within(drawer).queryByRole('button', { name: 'Confirm' })).toBeNull());
    expect(api.count(`POST /v1/clients/${BAKERY}/vat-periods/${KEY}/review`)).toBe(1);
    expect(within(drawer).queryByRole('alert')).toBeNull();
  });

  it('a filter does not outlive the chips: when no client has a period any more, every row shows again', async () => {
    const { user, set, queryClient } = desk(THREE);
    const chips = await screen.findByRole('group', { name: 'VAT state' });
    await user.click(within(chips).getByRole('button', { name: /Confirmed/ }));
    set([item(CAFE, null), item(BAKERY, null), item(STUDIO, null)]);
    await queryClient.invalidateQueries({ queryKey: ['clientBooks', 'vatPeriods'] });
    const table = screen.getByRole('table', { name: 'Client books' });
    await waitFor(() => expect(screen.queryByRole('group', { name: 'VAT state' })).toBeNull());
    expect(within(table).getByText('Café Nour')).toBeInTheDocument();
  });
});

describe('the VAT drawer', () => {
  it('opens from the row on ?vat= and shows the period and its state', async () => {
    const { user, router } = desk(THREE);
    const table = await screen.findByRole('table', { name: 'Client books' });
    await user.click(await within(rowOf(table, 'Café Nour')).findByRole('button', { name: 'VAT period: Café Nour' }));
    const drawer = await screen.findByRole('dialog', { name: 'Café Nour' });
    expect(locationOf(router)).toBe(`/client-books?vat=${CAFE}`);
    expect(within(drawer).getByText('VAT · Sep – Oct 2026')).toBeInTheDocument();
    expect(within(drawer).getByText('Waiting for client')).toBeInTheDocument();
  });

  it('Confirm posts the decision and the row moves to Confirmed', async () => {
    let handled: unknown;
    const { user, api, set } = desk(THREE, {
      [`POST /v1/clients/${BAKERY}/vat-periods/${KEY}/review`]: (req) => {
        handled = req.body;
        set([item(CAFE, view('OPEN')), item(BAKERY, view('CONFIRMED')), item(STUDIO, view('CONFIRMED'))]);
        return ok(view('CONFIRMED'));
      },
    }, `/client-books?vat=${BAKERY}`);
    const drawer = await screen.findByRole('dialog', { name: 'Bakery' });
    await user.click(await within(drawer).findByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(api.count(`POST /v1/clients/${BAKERY}/vat-periods/${KEY}/review`)).toBe(1));
    expect(handled).toEqual({ decision: 'CONFIRMED' });
    await waitFor(() => expect(within(screen.getByRole('dialog', { name: 'Bakery' })).queryByRole('button', { name: 'Confirm' })).toBeNull());
    expect(rowOf(screen.getByRole('table', { name: 'Client books' }), 'Bakery')).toHaveTextContent('Confirmed');
  });

  it('Ask for more has its own pane with a note, posts it, and returns to the summary', async () => {
    let handled: unknown;
    const { user } = desk(THREE, {
      [`POST /v1/clients/${BAKERY}/vat-periods/${KEY}/review`]: (req) => {
        handled = req.body;
        return ok(view('MORE_NEEDED', { note: 'October fuel' }));
      },
    }, `/client-books?vat=${BAKERY}`);
    const drawer = await screen.findByRole('dialog', { name: 'Bakery' });
    await user.click(await within(drawer).findByRole('button', { name: 'Ask for more' }));
    const note = within(drawer).getByRole('textbox', { name: 'Note' });
    expect(note).toHaveAttribute('maxlength', '200');
    await user.type(note, 'October fuel');
    await user.click(within(drawer).getByRole('button', { name: 'Ask for more' }));
    await waitFor(() => expect(handled).toEqual({ decision: 'MORE_NEEDED', note: 'October fuel' }));
    await waitFor(() => expect(within(drawer).queryByRole('textbox', { name: 'Note' })).toBeNull());
  });

  it('Cancel leaves the Ask pane without sending anything', async () => {
    const { user, api } = desk(THREE, {}, `/client-books?vat=${BAKERY}`);
    const drawer = await screen.findByRole('dialog', { name: 'Bakery' });
    await user.click(await within(drawer).findByRole('button', { name: 'Ask for more' }));
    await user.click(within(drawer).getByRole('button', { name: 'Cancel' }));
    expect(within(drawer).queryByRole('textbox', { name: 'Note' })).toBeNull();
    expect(api.calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('a confirmed period offers no review', async () => {
    desk(THREE, {}, `/client-books?vat=${STUDIO}`);
    const drawer = await screen.findByRole('dialog', { name: 'Studio' });
    await within(drawer).findByText('Confirmed');
    expect(within(drawer).queryByRole('button', { name: 'Confirm' })).toBeNull();
    expect(within(drawer).queryByRole('button', { name: 'Ask for more' })).toBeNull();
  });

  it('chooses how often the client files', async () => {
    let handled: unknown;
    const { user } = desk(THREE, {
      [`PUT /v1/clients/${CAFE}/vat-period`]: (req) => {
        handled = req.body;
        return ok({ kind: 'MONTHLY' });
      },
    }, `/client-books?vat=${CAFE}`);
    const drawer = await screen.findByRole('dialog', { name: 'Café Nour' });
    await user.selectOptions(await within(drawer).findByRole('combobox', { name: 'VAT period' }), 'MONTHLY');
    await waitFor(() => expect(handled).toEqual({ kind: 'MONTHLY' }));
  });

  it('shows the choice with no period yet, and says when a save failed', async () => {
    const { user } = desk([item(CAFE, null)], { [`PUT /v1/clients/${CAFE}/vat-period`]: () => fail(500, 'INTERNAL') }, `/client-books?vat=${CAFE}`);
    const drawer = await screen.findByRole('dialog', { name: 'Café Nour' });
    const select = await within(drawer).findByRole('combobox', { name: 'VAT period' });
    expect(select).toHaveValue('NONE');
    expect(within(drawer).queryByRole('button', { name: 'Confirm' })).toBeNull();
    await user.selectOptions(select, 'BIMONTHLY');
    expect(await within(drawer).findByRole('alert')).toHaveTextContent("Couldn't save. Try again.");
  });
});
