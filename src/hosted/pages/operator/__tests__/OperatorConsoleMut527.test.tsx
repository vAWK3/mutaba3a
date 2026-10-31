import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import type { Me, OperatorAccount, OperatorAccountListItem } from '../../../api/client';
import { fail, locationOf, me, never, ok, profile, renderPortal, stubApi, type Handler } from '../../../__tests__/harness';
import { PORTAL_LANGUAGE_KEY } from '../../../i18n/HostedLanguageProvider';

/**
 * MUT-527: the operator console's account list (search as you type, Load more, its empty, loading and error states),
 * Your settings (the operator mark, passkeys with the deep link, the step-up, your own features), the no-passkey note
 * on every page, and feature names (receipt_reading named in both languages; an unknown flag humanised).
 */
const browser = vi.hoisted(() => ({ startAuthentication: vi.fn() }));
vi.mock('@simplewebauthn/browser', async (importOriginal) => {
  const real = await importOriginal<typeof import('@simplewebauthn/browser')>();
  return { ...real, startAuthentication: browser.startAuthentication, browserSupportsWebAuthn: () => true, browserSupportsWebAuthnAutofill: async () => false };
});

const NOW = new Date('2026-10-27T12:00:00.000Z');
const FRESH = '2026-10-27T12:08:00.000Z';
const STALE = '2026-10-27T11:50:00.000Z';
const CHALLENGE = { challengeId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', publicKey: { challenge: 'abc', rpId: 'localhost', allowCredentials: [] } };
const ASSERTION = { id: 'cred', rawId: 'cred', type: 'public-key', response: { clientDataJSON: 'e30', authenticatorData: 'e30', signature: 'e30', userHandle: 'dQ' }, clientExtensionResults: {} };

const operator = (locale: 'en' | 'ar' = 'en'): Me => {
  const account = me([profile()], locale);
  return { ...account, user: { ...account.user, operator: true } };
};
const OPERATOR_ID = operator().user.id;

const mine = (overrides: Partial<OperatorAccount> = {}): OperatorAccount => ({
  id: OPERATOR_ID,
  email: 'basel@studio.example',
  displayName: 'Basel Sader',
  locale: 'en',
  status: 'ACTIVE',
  passwordChangedAt: '2026-10-01T09:00:00.000Z',
  lastSignInAt: '2026-10-27T11:00:00.000Z',
  createdAt: '2026-10-01T09:00:00.000Z',
  closing: false,
  operator: true,
  operatorSince: '2026-10-20T09:00:00.000Z',
  passkeyCount: 2,
  passkeyLastUsedAt: '2026-10-27T10:00:00.000Z',
  features: [],
  activeSessionCount: 1,
  agentGrantCount: 0,
  availableFeatures: ['agent_access', 'receipt_reading', 'bank_feeds'],
  profiles: [],
  ...overrides,
});

const row = (n: number, overrides: Partial<OperatorAccountListItem> = {}): OperatorAccountListItem => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  email: `person${n}@studio.example`,
  displayName: `Person ${n}`,
  status: 'ACTIVE',
  operator: false,
  lastSignInAt: null,
  features: [],
  ...overrides,
});

const PEOPLE = [
  row(1, { email: 'basel@studio.example', displayName: 'Basel Sader', operator: true, lastSignInAt: '2026-10-27T11:00:00.000Z', features: ['receipt_reading'] }),
  row(2, { email: 'rana@studio.example', displayName: 'Rana Basel', status: 'DISABLED' }),
  row(3, { email: 'sara@studio.example', displayName: 'Sara Khalil', status: 'PENDING_REVIEW' }),
];

function listHandler(people: OperatorAccountListItem[], stepUpUntil: string | null): Handler {
  return (request) => {
    const q = (request.url.searchParams.get('q') ?? '').toLowerCase();
    const matched = people.filter((p) => !q || p.email.includes(q) || p.displayName.toLowerCase().includes(q));
    const start = Number(request.url.searchParams.get('cursor') ?? 0);
    const page = matched.slice(start, start + 2);
    return ok({ data: page, nextCursor: start + 2 < matched.length ? String(start + 2) : null, stepUpUntil });
  };
}

