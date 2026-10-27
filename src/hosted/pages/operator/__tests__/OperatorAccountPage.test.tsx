import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import type { EntitlementGrant, Me, OperatorAccount } from '../../../api/client';
import { fail, locationOf, me, never, ok, profile, renderPortal, stubApi, type Handler } from '../../../__tests__/harness';
import { PORTAL_LANGUAGE_KEY } from '../../../i18n/HostedLanguageProvider';
import { operatorAccountKey } from '../../../data/operatorQueries';

/**
 * MUT-461: the operator's Accounts tab and account page (design 17A, 3A, 4A, 5A, 12A). The server is stubbed; the
 * passkey sheet is the browser's, so @simplewebauthn/browser is replaced. Addresses inside sentences are isolated
 * (FSI … PDI), so text is matched with the isolates removed.
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
const SARA = '33333333-aaaa-4aaa-8aaa-333333333333';
const LINK = 'http://localhost/setup#AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

const operator = (locale: 'en' | 'ar' = 'en'): Me => {
  const account = me([profile()], locale);
  return { ...account, user: { ...account.user, operator: true } };
};
const OPERATOR_ID = operator().user.id;

const account = (overrides: Partial<OperatorAccount> = {}): OperatorAccount => ({
  id: SARA,
  email: 'sara@studio.example',
  displayName: 'Sara Khalil',
  locale: 'en',
  status: 'ACTIVE',
  passwordChangedAt: '2026-10-01T09:00:00.000Z',
  lastSignInAt: '2026-10-27T09:00:00.000Z',
  createdAt: '2026-10-01T09:00:00.000Z',
  closing: false,
  operator: false,
  passkeyCount: 1,
  features: [],
  activeSessionCount: 2,
  agentGrantCount: 1,
  availableFeatures: ['agent_access'],
  profiles: [
    {
      id: '44444444-aaaa-4aaa-8aaa-444444444444',
      name: 'Sara’s books',
      role: 'OWNER',
      personal: true,
      owned: true,
      firmEnabledAt: null,
      firmRequestedAt: null,
      billing: { state: 'ACTIVE', source: 'TRIAL', tier: 'FREELANCER', until: '2026-11-10T09:00:00.000Z' },
    },
  ],
  ...overrides,
});

const NEW_GRANT = '55555555-aaaa-4aaa-8aaa-555555555555';
const grantOf = (overrides: Partial<EntitlementGrant> = {}): EntitlementGrant => ({
  id: '66666666-aaaa-4aaa-8aaa-666666666666',
  userId: SARA,
  organizationId: null,
  tier: 'FREELANCER',
  reason: 'Pilot comp',
  expiresAt: '2026-11-26T21:59:59.999Z',
  grantedBy: 'admin',
  createdAt: '2026-10-20T09:00:00.000Z',
  revokedAt: null,
  ...overrides,
});

const plain = (text: string | null | undefined) => (text ?? '').replace(/[⁨⁩]/g, '');
const sentence = (expected: string) => (_: string, element: Element | null) => element?.tagName === 'P' && plain(element.textContent) === expected;
/** The info toast's live region says it (the toast text is one string with the address isolated). */
const toasted = async (expected: string) => waitFor(() => expect(plain(screen.getByTestId('toast-live').textContent)).toContain(expected));

