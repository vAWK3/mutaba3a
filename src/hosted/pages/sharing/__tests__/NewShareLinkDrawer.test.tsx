import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import type { BillingEntitlement, Me, ShareLink, ShareLinkCreated } from '../../../api/client';
import { ORG_A, ORG_B, emptyProfileRoutes, fail, locationOf, me, never, ok, profile, renderPortal, stubApi, type Handler } from '../../../__tests__/harness';

const track = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../../../analytics/portalAnalytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../analytics/portalAnalytics')>()),
  trackPortal: track,
}));

/**
 * MUT-561 slice B: the New link drawer (B3) and its done pane (B4). Whole months by name (OW3), a PIN of 4–8 digits
 * (Arabic-Indic too), the link shown once with Copy link and Copy message (Basel 13244's text, never the PIN), and
 * nothing of the URL or PIN left once it closes (D3).
 */

const NOW = new Date('2026-11-06T10:00:00.000Z');
const URL_ONCE = 'https://portal.test/share#k7Qp29fXhb3Lk7Qp29fXhb3Lk7Qp29fXhb3L';
const personal = profile({ id: ORG_A, name: 'Personal', owned: true, type: 'PERSONAL', isPersonalDefault: true, writerOfRecord: null, owners: [] });
const studio = profile({ id: ORG_B, name: 'Studio', owned: true, type: 'BUSINESS', isPersonalDefault: false, writerOfRecord: null, owners: [] });
const account = (overrides: Partial<Me> = {}): Me => { const base = me([personal, studio]); return { ...base, user: { ...base.user, features: ['accountant_access'] }, clients: [], ...overrides }; };

const created = (body: { period: ShareLinkCreated['period']; expiresInDays: number }): ShareLinkCreated => ({
  id: 'l-new',
  url: URL_ONCE,
  period: body.period,
  from: body.period === 'WHOLE_PROFILE' ? null : '2026-08-01',
  to: body.period === 'WHOLE_PROFILE' ? '2026-11-06' : '2026-10-31',
  expiresAt: new Date(NOW.getTime() + body.expiresInDays * 86_400_000).toISOString(),
  createdAt: NOW.toISOString(),
});

function portal(answer: Handler, who: Me = account(), language: 'en' | 'ar' = 'en') {
  const items: ShareLink[] = [];
  const stub = stubApi({
    ...emptyProfileRoutes(),
    'GET /v1/me': () => ok({ ...who, user: { ...who.user, locale: language } }),
    [`GET /v1/profiles/${ORG_B}/accountants`]: () => ok({ items: [], limit: 5 }),
    [`GET /v1/profiles/${ORG_B}/share-links`]: () => ok({ items, limit: 3 }),
    [`POST /v1/profiles/${ORG_B}/share-links`]: async (request) => {
      const response = await answer(request);
      if (response.status === 201) {
        const made = (await response.clone().json()) as ShareLinkCreated;
        items.push({ id: made.id, period: made.period, from: made.from, to: made.to, createdAt: made.createdAt, expiresAt: made.expiresAt, lastOpenedAt: null, status: 'active', endedAt: null, viewers: 0, maxViewers: 3, createdByName: 'Nour Haddad' });
      }
      return response;
    },
  });
  return { ...renderPortal(`/p/${ORG_B}/you/sharing?newLink=true`), stub };
}

const make: Handler = ({ body }) => ok(created(body as { period: ShareLinkCreated['period']; expiresInDays: number }), 201);

