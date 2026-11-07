import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import type { Me, PeriodDownloadTicket } from '../../../api/client';
import { ORG_A, ORG_B, emptyProfileRoutes, fail, me, ok, profile, renderPortal, stubApi, type Handler, type StubRequest } from '../../../__tests__/harness';

const track = vi.hoisted(() => vi.fn(async () => {}));
const post = vi.hoisted(() => vi.fn());
vi.mock('../../../analytics/portalAnalytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../analytics/portalAnalytics')>()),
  trackPortal: track,
}));
vi.mock('../../../data/periodDownload', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../data/periodDownload')>()),
  postDownload: post,
}));

/**
 * MUT-561 + MUT-314 (Basel, MUT-558 13244): the owner's "Download a period" at the bottom of the Sharing page. Whole
 * months, a ticket that says what the period holds, then the browser's own download; one asOf for both files; the
 * caps' refusals in plain words; hidden while the server has period downloads off.
 */

const NOW = new Date('2026-11-06T10:00:00.000Z');
const personal = profile({ id: ORG_A, name: 'Personal', owned: true, type: 'PERSONAL', isPersonalDefault: true, writerOfRecord: null, owners: [] });
const studio = profile({ id: ORG_B, name: 'Studio', owned: true, type: 'BUSINESS', isPersonalDefault: false, writerOfRecord: null, owners: [] });
const account = (): Me => {
  const base = me([personal, studio]);
  return { ...base, user: { ...base.user, features: ['accountant_access'] }, clients: [] };
};

const ticket = (type: 'report' | 'receipts', expiresAt = new Date(NOW.getTime() + 120_000).toISOString()): PeriodDownloadTicket => ({
  type,
  ticket: `ticket-${type}`,
  expiresAt,
  filename: type === 'report' ? 'mutaba3a-Studio-2026-09-2026-10.xlsx' : 'mutaba3a-Studio-receipts.zip',
  estimate: { expenses: 84, income: 12, receipts: 29, receiptBytes: 12_900_000 },
});

/** The probe (`type=none`) answers 422 while downloads are on, as the server's validation does. */
const on = (answer: Handler = ({ url }) => ok(ticket(url.searchParams.get('type') as 'report' | 'receipts'))): Handler => (request) =>
  request.url.searchParams.get('type') === 'none' ? fail(422, 'VALIDATION_FAILED', [{ path: ['type'] }]) : answer(request);

function portal(tickets?: Handler) {
  const stub = stubApi({
    ...emptyProfileRoutes(),
    'GET /v1/me': () => ok(account()),
    [`GET /v1/profiles/${ORG_B}/accountants`]: () => ok({ items: [], limit: 5 }),
    ...(tickets ? { 'GET /v1/period-downloads/ticket': tickets } : {}),
  });
  return { ...renderPortal(`/p/${ORG_B}/you/sharing`), stub };
}

const tickets = (calls: StubRequest[]) => calls.filter((call) => call.url.pathname === '/v1/period-downloads/ticket' && call.url.searchParams.get('type') !== 'none');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  track.mockClear();
  post.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Download a period (MUT-314 on the Sharing page)', () => {
  it('is hidden while the server has period downloads off (404)', async () => {
    portal();
    await screen.findByRole('heading', { name: "You haven't shared this profile yet" });
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Download a period' })).not.toBeInTheDocument());
  });

  it('offers whole months up to this one, last month by default', async () => {
    portal(on());
    const section = (await screen.findByRole('heading', { name: 'Download a period' })).closest('section') as HTMLElement;
    const from = within(section).getByLabelText('From') as HTMLSelectElement;
    expect(from.value).toBe('2026-10');
    expect(within(from).getAllByRole('option')).toHaveLength(24);
    expect(within(from).getAllByRole('option')[0]).toHaveTextContent('Nov 2026');
    expect((within(section).getByLabelText('To') as HTMLSelectElement).value).toBe('2026-10');
  });

  it('Receipts: the ticket says what the period holds; Download posts it and counts it, with no ids or dates', async () => {
    const { user, stub } = portal(on());
    const section = (await screen.findByRole('heading', { name: 'Download a period' })).closest('section') as HTMLElement;
    await user.selectOptions(within(section).getByLabelText('From'), '2026-09');
    await user.click(within(section).getByRole('button', { name: 'Receipts (zip)' }));
    expect(await within(section).findByText('Receipts for Sep – Oct 2026: 29 · about 12.3 MB')).toBeInTheDocument();
    const asked = tickets(stub.calls)[0];
    expect(Object.fromEntries(asked.url.searchParams)).toMatchObject({ type: 'receipts', from: '2026-09', to: '2026-10', lang: 'en', asOf: NOW.toISOString() });
    expect(asked.headers.get('X-Mutaba3a-Profile')).toBe(ORG_B);

    await user.click(within(section).getByRole('button', { name: 'Download' }));
    expect(post).toHaveBeenCalledWith('ticket-receipts');
    expect(track).toHaveBeenCalledWith('period_downloaded', { place: 'owner', file: 'receipts', months: 2 });
    expect(within(section).getByText('Your download has started.')).toBeInTheDocument();
  });

  it('the report and the receipts of one period share one asOf', async () => {
    const { user, stub } = portal(on());
    const section = (await screen.findByRole('heading', { name: 'Download a period' })).closest('section') as HTMLElement;
    await user.click(within(section).getByRole('button', { name: 'Excel report' }));
    expect(await within(section).findByText('Excel report for Oct 2026: 84 expenses · 12 income')).toBeInTheDocument();
    vi.setSystemTime(new Date(NOW.getTime() + 60_000));
    await user.click(within(section).getByRole('button', { name: 'Receipts (zip)' }));
    await within(section).findByText(/^Receipts for Oct 2026/);
    const [report, receipts] = tickets(stub.calls);
    expect(receipts.url.searchParams.get('asOf')).toBe(report.url.searchParams.get('asOf'));
  });

  it('a ticket that expired before Download is replaced, with the same asOf, before posting', async () => {
    let n = 0;
    const { user, stub } = portal(on(({ url }) => ok({ ...ticket(url.searchParams.get('type') as 'report'), ticket: `ticket-${++n}` })));
    const section = (await screen.findByRole('heading', { name: 'Download a period' })).closest('section') as HTMLElement;
    await user.click(within(section).getByRole('button', { name: 'Excel report' }));
    await within(section).findByText(/^Excel report for/);
    vi.setSystemTime(new Date(NOW.getTime() + 121_000));
    await user.click(within(section).getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('ticket-2'));
    const [first, second] = tickets(stub.calls);
    expect(second.url.searchParams.get('asOf')).toBe(first.url.searchParams.get('asOf'));
  });

  it.each([
    ['PERIOD_TOO_LARGE', () => fail(422, 'VALIDATION_FAILED', { reason: 'PERIOD_TOO_LARGE', type: 'receipts', limit: 524288000, estimate: 600000000 }), 'This period is too large to download at once. Pick fewer months.'],
    ['RATE_LIMITED', () => fail(429, 'RATE_LIMITED'), 'Too many downloads in an hour. Try again later.'],
  ])('%s is said plainly, and nothing is posted', async (_code, answer, message) => {
    const { user } = portal(on(answer));
    const section = (await screen.findByRole('heading', { name: 'Download a period' })).closest('section') as HTMLElement;
    await user.click(within(section).getByRole('button', { name: 'Receipts (zip)' }));
    expect(await within(section).findByRole('alert')).toHaveTextContent(message);
    expect(post).not.toHaveBeenCalled();
  });
});