function portal({
  me: who = operator(),
  view = account(),
  stepUpUntil = FRESH as string | null,
  grants = [] as EntitlementGrant[],
  extra = {} as Record<string, Handler>,
  path = `/operator/accounts/${SARA}`,
} = {}) {
  let current = view;
  let currentGrants = grants;
  const api = stubApi({
    'GET /v1/me': () => ok(who),
    'GET /v1/operator/signup-reviews': () => ok({ data: [], nextCursor: null, stepUpUntil }),
    'GET /v1/operator/accounts': (request) =>
      ok({ account: request.url.searchParams.get('email') === current.email ? { id: current.id, email: current.email, displayName: current.displayName, status: current.status } : null, stepUpUntil }),
    [`GET /v1/operator/accounts/${current.id}`]: () => ok({ account: current, stepUpUntil }),
    [`POST /v1/operator/accounts/${current.id}/disable`]: () => {
      current = { ...current, status: 'DISABLED', activeSessionCount: 0, agentGrantCount: 0 };
      return ok({ user: { ...current }, sessionsRevoked: 2, agentGrantsRevoked: 1 });
    },
    [`POST /v1/operator/accounts/${current.id}/enable`]: () => {
      current = { ...current, status: 'ACTIVE' };
      return ok({ user: { ...current }, sessionsRevoked: 0, agentGrantsRevoked: 0 });
    },
    [`POST /v1/operator/accounts/${current.id}/sessions/revoke`]: () => {
      current = { ...current, activeSessionCount: 0, agentGrantCount: 0 };
      return ok({ revoked: 2, agentGrantsRevoked: 1 });
    },
    [`POST /v1/operator/accounts/${current.id}/setup-link`]: (request) =>
      ok({ user: { ...current }, lock: (request.body as { lock: boolean }).lock, setupLink: { url: LINK, expiresAt: '2026-10-28T12:00:00.000Z', purpose: 'RESET' } }),
    // MUT-462: the account's grants and flags.
    [`GET /v1/operator/accounts/${current.id}/billing-grants`]: () => ok({ grants: currentGrants, stepUpUntil }),
    [`POST /v1/operator/accounts/${current.id}/billing-grants`]: (request) => {
      const body = request.body as { tier: EntitlementGrant['tier']; reason: string; expiresAt?: string };
      const created = grantOf({ id: NEW_GRANT, tier: body.tier, reason: body.reason, expiresAt: body.expiresAt ?? null, grantedBy: `operator:${OPERATOR_ID}` });
      currentGrants = [created, ...currentGrants];
      return ok(created, 201);
    },
    ...Object.fromEntries(
      grants.map((g) => [
        `DELETE /v1/operator/accounts/${current.id}/billing-grants/${g.id}`,
        () => {
          currentGrants = currentGrants.map((x) => (x.id === g.id ? { ...x, revokedAt: NOW.toISOString() } : x));
          return ok({ grant: currentGrants.find((x) => x.id === g.id), revoked: true });
        },
      ]),
    ),
    [`PUT /v1/operator/accounts/${current.id}/features/agent_access`]: () => {
      current = { ...current, features: ['agent_access'] };
      return ok({ feature: 'agent_access', grantedAt: NOW.toISOString(), granted: true });
    },
    [`DELETE /v1/operator/accounts/${current.id}/features/agent_access`]: () => {
      current = { ...current, features: [] };
      return ok({ feature: 'agent_access', revoked: true });
    },
    'POST /v1/operator/step-up/options': () => ok(CHALLENGE),
    'POST /v1/operator/step-up': () => ok({ stepUpUntil: FRESH }),
    ...extra,
  });
  return { ...renderPortal(path), api };
}

const access = async () => within(await screen.findByRole('region', { name: 'Access' }));

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