function portal({ who = operator(), own = mine(), people = PEOPLE, stepUpUntil = FRESH as string | null, extra = {} as Record<string, Handler>, path = '/operator/accounts' } = {}) {
  let current = own;
  const api = stubApi({
    'GET /v1/me': () => ok(who),
    'GET /v1/operator/signup-reviews': () => ok({ data: [], nextCursor: null, stepUpUntil }),
    'GET /v1/operator/firm-requests': () => ok({ data: [], nextCursor: null, stepUpUntil }),
    'GET /v1/operator/accounts': listHandler(people, stepUpUntil),
    [`GET /v1/operator/accounts/${OPERATOR_ID}`]: () => ok({ account: current, stepUpUntil }),
    [`GET /v1/operator/accounts/${OPERATOR_ID}/billing-grants`]: () => ok({ grants: [], stepUpUntil }),
    [`PUT /v1/operator/accounts/${OPERATOR_ID}/features/receipt_reading`]: () => {
      current = { ...current, features: [...current.features, 'receipt_reading'] };
      return ok({ feature: 'receipt_reading', grantedAt: NOW.toISOString(), granted: true });
    },
    [`DELETE /v1/operator/accounts/${OPERATOR_ID}/features/receipt_reading`]: () => {
      current = { ...current, features: current.features.filter((f) => f !== 'receipt_reading') };
      return ok({ feature: 'receipt_reading', revoked: true });
    },
    'POST /v1/operator/step-up/options': () => ok(CHALLENGE),
    'POST /v1/operator/step-up': () => ok({ stepUpUntil: FRESH }),
    ...extra,
  });
  return { ...renderPortal(path), api };
}

const list = async (name = 'Accounts') => within(await screen.findByRole('list', { name }));
const emails = (scope: ReturnType<typeof within>) => scope.getAllByRole('link').map((link) => link.querySelector('.hp-operator-email')?.textContent);
const plain = (text: string | null | undefined) => (text ?? '').replace(/[⁨⁩]/g, '');

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  localStorage.clear();
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
  vi.stubGlobal('__PASSKEY_RP_ID__', 'localhost');
  browser.startAuthentication.mockReset().mockResolvedValue(ASSERTION);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the account list (AC1)', () => {
  it('opens on every account without a search: who, status, operator, last sign-in and the features on', async () => {
    portal();
    const rows = await list();
    expect(emails(rows)).toEqual(['basel@studio.example', 'rana@studio.example']);
    const basel = rows.getByRole('link', { name: /basel@studio\.example/ });
    expect(within(basel).getByText('Operator', { selector: '.badge' })).toHaveClass('badge-accent');
    expect(basel).toHaveTextContent('Basel Sader · Last signed in 1 hour ago');
    expect(basel).toHaveTextContent('On: Receipt reading');
    const rana = rows.getByRole('link', { name: /rana@studio\.example/ });
    expect(within(rana).getByText('Disabled')).toBeInTheDocument();
    expect(rana).toHaveTextContent('Never signed in');
    expect(basel.querySelector('.hp-operator-email')).toHaveAttribute('dir', 'ltr');
  });

  it('Load more adds the next page under the first, then goes away', async () => {
    const { user, api } = portal();
    await list();
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(emails(within(screen.getByRole('list', { name: 'Accounts' })))).toEqual(['basel@studio.example', 'rana@studio.example', 'sara@studio.example']));
    expect((await list()).getByText('Waiting for review')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
    expect(api.calls.filter((c) => c.url.pathname === '/v1/operator/accounts').map((c) => c.url.searchParams.get('cursor'))).toEqual([null, '2']);
  });

  it('searching "basel" as you type finds every account with it in the email or name, once typing rests', async () => {
    const { user, router, api } = portal();
    await list();
    await user.type(screen.getByLabelText('Search accounts'), 'basel');
    await waitFor(() => expect(locationOf(router)).toBe('/operator/accounts?q=basel'));
    await waitFor(() => expect(emails(within(screen.getByRole('list', { name: 'Accounts' })))).toEqual(['basel@studio.example', 'rana@studio.example']));
    // Debounced: one request for the whole word, not one per letter.
    expect(api.calls.filter((c) => c.url.pathname === '/v1/operator/accounts').map((c) => c.url.searchParams.get('q'))).toEqual([null, 'basel']);
    expect(screen.getByLabelText('Search accounts')).toHaveValue('basel');
  });

  it('says so when nothing matches, and when there are no accounts at all', async () => {
    portal({ path: '/operator/accounts?q=zzz' });
    expect(await screen.findByRole('heading', { name: 'No account matches “zzz”' })).toBeInTheDocument();
    expect(screen.getByText('Try part of the email or the name.')).toBeInTheDocument();
  });

  it('an empty list says there are no accounts yet', async () => {
    portal({ people: [] });
    expect(await screen.findByRole('heading', { name: 'No accounts yet' })).toBeInTheDocument();
  });

  it('shows a loading skeleton while the list loads', async () => {
    portal({ extra: { 'GET /v1/operator/accounts': never } });
    expect(await screen.findByLabelText('Loading')).toHaveAttribute('aria-busy', 'true');
  });

  it('a failed read offers to try again', async () => {
    portal({ extra: { 'GET /v1/operator/accounts': () => fail(500, 'INTERNAL') } });
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('reads in Arabic, right to left, with addresses left to right', async () => {
    localStorage.clear();
    portal({ who: operator('ar') });
    const rows = await list('الحسابات');
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(screen.getByLabelText('ابحث في الحسابات')).toHaveAttribute('dir', 'auto');
    expect(rows.getByRole('link', { name: /basel@studio\.example/ })).toHaveTextContent('مفعّل: قراءة الإيصالات');
    expect(screen.getByRole('button', { name: 'عرض المزيد' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'إعداداتك' })).toBeInTheDocument();
  });
});

