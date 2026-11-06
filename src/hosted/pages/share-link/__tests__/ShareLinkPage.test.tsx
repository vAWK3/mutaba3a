import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { fail, locationOf, me, ok, renderPortal, stubApi, type Handler } from '../../../__tests__/harness';
import { ME_KEY } from '../../../session/me';
import { PORTAL_LANGUAGE_KEY } from '../../../i18n/HostedLanguageProvider';
import { resetViewerTokensForTests } from '../viewerTokens';

const reporter = vi.hoisted(() => ({ users: [] as (string | null)[] }));
vi.mock('../../../observability/errorReporting', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../observability/errorReporting')>();
  return {
    ...actual,
    setReporterUser: (id: string | null) => {
      reporter.users.push(id);
      actual.setReporterUser(id);
    },
  };
});

/** MUT-562: a share link's page (layout B): the PIN step, every refusal, and the view once open (AC5, AC6). */

const TOKEN = 't'.repeat(43);
const VIEWER = 'v'.repeat(43);
const KEY = 'AAAAAAAAAAAAAAAAAAAAAA';
const unlock = { viewerToken: VIEWER, viewerExpiresAt: '2026-11-06T20:00:00.000Z', linkExpiresAt: '2026-11-13T12:00:00.000Z', profileName: 'Studio', ownerName: 'Rana Haddad', period: 'LAST_3_MONTHS', from: '2026-08-01', to: '2026-10-31' };
const entries = {
  items: [
    { kind: 'expense', createdAt: '2026-10-30T09:00:00.000Z', expense: { key: KEY, occurredOn: '2026-10-30', amount: '350.00', currency: 'ILS', title: 'Office rent', vendor: null, category: 'Rent', client: null, project: null, notes: null, vat: null, receiptCount: 1 } },
    { kind: 'received', createdAt: '2026-10-28T09:00:00.000Z', origin: 'capture', settlesOwed: false, replacesPayment: false, income: { key: 'BBBBBBBBBBBBBBBBBBBBBB', occurredOn: '2026-10-28', amount: '3200.00', currency: 'ILS', title: 'Brand identity', client: null } },
  ],
  nextCursor: null,
};
const summary = { from: '2026-08-01', to: '2026-10-31', expenses: [{ currency: 'ILS', total: '4812.40', count: 9, byCategory: [], byClient: [] }], received: [{ currency: 'ILS', total: '9600.00', count: 3 }] };

function routes(extra: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    'GET /v1/me': () => fail(401, 'UNAUTHENTICATED'),
    'POST /v1/share-links/check': () => ok({ state: 'pin' }),
    'POST /v1/share-links/unlock': () => ok(unlock),
    'POST /v1/share-links/summary': () => ok(summary),
    'POST /v1/share-links/entries': () => ok(entries),
    'POST /v1/share-links/expense-receipts': () => ok({ items: [{ filename: 'rent.png', mimeType: 'image/png', url: 'https://files.test/rent.png', expiresAt: '2099-01-01T00:00:00.000Z' }] }),
    ...extra,
  };
}

async function typePin(user: ReturnType<typeof renderPortal>['user'], pin: string) {
  const group = await screen.findByRole('group', { name: 'Enter the PIN you were given' });
  await user.click(within(group).getAllByRole('textbox')[0]);
  await user.keyboard(pin);
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetViewerTokensForTests();
  reporter.users.length = 0;
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener: () => {}, removeEventListener: () => {} }));
});
afterEach(() => vi.unstubAllGlobals());