describe('the Accounts tab (design 17A, 3A)', () => {
  it('finds an account by its email, keeps the address in the URL, and opens it', async () => {
    const { user, router } = portal({ path: '/operator/accounts' });
    expect(await screen.findByRole('link', { name: 'Accounts' })).toHaveAttribute('aria-current', 'page');
    const field = screen.getByLabelText('Email address');
    expect(field).toHaveAttribute('dir', 'ltr');
    expect(field).toHaveAttribute('type', 'email');
    await user.type(field, 'sara@studio.example{Enter}');
    await waitFor(() => expect(locationOf(router)).toBe('/operator/accounts?email=sara%40studio.example'));
    const found = await screen.findByRole('list', { name: 'Account found' });
    expect(within(found).getByText('Active')).toHaveClass('badge-success');
    await user.click(within(found).getByRole('link', { name: /sara@studio\.example/ }));
    await waitFor(() => expect(locationOf(router)).toBe(`/operator/accounts/${SARA}`));
    expect(await screen.findByRole('heading', { level: 2, name: 'sara@studio.example' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Accounts' })).toHaveAttribute('aria-current', 'page');
  });

  it('says so when no account has the address, showing the address as typed', async () => {
    portal({ path: '/operator/accounts?email=nobody%40studio.example' });
    expect(await screen.findByRole('heading', { name: 'No account with this address' })).toBeInTheDocument();
    expect(screen.getByText('nobody@studio.example')).toHaveAttribute('dir', 'ltr');
  });

  it('a non-operator gets the not-found answer (Home), and the server is never asked', async () => {
    const { router, api } = portal({ me: me([profile()]), path: '/operator/accounts?email=sara%40studio.example' });
    await waitFor(() => expect(locationOf(router)).toMatch(/^\/p\/[0-9a-f-]{36}/));
    expect(api.count('GET /v1/operator/accounts')).toBe(0);
  });
});

describe('the account page (design 5A, 4A)', () => {
  it('shows who, how they stand, the Access rows with what each ends, and each profile with its billing', async () => {
    portal();
    expect(await screen.findByRole('heading', { level: 2, name: 'sara@studio.example' })).toHaveAttribute('dir', 'ltr');
    expect(screen.getByText('Active')).toHaveClass('badge-success');
    expect(screen.getByText(/Last signed in 3 hours ago · Has a passkey/)).toBeInTheDocument();
    const rows = await access();
    expect(rows.getByRole('button', { name: /Sign out everywhere/ })).toHaveTextContent('2 devices · the password still works');
    expect(rows.getByRole('button', { name: /Disable account/ })).toHaveTextContent('Signs out 2 devices, disconnects 1 connected app, blocks sign-in');
    expect(rows.getByRole('button', { name: /Send reset link/ })).toBeInTheDocument();
    expect(rows.queryByRole('button', { name: /Enable account/ })).toBeNull();
    const profiles = within(screen.getByRole('region', { name: 'Profiles' }));
    expect(profiles.getByText('Sara’s books')).toBeInTheDocument();
    expect(profiles.getByText(/Owner · Trial · Active until Nov 10, 2026/)).toBeInTheDocument();
    expect(profiles.getByText('Personal')).toBeInTheDocument();
  });

  it('a disabled account says so and offers only Enable', async () => {
    portal({ view: account({ status: 'DISABLED' }) });
    expect(await screen.findByText(/This account is disabled/)).toBeInTheDocument();
    const rows = await access();
    expect(rows.getAllByRole('button').map((b) => b.querySelector('.hp-you-row-label')?.textContent)).toEqual(['Enable account']);
  });

  it('a signup waiting for review points to Signups and offers no status change', async () => {
    portal({ view: account({ status: 'PENDING_REVIEW', lastSignInAt: null, passkeyCount: 0 }) });
    expect(await screen.findByRole('link', { name: 'Review it in Signups' })).toHaveAttribute('href', '/operator/signups');
    expect(screen.getByText(/Never signed in · No passkey/)).toBeInTheDocument();
    expect((await access()).queryByRole('button', { name: /Disable account/ })).toBeNull();
  });

  it('a missing account shows its own not-found answer (ACCOUNT_NOT_FOUND), not "unreachable"', async () => {
    portal({ extra: { [`GET /v1/operator/accounts/${SARA}`]: () => fail(404, 'NOT_FOUND', { reason: 'ACCOUNT_NOT_FOUND' }) } });
    expect(await screen.findByRole('heading', { name: 'No such account' })).toBeInTheDocument();
  });

  it('shows a loading skeleton while the account loads', async () => {
    portal({ extra: { [`GET /v1/operator/accounts/${SARA}`]: never } });
    expect(await screen.findByLabelText('Loading')).toHaveAttribute('aria-busy', 'true');
  });

  it('the operator’s own account shows the Access rows inert, with the reason (E10)', async () => {
    const { user, api } = portal({ view: account({ id: OPERATOR_ID, operator: true }), path: `/operator/accounts/${OPERATOR_ID}` });
    const rows = await access();
    const disable = rows.getByRole('button', { name: /Disable account/ });
    expect(disable).toHaveAttribute('aria-disabled', 'true');
    expect(disable).toHaveTextContent('This is your account: change it from You › Account.');
    await user.click(disable);
    expect(screen.queryByRole('group')).toBeNull();
    expect(api.count(`POST /v1/operator/accounts/${OPERATOR_ID}/disable`)).toBe(0);
    expect(screen.getByText('Operator', { selector: '.badge' })).toHaveClass('badge-accent');
  });

  it('reads Arabic by default, right to left, with the address left to right', async () => {
    localStorage.clear();
    portal({ me: operator('ar') });
    expect(await screen.findByRole('heading', { level: 1, name: 'المشغّل' })).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('link', { name: 'الحسابات' })).toHaveAttribute('aria-current', 'page');
    const rows = within(await screen.findByRole('region', { name: 'الدخول' }));
    expect(rows.getByRole('button', { name: /تعطيل الحساب/ })).toHaveTextContent('جهازان');
    expect(screen.getByRole('heading', { level: 2, name: 'sara@studio.example' })).toHaveAttribute('dir', 'ltr');
  });
});

describe('acting on the account (AC1, design 4A, 11A)', () => {
  it('Disable confirms in its row with what it ends; Cancel and Escape put the row back, focused', async () => {
    const { user, api } = portal();
    await user.click((await access()).getByRole('button', { name: /Disable account/ }));
    expect(screen.getByText(sentence("sara@studio.example will be signed out on 2 devices, 1 connected app disconnected, and they can't sign in until you enable the account."))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Disable' })).toHaveClass('btn-danger');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.getByRole('button', { name: /Disable account/ })).toHaveFocus());
    expect(api.count(`POST /v1/operator/accounts/${SARA}/disable`)).toBe(0);
  });

  it('a fresh step-up disables at once: the toast says how many devices, the page shows Disabled and Enable', async () => {
    const { user, api } = portal();
    await user.click((await access()).getByRole('button', { name: /Disable account/ }));
    await user.click(screen.getByRole('button', { name: 'Disable' }));
    await toasted('sara@studio.example disabled · signed out on 2 devices');
    expect(await screen.findByText(/This account is disabled/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /Enable account/ })).toHaveFocus());
    expect(api.count('POST /v1/operator/step-up/options')).toBe(0);
  });

  it('a stale step-up says "with passkey" and runs the passkey sheet on the same tap, then acts', async () => {
    const { user, api } = portal({ stepUpUntil: STALE });
    await user.click((await access()).getByRole('button', { name: /Sign out everywhere/ }));
    await user.click(screen.getByRole('button', { name: 'Sign out with passkey' }));
    await toasted('sara@studio.example signed out on 2 devices');
    expect(browser.startAuthentication).toHaveBeenCalledTimes(1);
    expect(api.count(`POST /v1/operator/accounts/${SARA}/sessions/revoke`)).toBe(1);
  });

  it('Enable on a disabled account confirms as a plain action and opens it again', async () => {
    const { user } = portal({ view: account({ status: 'DISABLED', activeSessionCount: 0, agentGrantCount: 0 }) });
    await user.click((await access()).getByRole('button', { name: /Enable account/ }));
    expect(screen.getByText(sentence('sara@studio.example can sign in again.'))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Enable' }));
    await toasted('sara@studio.example enabled');
    expect(await screen.findByRole('button', { name: /Disable account/ })).toBeInTheDocument();
  });

  it('a refusal the server explains shows in the row, and nothing changes', async () => {
    const { user } = portal({ extra: { [`POST /v1/operator/accounts/${SARA}/disable`]: () => fail(409, 'CONFLICT', { reason: 'USER_PENDING_REVIEW' }) } });
    await user.click((await access()).getByRole('button', { name: /Disable account/ }));
    await user.click(screen.getByRole('button', { name: 'Disable' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This signup is waiting for review: approve or decline it in Signups.');
    expect(screen.getByRole('button', { name: 'Disable' })).toBeEnabled();
  });
});

describe('the reset link (AC2, design 12A)', () => {
  it('locks the password by default, shows the link once with a copy field, and never anywhere else', async () => {
    const { user, api, queryClient } = portal();
    await user.click((await access()).getByRole('button', { name: /Send reset link/ }));
    expect(screen.getByText(sentence('Make a one-time reset link for sara@studio.example. Any earlier link stops working.'))).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Lock the current password' })).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('button', { name: 'Make link' }));

    const field = await screen.findByLabelText('Reset link for sara@studio.example');
    expect(field).toHaveValue(LINK);
    expect(screen.getByText('Shown once. Leaving this page discards it.')).toBeInTheDocument();
    expect(screen.getByText('Their password no longer works, and they were signed out everywhere.')).toBeInTheDocument();
    expect(api.calls.find((c) => c.url.pathname.endsWith('/setup-link'))?.body).toEqual({ lock: true, validHours: 24 });
    // Not in the query cache, the URL, or a toast.
    expect(JSON.stringify(queryClient.getQueryData(operatorAccountKey(SARA)))).not.toContain(LINK);
    expect(window.location.href).not.toContain('setup#');
    expect(screen.queryAllByText(/setup#/).filter((el) => el.tagName !== 'INPUT')).toEqual([]);
  });

  it('without the lock the password keeps working; Done puts the row back', async () => {
    const { user, api } = portal();
    await user.click((await access()).getByRole('button', { name: /Send reset link/ }));
    await user.click(screen.getByRole('switch', { name: 'Lock the current password' }));
    await user.click(screen.getByRole('button', { name: 'Make link' }));
    expect(await screen.findByLabelText('Reset link for sara@studio.example')).toHaveValue(LINK);
    expect(screen.queryByText(/Their password no longer works/)).toBeNull();
    expect(api.calls.find((c) => c.url.pathname.endsWith('/setup-link'))?.body).toEqual({ lock: false, validHours: 24 });
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByLabelText('Reset link for sara@studio.example')).toBeNull();
    expect(screen.getByRole('button', { name: /Send reset link/ })).toBeInTheDocument();
  });

  it('is gone after leaving the page and coming back', async () => {
    const { user } = portal();
    await user.click((await access()).getByRole('button', { name: /Send reset link/ }));
    await user.click(screen.getByRole('button', { name: 'Make link' }));
    expect(await screen.findByLabelText('Reset link for sara@studio.example')).toHaveValue(LINK);
    await user.click(screen.getByRole('link', { name: 'Signups' }));
    await user.click(await screen.findByRole('link', { name: 'Accounts' }));
    await user.type(await screen.findByLabelText('Email address'), 'sara@studio.example{Enter}');
    await user.click(await screen.findByRole('link', { name: /sara@studio\.example/ }));
    expect(await (await access()).findByRole('button', { name: /Send reset link/ })).toBeInTheDocument();
    expect(screen.queryByLabelText('Reset link for sara@studio.example')).toBeNull();
  });
});

const billing = async () => within(await screen.findByRole('region', { name: 'Billing' }));
/** A grant row's label: the reason sits in its own <bdi>, so the label is matched whole. */
const grantLabel = (text: string) => (_: string, element: Element | null) => Boolean(element?.classList.contains('hp-you-row-label')) && element?.textContent === text;
const features = async () => within(await screen.findByRole('region', { name: 'Features' }));

describe('billing grants (MUT-462, design 14A)', () => {
  it('lists the grants after Access, each with where it stands; only an active one offers Revoke', async () => {
    portal({
      grants: [
        grantOf(),
        grantOf({ id: '77777777-aaaa-4aaa-8aaa-777777777777', reason: 'Old comp', revokedAt: '2026-10-21T09:00:00.000Z' }),
        grantOf({ id: '88888888-aaaa-4aaa-8aaa-888888888888', tier: 'FIRM', reason: 'Trial firm', expiresAt: '2026-10-25T00:00:00.000Z' }),
      ],
    });
    const rows = await billing();
    expect(await rows.findByText(grantLabel('Freelancer · Pilot comp'))).toBeInTheDocument();
    expect(rows.getByText('Until Nov 26, 2026')).toBeInTheDocument();
    expect(rows.getByText('Revoked Oct 21, 2026')).toBeInTheDocument();
    expect(rows.getByText('Ended Oct 25, 2026')).toBeInTheDocument();
    expect(rows.getAllByRole('button', { name: 'Revoke' })).toHaveLength(1);
    const regions = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'));
    expect(regions.indexOf('Access')).toBeLessThan(regions.indexOf('Billing'));
    expect(regions.indexOf('Billing')).toBeLessThan(regions.indexOf('Features'));
    expect(regions.indexOf('Features')).toBeLessThan(regions.indexOf('Profiles'));
  });

  it('Grant coverage opens the drawer in the address; a grant with a reason and 90 days is sent, toasted, and listed', async () => {
    const { user, api, router } = portal();
    await user.click((await billing()).getByRole('button', { name: /Grant coverage/ }));
    await waitFor(() => expect(locationOf(router)).toBe(`/operator/accounts/${SARA}?grant=new`));
    const drawer = within(await screen.findByRole('dialog', { name: 'Grant coverage' }));
    expect(drawer.getByRole('radio', { name: /Freelancer/ })).toBeChecked();
    await user.click(drawer.getByRole('radio', { name: /Firm/ }));
    await user.type(drawer.getByLabelText('Reason'), 'Pilot comp');
    await user.click(drawer.getByRole('button', { name: '90 days' }));
    await user.click(drawer.getByRole('button', { name: 'Grant' }));
    await toasted('Coverage granted to sara@studio.example');
    const sent = api.calls.find((c) => c.method === 'POST' && c.url.pathname.endsWith('/billing-grants'))!.body as { tier: string; reason: string; expiresAt: string };
    expect(sent).toMatchObject({ tier: 'FIRM', reason: 'Pilot comp' });
    expect(new Date(sent.expiresAt).getDate()).toBe(new Date(NOW.getTime() + 90 * 86_400_000).getDate());
    await waitFor(() => expect(locationOf(router)).toBe(`/operator/accounts/${SARA}`));
    expect(await (await billing()).findByText(grantLabel('Firm · Pilot comp'))).toBeInTheDocument();
    expect(api.count('POST /v1/operator/step-up/options')).toBe(0);
  });

  it('asks for a reason and a day after today before sending anything; No end date sends no expiry', async () => {
    const { user, api } = portal({ path: `/operator/accounts/${SARA}?grant=new` });
    const drawer = within(await screen.findByRole('dialog', { name: 'Grant coverage' }));
    await user.click(drawer.getByRole('button', { name: 'Grant' }));
    expect(drawer.getByText("Say why you're granting it.")).toBeInTheDocument();
    await user.type(drawer.getByLabelText('Reason'), 'Pilot comp');
    await user.clear(drawer.getByLabelText('Ends'));
    await user.type(drawer.getByLabelText('Ends'), '2026-10-01');
    await user.click(drawer.getByRole('button', { name: 'Grant' }));
    expect(drawer.getByText('Choose a day after today, or No end date.')).toBeInTheDocument();
    expect(api.count(`POST /v1/operator/accounts/${SARA}/billing-grants`)).toBe(0);
    await user.click(drawer.getByRole('button', { name: 'No end date' }));
    expect(drawer.getByText('It lasts until you revoke it.')).toBeInTheDocument();
    await user.click(drawer.getByRole('button', { name: 'Grant' }));
    await toasted('Coverage granted to sara@studio.example');
    expect(api.calls.find((c) => c.method === 'POST' && c.url.pathname.endsWith('/billing-grants'))!.body).toEqual({ tier: 'FREELANCER', reason: 'Pilot comp' });
  });

  it('a stale step-up says "Grant with passkey" and runs the passkey sheet on the same tap', async () => {
    const { user, api } = portal({ stepUpUntil: STALE, path: `/operator/accounts/${SARA}?grant=new` });
    const drawer = within(await screen.findByRole('dialog', { name: 'Grant coverage' }));
    await user.type(drawer.getByLabelText('Reason'), 'Pilot comp');
    await user.click(drawer.getByRole('button', { name: 'Grant with passkey' }));
    await toasted('Coverage granted to sara@studio.example');
    expect(browser.startAuthentication).toHaveBeenCalledTimes(1);
    expect(api.count(`POST /v1/operator/accounts/${SARA}/billing-grants`)).toBe(1);
  });

  it('Revoke confirms in the row with what the person loses; Cancel puts it back; confirming revokes', async () => {
    const { user, api } = portal({ grants: [grantOf()] });
    const rows = await billing();
    await user.click(await rows.findByRole('button', { name: 'Revoke' }));
    expect(screen.getByText(sentence('sara@studio.example loses this Freelancer coverage. Their profiles go back to their own plan or trial.'))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(rows.getByRole('button', { name: 'Revoke' }));
    await user.click(within(screen.getByRole('group')).getByRole('button', { name: 'Revoke' }));
    await toasted('Coverage revoked for sara@studio.example');
    expect(api.count(`DELETE /v1/operator/accounts/${SARA}/billing-grants/${grantOf().id}`)).toBe(1);
    expect(await rows.findByText('Revoked Oct 27, 2026')).toBeInTheDocument();
  });

  it('on the operator’s own account the grant row is inert with the reason and no drawer opens (E10)', async () => {
    const { user, router } = portal({ view: account({ id: OPERATOR_ID, operator: true }), path: `/operator/accounts/${OPERATOR_ID}` });
    const grant = (await billing()).getByRole('button', { name: /Grant coverage/ });
    expect(grant).toHaveAttribute('aria-disabled', 'true');
    expect(grant).toHaveTextContent('This is your account');
    await user.click(grant);
    expect(locationOf(router)).toBe(`/operator/accounts/${OPERATOR_ID}`);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('feature flags (MUT-462, design 15A)', () => {
  it('one switch per flag the server has; turning one on acts at once', async () => {
    const { user, api } = portal();
    const flag = (await features()).getByRole('switch', { name: /Connect Claude/ });
    expect(flag).toHaveAttribute('aria-checked', 'false');
    expect(flag).toHaveTextContent('They can connect their own Claude to log receipts and statements');
    await user.click(flag);
    await waitFor(() => expect((within(screen.getByRole('region', { name: 'Features' })).getByRole('switch', { name: /Connect Claude/ }))).toHaveAttribute('aria-checked', 'true'));
    expect(api.count(`PUT /v1/operator/accounts/${SARA}/features/agent_access`)).toBe(1);
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('turning one off confirms in the row first, saying what goes with it', async () => {
    const { user, api } = portal({ view: account({ features: ['agent_access'] }) });
    await user.click((await features()).getByRole('switch', { name: /Connect Claude/ }));
    expect(screen.getByText(sentence('sara@studio.example loses Claude access, and any Claude they connected is disconnected now.'))).toBeInTheDocument();
    expect(api.count(`DELETE /v1/operator/accounts/${SARA}/features/agent_access`)).toBe(0);
    await user.click(screen.getByRole('button', { name: 'Turn off' }));
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Features' })).getByRole('switch', { name: /Connect Claude/ })).toHaveAttribute('aria-checked', 'false'));
    expect(api.count(`DELETE /v1/operator/accounts/${SARA}/features/agent_access`)).toBe(1);
  });

  it('a refusal the server explains shows under the switch, which stays off', async () => {
    const { user } = portal({
      view: account({ status: 'PENDING_REVIEW' }),
      extra: { [`PUT /v1/operator/accounts/${SARA}/features/agent_access`]: () => fail(409, 'CONFLICT', { reason: 'USER_PENDING_REVIEW' }) },
    });
    await user.click((await features()).getByRole('switch', { name: /Connect Claude/ }));
    expect(await screen.findByText('This signup is waiting for review. Approve it first.')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Features' })).getByRole('switch', { name: /Connect Claude/ })).toHaveAttribute('aria-checked', 'false');
  });

  it('reads in Arabic: الدفع and الميزات, with the flag named ربط Claude', async () => {
    localStorage.clear();
    portal({ me: operator('ar') });
    expect(await screen.findByRole('region', { name: 'الدفع' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'الميزات' })).getByRole('switch', { name: /ربط Claude/ })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'الدفع' })).getByRole('button', { name: /منح تغطية/ })).toBeInTheDocument();
  });
});