describe('Your settings (the You tab)', () => {
  it('says you are an operator and since when, your passkeys with the way to manage them, and that this session is confirmed until when', async () => {
    const { user, router } = portal({ path: '/operator/you' });
    expect(await screen.findByRole('link', { name: 'Your settings' })).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByText('Operator since Oct 20, 2026')).toBeInTheDocument();
    const passkeys = within(screen.getByRole('region', { name: 'Passkeys' }));
    expect(passkeys.getByText('2 passkeys')).toBeInTheDocument();
    expect(passkeys.getByText('Last used 2 hours ago')).toBeInTheDocument();
    const confirmation = within(screen.getByRole('region', { name: 'Confirmation' }));
    expect(confirmation.getByText(/^Confirmed with your passkey until /)).toBeInTheDocument();
    await user.click(passkeys.getByRole('link', { name: /Manage passkeys/ }));
    await waitFor(() => expect(locationOf(router)).toBe('/you/account?passkeys=true'));
  });

  it('says changes will ask for your passkey when the session isn’t confirmed', async () => {
    portal({ path: '/operator/you', stepUpUntil: STALE });
    const confirmation = within(await screen.findByRole('region', { name: 'Confirmation' }));
    expect(confirmation.getByText('Not confirmed')).toBeInTheDocument();
    expect(confirmation.getByText('Changes will ask for your passkey.')).toBeInTheDocument();
  });

  it('your own features switch here, after the passkey step-up; then the session reads as confirmed', async () => {
    const { user, api } = portal({ path: '/operator/you', stepUpUntil: STALE });
    const yours = within(await screen.findByRole('region', { name: 'Your features' }));
    const flag = yours.getByRole('switch', { name: /Receipt reading/ });
    expect(flag).toHaveAttribute('aria-checked', 'false');
    await user.click(flag);
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Your features' })).getByRole('switch', { name: /Receipt reading/ })).toHaveAttribute('aria-checked', 'true'));
    expect(browser.startAuthentication).toHaveBeenCalledTimes(1);
    expect(api.count(`PUT /v1/operator/accounts/${OPERATOR_ID}/features/receipt_reading`)).toBe(1);
    expect(within(screen.getByRole('region', { name: 'Confirmation' })).getByText(/^Confirmed with your passkey until /)).toBeInTheDocument();
  });

  it('turning your own feature off confirms first, in its own words', async () => {
    const { user, api } = portal({ path: '/operator/you', own: mine({ features: ['receipt_reading'] }) });
    await user.click(within(await screen.findByRole('region', { name: 'Your features' })).getByRole('switch', { name: /Receipt reading/ }));
    expect(screen.getByText((_, el) => el?.tagName === 'P' && plain(el.textContent) === "basel@studio.example loses receipt reading; receipts they add from now on aren't read.")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Turn off' }));
    await waitFor(() => expect(api.count(`DELETE /v1/operator/accounts/${OPERATOR_ID}/features/receipt_reading`)).toBe(1));
  });

  it('a flag the portal has no words for shows a humanised name, never its key', async () => {
    portal({ path: '/operator/you' });
    const yours = within(await screen.findByRole('region', { name: 'Your features' }));
    expect(yours.getByRole('switch', { name: 'Bank feeds' })).toBeInTheDocument();
    expect(yours.queryByText('bank_feeds')).toBeNull();
  });

  it('reads in Arabic: receipt reading named and explained', async () => {
    localStorage.clear();
    portal({ who: operator('ar'), path: '/operator/you' });
    const yours = within(await screen.findByRole('region', { name: 'ميزاتك' }));
    expect(yours.getByRole('switch', { name: /قراءة الإيصالات/ })).toHaveTextContent('تُقرأ الإيصالات الجديدة على خوادمنا ويُملأ التاريخ والمجموع والمورّد.');
    expect(screen.getByText(/^مشغّل منذ .*2026/)).toBeInTheDocument();
  });
});

describe('no passkey: one note on every operator page', () => {
  for (const path of ['/operator/signups', '/operator/accounts', '/operator/firms', '/operator/you']) {
    it(`${path} says operator changes need a passkey, with the way to add one`, async () => {
      portal({ path, own: mine({ passkeyCount: 0, passkeyLastUsedAt: null }) });
      const note = await screen.findByText(/Operator changes need a passkey\. Add one in You › Account › Passkeys, then come back\./);
      expect(within(note.closest('.hp-banner') as HTMLElement).getByRole('link', { name: 'Add a passkey' })).toHaveAttribute('href', '/you/account?passkeys=true');
      expect(screen.getAllByText(/Operator changes need a passkey/)).toHaveLength(1);
    });
  }

  it('with a passkey there is no note', async () => {
    portal({ path: '/operator/accounts' });
    await list();
    expect(screen.queryByText(/Operator changes need a passkey/)).toBeNull();
  });
});