async function fillAndCreate(user: ReturnType<typeof renderPortal>['user'], pin: string) {
  const dialog = await screen.findByRole('dialog', { name: 'New link' });
  const field = within(dialog).getByLabelText('PIN (4–8 digits)');
  await user.clear(field);
  await user.type(field, pin);
  await user.click(screen.getByRole('button', { name: 'Create link' }));
  return dialog;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  track.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the New link form (B3)', () => {
  it('names each period by its whole months (made on 6 Nov 2026), defaults to the last 3 months and 7 days', async () => {
    portal(make);
    const dialog = await screen.findByRole('dialog', { name: 'New link' });
    const periods = within(within(dialog).getByRole('group', { name: 'Period' })).getAllByRole('radio');
    expect(periods.map((radio) => radio.closest('label')?.textContent)).toEqual(['Last month · Oct 2026', 'Last 2 months · Sep – Oct 2026', 'Last 3 months · Aug – Oct 2026', 'Whole profile']);
    expect(periods[2]).toBeChecked();
    expect(within(within(dialog).getByRole('group', { name: 'Works for' })).getByRole('radio', { name: '7 days' })).toBeChecked();
    const pin = within(dialog).getByLabelText('PIN (4–8 digits)');
    expect(pin).toHaveAttribute('inputmode', 'numeric');
    expect(pin).toHaveAttribute('dir', 'ltr');
  });

  it('review 2: the PIN field never looks like a password to a password manager, and masks by style; Show/Hide toggles it', async () => {
    const { user } = portal(make);
    const dialog = await screen.findByRole('dialog', { name: 'New link' });
    const pin = within(dialog).getByLabelText('PIN (4–8 digits)');
    expect(pin).toHaveAttribute('type', 'text');
    expect(pin).toHaveAttribute('autocomplete', 'one-time-code');
    expect(pin).toHaveClass('hp-pin-masked');
    await user.click(within(dialog).getByRole('button', { name: 'Show' }));
    expect(pin).not.toHaveClass('hp-pin-masked');
    expect(pin).toHaveAttribute('type', 'text');
    await user.click(within(dialog).getByRole('button', { name: 'Hide' }));
    expect(pin).toHaveClass('hp-pin-masked');
  });

  it('review 4: the months follow the clock: past midnight into a new month, the chips name the new months', async () => {
    vi.setSystemTime(new Date('2026-10-31T21:30:00.000Z')); // 23:30 on 31 Oct in Jerusalem
    const { user } = portal(make);
    const dialog = await screen.findByRole('dialog', { name: 'New link' });
    const label = (name: RegExp) => within(dialog).getByRole('radio', { name }).closest('label')?.textContent;
    expect(label(/^Last month/)).toBe('Last month · Sep 2026');
    vi.setSystemTime(new Date('2026-10-31T22:30:00.000Z')); // 00:30 on 1 Nov
    await user.click(within(dialog).getByRole('radio', { name: /^Last month/ }));
    expect(label(/^Last month/)).toBe('Last month · Oct 2026');
  });

  it.each(['123', '12a4'])('refuses the PIN %j under the field, sending nothing', async (pin) => {
    const { user, stub } = portal(make);
    const dialog = await fillAndCreate(user, pin);
    expect(within(dialog).getByText('The PIN is 4 to 8 digits.')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('PIN (4–8 digits)')).toHaveAttribute('aria-invalid', 'true');
    expect(stub.count(`POST /v1/profiles/${ORG_B}/share-links`)).toBe(0);
  });

  it('takes Arabic-Indic digits and sends them as 0–9, with the period and days chosen', async () => {
    const { user, stub } = portal(make);
    const dialog = await screen.findByRole('dialog', { name: 'New link' });
    await user.click(within(dialog).getByRole('radio', { name: 'Whole profile' }));
    await user.click(within(dialog).getByRole('radio', { name: '30 days' }));
    await fillAndCreate(user, '٤٨٢١');
    await waitFor(() => expect(stub.calls.find((call) => call.method === 'POST')?.body).toEqual({ period: 'WHOLE_PROFILE', expiresInDays: 30, pin: '4821' }));
  });

  it.each([
    ['PIN_FORMAT', () => fail(422, 'VALIDATION_FAILED', { reason: 'PIN_FORMAT', field: 'pin' }), 'field', 'The PIN is 4 to 8 digits.'],
    ['SHARE_LINK_LIMIT', () => fail(409, 'CONFLICT', { reason: 'SHARE_LINK_LIMIT', limit: 3 }), 'banner', 'This profile already has 3 live links, the most it can. Turn one off first.'],
    ['RATE_LIMITED', () => fail(429, 'RATE_LIMITED'), 'banner', 'Too many links in an hour. Try again later.'],
  ])('%s shows in its %s', async (_code, answer, slot, message) => {
    const { user } = portal(answer);
    const dialog = await fillAndCreate(user, '4821');
    if (slot === 'banner') expect(await within(dialog).findByRole('alert')).toHaveTextContent(message);
    else expect(await within(dialog).findByText(message)).toBeInTheDocument();
  });

  it('is busy while making: one request', async () => {
    const { user, stub } = portal(never);
    await fillAndCreate(user, '4821');
    await user.click(screen.getByRole('button', { name: 'Create link' }));
    expect(stub.count(`POST /v1/profiles/${ORG_B}/share-links`)).toBe(1);
    expect(screen.getByRole('button', { name: 'Create link' })).toHaveAttribute('aria-busy', 'true');
  });

  it('under the lapse gate it opens read-only', async () => {
    const locked: BillingEntitlement = { state: 'LOCKED', source: 'TRIAL', tier: 'FREELANCER', until: null };
    portal(make, account({ profiles: [personal, { ...studio, billing: locked }], billingStanding: 'locked' }));
    const dialog = await screen.findByRole('dialog', { name: 'New link' });
    expect(within(dialog).getByRole('note')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Create link' })).not.toBeInTheDocument();
  });
});