describe('the PIN step', () => {
  it('strips the token, sets noindex and no-referrer, and names nothing before the PIN', async () => {
    const api = stubApi(routes());
    const { router } = renderPortal(`/share#${TOKEN}`);
    expect(await screen.findByRole('heading', { name: 'Enter the PIN you were given' })).toBeInTheDocument();
    expect(locationOf(router)).toBe('/share');
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
    expect(document.head.querySelector('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');
    expect(document.body).not.toHaveTextContent(/Rana|Studio/);
    expect(api.calls.find((c) => c.url.pathname === '/v1/share-links/check')?.body).toEqual({ token: TOKEN });
    expect(sessionStorage.getItem('mtb3a-share-link')).toBe(TOKEN);
  });

  it('a wrong PIN says how many tries are left', async () => {
    stubApi(routes({ 'POST /v1/share-links/unlock': () => fail(403, 'SHARE_LINK_REFUSED', { reason: 'PIN_WRONG', attemptsLeft: 4 }) }));
    const { user } = renderPortal(`/share#${TOKEN}`);
    await typePin(user, '1111');
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("That PIN isn't right. 4 tries left, then the link locks.");
  });

  it.each([
    ['locked', () => fail(403, 'SHARE_LINK_REFUSED', { reason: 'LOCKED' }), 'This link is locked'],
    ['viewer limit', () => fail(403, 'SHARE_LINK_REFUSED', { reason: 'VIEWER_LIMIT' }), 'This link has reached its viewer limit'],
    ['gone', () => fail(404, 'NOT_FOUND', { reason: 'SHARE_LINK_UNAVAILABLE' }), 'This link is no longer available'],
  ])('%s on unlock', async (_name, answer, heading) => {
    stubApi(routes({ 'POST /v1/share-links/unlock': answer }));
    const { user } = renderPortal(`/share#${TOKEN}`);
    await typePin(user, '4821');
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
  });

  it.each([
    ['gone', () => fail(404, 'NOT_FOUND', { reason: 'SHARE_LINK_UNAVAILABLE' })],
    ['locked', () => fail(403, 'SHARE_LINK_REFUSED', { reason: 'LOCKED' })],
    ['limit', () => fail(403, 'SHARE_LINK_REFUSED', { reason: 'VIEWER_LIMIT' })],
  ])('%s: the tab forgets the link token', async (_name, answer) => {
    stubApi(routes({ 'POST /v1/share-links/unlock': answer }));
    const { user } = renderPortal(`/share#${TOKEN}`);
    await typePin(user, '4821');
    expect(sessionStorage.getItem('mtb3a-share-link')).toBe(TOKEN);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(sessionStorage.getItem('mtb3a-share-link')).toBeNull());
  });

  it('a locked link says so before any PIN', async () => {
    stubApi(routes({ 'POST /v1/share-links/check': () => fail(403, 'SHARE_LINK_REFUSED', { reason: 'LOCKED' }) }));
    renderPortal(`/share#${TOKEN}`);
    expect(await screen.findByRole('heading', { name: 'This link is locked' })).toBeInTheDocument();
  });

  it('Arabic-Indic digits are sent as 0–9', async () => {
    const api = stubApi(routes());
    const { user } = renderPortal(`/share#${TOKEN}`);
    await typePin(user, '٤٨٢١');
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await screen.findByRole('heading', { name: 'Rana Haddad · Studio' });
    expect(api.calls.find((c) => c.url.pathname === '/v1/share-links/unlock')?.body).toEqual({ token: TOKEN, pin: '4821' });
  });
});

