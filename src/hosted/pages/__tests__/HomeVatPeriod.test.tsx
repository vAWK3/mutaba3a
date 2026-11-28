import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { ORG_A, emptyProfileRoutes, fail, me, ok, profile, renderPortal, stubApi, type Handler } from '../../__tests__/harness';
import type { Schemas } from '../../api/client';
import { PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';

/**
 * MUT-783 (MUT-782, ADR-343): the client's VAT period on home. "VAT · Sep – Oct 2026" with the filing day and one Done
 * (once: the button is gone after it), then what the accountant did: waiting, confirmed, or asked for more with a note.
 * Nothing at all before the first period or while the server's switch is off; no money.
 */
const HOME = `/p/${ORG_A}`;
const CURRENT = `GET /v1/profiles/${ORG_A}/vat-periods/current`;
const DONE = `POST /v1/profiles/${ORG_A}/vat-periods/2026-B5/done`;
const OWN = profile({ writerOfRecord: null, owned: true, type: 'BUSINESS', access: { payments: 'read-write', capture: 'read-write', expenses: 'read-write' }, income: { received: true, owed: true, customer: 'optional' } });

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
});
afterEach(() => vi.unstubAllGlobals());

const period = (over: Partial<Schemas['VatPeriodView']> = {}): Schemas['VatPeriodView'] => ({
  periodKey: '2026-B5', kind: 'BIMONTHLY', year: 2026, firstMonth: 9, lastMonth: 10, startDate: '2026-09-01', endDate: '2026-10-31', due: '2026-11-15',
  state: 'OPEN', note: null, announcedAt: new Date().toISOString(), doneAt: null, ...over,
});

function portal(routes: Record<string, Handler> = {}) {
  const api = stubApi({
    'GET /v1/me': () => ok(me([OWN])),
    ...emptyProfileRoutes(),
    'GET /v1/receipts/counts': () => ok({ toReview: 0, filed: 0 }),
    'GET /v1/receipts': () => ok({ items: [], nextCursor: null }),
    ...routes,
  });
  return { ...renderPortal(HOME), api };
}
const lane = () => screen.findByRole('region', { name: 'Waiting for you' });
const group = () => screen.findByRole('region', { name: 'VAT · Sep – Oct 2026' });

describe('home: the client\'s VAT period (MUT-783)', () => {
  it('shows the open period with its filing day and a Done button, inside the Waiting lane', async () => {
    portal({ [CURRENT]: () => ok({ period: period() }) });
    const vat = await group();
    expect(within(await lane()).getByRole('region', { name: 'VAT · Sep – Oct 2026' })).toBe(vat);
    expect(within(vat).getByText('Nov 15')).toBeInTheDocument();
    expect(within(vat).getByRole('button', { name: 'Done' })).toBeInTheDocument();
    expect(screen.queryByText('Nothing needs you right now.')).toBeNull();
  });

  it('Done is one tap: it posts once, the button goes, and the line says it waits for the accountant', async () => {
    const { api, user } = portal({ [CURRENT]: () => ok({ period: period() }), [DONE]: () => ok(period({ state: 'CLIENT_DONE', doneAt: new Date().toISOString() })) });
    const vat = await group();
    await user.click(within(vat).getByRole('button', { name: 'Done' }));
    expect(await within(vat).findByText('Waiting for your accountant')).toBeInTheDocument();
    expect(within(vat).queryByRole('button', { name: 'Done' })).toBeNull();
    expect(api.count(DONE)).toBe(1);
  });

  it('a yearly period names no filing day', async () => {
    portal({ [CURRENT]: () => ok({ period: period({ periodKey: '2026-Y', kind: 'YEARLY', firstMonth: 1, lastMonth: 12, due: null }) }) });
    const vat = await screen.findByRole('region', { name: 'VAT · 2026' });
    expect(within(vat).getByRole('button', { name: 'Done' })).toBeInTheDocument();
    expect(vat.querySelector('.hp-vat-line')).toBeNull();
  });

  it('shows a confirmed period as a quiet line with no Done', async () => {
    portal({ [CURRENT]: () => ok({ period: period({ state: 'CONFIRMED' }) }) });
    const vat = await group();
    expect(within(vat).getByText('Confirmed by your accountant')).toBeInTheDocument();
    expect(within(vat).queryByRole('button', { name: 'Done' })).toBeNull();
  });

  it('hides a period confirmed more than a month ago', async () => {
    portal({ [CURRENT]: () => ok({ period: period({ state: 'CONFIRMED', announcedAt: '2026-01-01T06:00:00.000Z' }) }) });
    expect(await screen.findByText('Nothing needs you right now.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /VAT/ })).toBeNull();
  });

  it('shows the accountant\'s note on more needed, and lets the client say Done again', async () => {
    const { user } = portal({ [CURRENT]: () => ok({ period: period({ state: 'MORE_NEEDED', note: 'October fuel' }) }), [DONE]: () => ok(period({ state: 'CLIENT_DONE' })) });
    const vat = await group();
    expect(within(vat).getByText('Your accountant needs more')).toBeInTheDocument();
    expect(within(vat).getByText('October fuel')).toBeInTheDocument();
    await user.click(within(vat).getByRole('button', { name: 'Done' }));
    expect(await within(vat).findByText('Waiting for your accountant')).toBeInTheDocument();
  });

  it('says so when Done could not be saved, and keeps the button', async () => {
    const { user } = portal({ [CURRENT]: () => ok({ period: period() }), [DONE]: () => fail(500, 'INTERNAL') });
    const vat = await group();
    await user.click(within(vat).getByRole('button', { name: 'Done' }));
    expect(await within(vat).findByRole('alert')).toHaveTextContent("Couldn't save. Try again.");
    expect(within(vat).getByRole('button', { name: 'Done' })).toBeInTheDocument();
  });

  it.each([
    ['no period yet', () => ok({ period: null })],
    ['the switch is off (404)', () => fail(404, 'NOT_FOUND')],
    ['not an owner (403)', () => fail(403, 'READ_ONLY_PROFILE')],
  ])('draws nothing when %s', async (_name, handler) => {
    portal({ [CURRENT]: handler });
    expect(await screen.findByText('Nothing needs you right now.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /VAT/ })).toBeNull();
  });

  it('writes the period and the state in Arabic, right to left', async () => {
    localStorage.setItem(PORTAL_LANGUAGE_KEY, 'ar');
    portal({ [CURRENT]: () => ok({ period: period({ firstMonth: 1, lastMonth: 2, state: 'CLIENT_DONE' }) }) });
    const vat = await screen.findByRole('region', { name: /ضريبة القيمة المضافة/ });
    expect(vat).toHaveTextContent('كانون الثاني');
    expect(within(vat).getByText('بانتظار المحاسب')).toBeInTheDocument();
  });

  it('carries no money', async () => {
    portal({ [CURRENT]: () => ok({ period: period() }) });
    await group();
    await waitFor(() => expect(screen.getByRole('main').querySelector('.hp-amount')).toBeNull());
  });
});