describe('the done pane (B4)', () => {
  it('shows the link once with its period, end and viewers; Copy link copies it; Copy message copies the 13244 text, never the PIN', async () => {
    const { user } = portal(make);
    const dialog = await fillAndCreate(user, '4821');
    expect(await within(dialog).findByRole('heading', { name: 'Your link is ready' })).toBeInTheDocument();
    expect(dialog.querySelector('[data-scene-art="link-ready"]:not([data-placeholder]) svg')).not.toBeNull();
    expect(within(dialog).getByText('Aug – Oct 2026 · works until Nov 13 · up to 3 viewers')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Link')).toHaveValue(URL_ONCE);
    expect(within(dialog).getByText("Send the PIN separately — we won't show the link or the PIN again.")).toBeInTheDocument();
    expect(track).toHaveBeenCalledWith('share_link_created', { period: 'last_3_months', expires_in_days: 7 });

    await user.click(within(dialog).getByRole('button', { name: 'Copy link' }));
    expect(await navigator.clipboard.readText()).toBe(URL_ONCE);
    expect(within(dialog).getByRole('status')).toHaveTextContent('Link copied');

    await user.click(within(dialog).getByRole('button', { name: 'Copy message' }));
    const message = await navigator.clipboard.readText();
    expect(message).toBe(`Hi, I've shared the books of “Studio” for Aug – Oct 2026 with you on MTB3A: ${URL_ONCE} — the link works until Nov 13. I'll send you the PIN separately.`);
    expect(message).not.toContain('4821');
  });

  it('in Arabic, the message is Basel\'s Arabic text', async () => {
    const { user } = portal(make, account(), 'ar');
    const dialog = await screen.findByRole('dialog', { name: 'رابط جديد' });
    await user.type(within(dialog).getByLabelText('الرمز (4–8 أرقام)'), '4821');
    await user.click(screen.getByRole('button', { name: 'إنشاء الرابط' }));
    await user.click(await within(dialog).findByRole('button', { name: 'نسخ الرسالة' }));
    const message = await navigator.clipboard.readText();
    expect(message).toMatch(/^مرحباً، شاركتُ معك دفاتر «Studio» لفترة آب – تشرين الأول 2026 على متابعة: https:\/\/portal\.test\/share#\S+ — يعمل الرابط حتى 13 تشرين الثاني\. سأرسل لك الرمز بشكل منفصل\.$/);
  });

  it('review 1: neither the PIN nor the URL ever enters the mutation cache', async () => {
    const { user, queryClient } = portal(make);
    const dialog = await fillAndCreate(user, '4821');
    await within(dialog).findByRole('heading', { name: 'Your link is ready' });
    const mutations = () => JSON.stringify(queryClient.getMutationCache().getAll().map((m) => [m.state.variables, m.state.data]));
    expect(mutations()).not.toMatch(/4821|k7Qp29fX/);
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mutations()).not.toMatch(/4821|k7Qp29fX/);
    expect(document.body.innerHTML).not.toMatch(/4821|k7Qp29fX/);
  });

  it('Done closes it: the URL leaves the page, the address and the cache, and the list shows the link 0 / 3', async () => {
    const { user, router, queryClient } = portal(make);
    const dialog = await fillAndCreate(user, '4821');
    await within(dialog).findByRole('heading', { name: 'Your link is ready' });
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(locationOf(router)).not.toContain('newLink');
    expect(document.body.innerHTML).not.toContain('k7Qp29fX');
    expect(JSON.stringify(queryClient.getQueryCache().getAll().map((q) => q.state.data))).not.toContain('k7Qp29fX');
    expect(await screen.findByRole('table', { name: 'Links with a PIN' })).toHaveTextContent('0 / 3');
  });
});