describe('the open link', () => {
  it('shows the owner and profile, the band per currency and the entries; the viewer token is kept for next time', async () => {
    const api = stubApi(routes());
    const { user } = renderPortal(`/share#${TOKEN}`);
    await typePin(user, '4821');
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(await screen.findByRole('heading', { name: 'Rana Haddad · Studio' })).toBeInTheDocument();
    const band = screen.getByRole('region', { name: 'Summary' });
    expect(band).toHaveTextContent('Aug – Oct 2026 · read-only');
    expect(await within(band).findByText('Spent')).toBeInTheDocument();
    const table = await screen.findByRole('table', { name: 'Entries' });
    expect(within(table).getByText('Office rent')).toBeInTheDocument();
    expect(within(table).getByText('Rent')).toBeInTheDocument();
    expect(api.calls.find((c) => c.url.pathname === '/v1/share-links/entries')?.body).toMatchObject({ viewerToken: VIEWER });
    const stored = Object.values({ ...localStorage }).map((value) => (value.startsWith('{') ? (JSON.parse(value) as { viewerToken?: string }) : {}));
    expect(stored).toContainEqual({ viewerToken: VIEWER, viewerExpiresAt: unlock.viewerExpiresAt, linkExpiresAt: unlock.linkExpiresAt });
    expect(JSON.stringify({ ...localStorage })).not.toContain(TOKEN);
  });

  it('Expenses only narrows the feed', async () => {
    const api = stubApi(routes());
    const { user } = renderPortal(`/share#${TOKEN}`);
    await typePin(user, '4821');
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await screen.findByRole('table', { name: 'Entries' });
    await user.click(screen.getByRole('radio', { name: 'Expenses' }));
    await waitFor(() => expect(api.calls.filter((c) => c.url.pathname === '/v1/share-links/entries').at(-1)?.body).toMatchObject({ kinds: ['expense'] }));
  });

  it('View shows a receipt from the link', async () => {
    stubApi(routes());
    const { user } = renderPortal(`/share#${TOKEN}`);
    await typePin(user, '4821');
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.click(await screen.findByRole('button', { name: 'Office rent' }));
    const pane = await screen.findByRole('dialog', { name: 'Receipts' });
    expect(await within(pane).findByRole('img', { name: 'rent.png' })).toHaveAttribute('src', 'https://files.test/rent.png');
  });

  it('after 8 hours the PIN is asked again, and only then', async () => {
    stubApi(routes({ 'POST /v1/share-links/entries': () => fail(401, 'UNAUTHENTICATED', { reason: 'SHARE_VIEW_EXPIRED' }) }));
    const { user } = renderPortal(`/share#${TOKEN}`);
    await typePin(user, '4821');
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(await screen.findByRole('heading', { name: 'Enter the PIN again' })).toBeInTheDocument();
    expect(screen.getByText('For safety, the PIN is asked for every 8 hours.')).toBeInTheDocument();
  });

  it('a signed-in owner opening a link and getting a 401 stays signed in, and the crash reporter forgets them meanwhile', async () => {
    const signedIn = me();
    stubApi(routes({ 'GET /v1/me': () => ok(signedIn), 'POST /v1/share-links/entries': () => fail(401, 'UNAUTHENTICATED', { reason: 'SHARE_VIEW_EXPIRED' }) }));
    const { user, router, queryClient } = renderPortal(`/share#${TOKEN}`);
    queryClient.setQueryData(ME_KEY, signedIn);
    await typePin(user, '4821');
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(await screen.findByRole('heading', { name: 'Enter the PIN again' })).toBeInTheDocument();
    expect(locationOf(router)).toBe('/share');
    expect(queryClient.getQueryData(ME_KEY)).toBe(signedIn);
    expect(reporter.users[0]).toBeNull();
    await router.navigate({ to: '/sign-in' });
    await waitFor(() => expect(reporter.users.at(-1)).toBe(signedIn.user.id));
  });

  it('downloads the link’s period with the viewer token, minted for both files at once', async () => {
    const sent: Record<string, string>[] = [];
    vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(function (this: HTMLFormElement) {
      sent.push(Object.fromEntries(new FormData(this) as unknown as Iterable<[string, string]>));
    });
    const api = stubApi(
      routes({
        'POST /v1/share-links/download-ticket': (request) => {
          const type = (request.body as { type: string }).type;
          return ok({ type, ticket: `${type}-t`, expiresAt: '2099-01-01T00:00:00.000Z', filename: 'f', estimate: { expenses: 9, income: 3, receipts: 2, receiptBytes: 300 * 1024 } });
        },
      }),
    );
    const { user } = renderPortal(`/share#${TOKEN}`);
    await typePin(user, '4821');
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.click(await screen.findByRole('button', { name: 'Download' }));
    expect(await screen.findByText('2 receipts · about 300 KB')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Receipts (zip)' }));
    expect(sent).toEqual([{ ticket: 'receipts-t', viewerToken: VIEWER }]);
    const mints = api.calls.filter((c) => c.url.pathname === '/v1/share-links/download-ticket').map((c) => c.body as { viewerToken: string; asOf: string });
    expect(mints).toHaveLength(2);
    expect(mints.every((m) => m.viewerToken === VIEWER && m.asOf === mints[0]!.asOf)).toBe(true);
    vi.restoreAllMocks();
  });
});

