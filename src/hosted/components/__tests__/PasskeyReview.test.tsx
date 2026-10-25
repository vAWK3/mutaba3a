import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';
import { ORG_A, emptyProfileRoutes, fail, locationOf, me, ok, profile, renderPortal, stubApi, type Handler, type StubRequest } from '../../__tests__/harness';

/**
 * MUT-415: passkeys survive a password change and a recovery (MUT-115), so both go on to the passkey review when the
 * account has any: the Passkeys drawer with `review`, its list and in-row Remove unchanged, Done in Add's place.
 */
vi.mock('@simplewebauthn/browser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@simplewebauthn/browser')>()),
  browserSupportsWebAuthn: () => true,
  browserSupportsWebAuthnAutofill: async () => false,
}));

const CHROME = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Chrome on Mac', createdAt: '2026-10-03T09:00:00.000Z', lastUsedAt: '2026-10-20T09:00:00.000Z', deviceType: 'singleDevice', backedUp: false };
const NO_CONTENT = () => new Response(null, { status: 204 });
const calls = (all: StubRequest[], method: string, path: string) => all.filter((c) => c.method === method && c.url.pathname === path);

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('__PASSKEY_RP_ID__', 'localhost');
});
afterEach(() => vi.unstubAllGlobals());

function portal(path: string, items: unknown[], routes: Record<string, Handler> = {}) {
  let list = [...items];
  const api = stubApi({
    'GET /v1/me': () => ok(me([profile()])),
    ...emptyProfileRoutes(),
    'POST /v1/me/password': NO_CONTENT,
    'GET /v1/passkeys': () => ok({ items: list, limit: 10 }),
    [`DELETE /v1/passkeys/${CHROME.id}`]: () => {
      list = [];
      return NO_CONTENT();
    },
    ...routes,
  });
  return { ...renderPortal(path), api };
}

async function changePassword(user: ReturnType<typeof renderPortal>['user']) {
  const dialog = await screen.findByRole('dialog', { name: 'Change password' });
  await user.type(within(dialog).getByLabelText('Current password'), 'the old one');
  await user.type(within(dialog).getByLabelText('New password'), 'a brand new long password');
  await user.click(within(dialog).getByRole('button', { name: 'Save' }));
}

describe('passkey review after a password change (MUT-415)', () => {
  it('a person with passkeys sees them listed, removes one in place, and Done closes', async () => {
    const { user, router, api } = portal(`/p/${ORG_A}?changePassword=true`, [CHROME]);
    await changePassword(user);
    const dialog = await screen.findByRole('dialog', { name: 'Passkeys' });
    expect(screen.getByText('Password changed')).toBeInTheDocument();
    expect(locationOf(router)).toBe(`/p/${ORG_A}?passkeys=true&review=password`);
    expect(within(dialog).getByText('Your password is changed. These passkeys still sign in to your account. Remove any you don’t recognise.')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Add a passkey' })).toBeNull();

    await user.click(within(dialog).getByRole('button', { name: 'Remove Chrome on Mac' }));
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('Passkey removed. Devices signed in with it are signed out.')).toBeInTheDocument();
    expect(calls(api.calls, 'DELETE', `/v1/passkeys/${CHROME.id}`)).toHaveLength(1);

    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(locationOf(router)).toBe(`/p/${ORG_A}`);
  });

  it('a person with no passkeys sees no extra step', async () => {
    const { user, router } = portal(`/p/${ORG_A}?changePassword=true`, []);
    await changePassword(user);
    await screen.findByText('Password changed');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(locationOf(router)).toBe(`/p/${ORG_A}`);
  });

  it('a list that cannot be read is no extra step either', async () => {
    const { user, router } = portal(`/p/${ORG_A}?changePassword=true`, [CHROME], { 'GET /v1/passkeys': () => fail(500, 'INTERNAL') });
    await changePassword(user);
    await screen.findByText('Password changed');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(locationOf(router)).toBe(`/p/${ORG_A}`);
  });

  it('on a host without passkeys, asks nothing and closes', async () => {
    vi.stubGlobal('__PASSKEY_RP_ID__', 'placeholder.example');
    const { user, api } = portal(`/p/${ORG_A}?changePassword=true`, [CHROME]);
    await changePassword(user);
    await screen.findByText('Password changed');
    expect(calls(api.calls, 'GET', '/v1/passkeys')).toHaveLength(0);
  });

  it('says it in Arabic', async () => {
    localStorage.setItem(PORTAL_LANGUAGE_KEY, 'ar');
    portal(`/p/${ORG_A}?passkeys=true&review=password`, [CHROME]);
    const dialog = await screen.findByRole('dialog', { name: 'مفاتيح المرور' });
    expect(within(dialog).getByText('تم تغيير كلمة المرور. ما زالت مفاتيح المرور هذه تسجّل الدخول إلى حسابك. احذف أي مفتاح لا تعرفه.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'تم' })).toBeInTheDocument();
  });
});

describe('passkey review after a recovery (MUT-415)', () => {
  const TOKEN = 'k'.repeat(43);
  const recovery = (items: unknown[], purpose: 'RESET' | 'SIGNUP' = 'RESET') =>
    portal(`/setup#${TOKEN}`, items, {
      'GET /v1/me': () => fail(401, 'UNAUTHENTICATED'),
      'POST /v1/account-setup/check': () => ok({ state: 'valid', email: 'nour@firm.ps', locale: 'en', purpose, expiresAt: '2026-10-19T09:00:00.000Z', termsVersion: '2026-10-19' }),
      'POST /v1/account-setup': () => ok({ email: 'nour@firm.ps', status: 'ACTIVE' }),
      'POST /v1/sessions': () => ok(me()),
    });

  async function setPassword(user: ReturnType<typeof renderPortal>['user']) {
    await user.type(await screen.findByLabelText('New password'), 'a long enough passphrase');
    await user.click(screen.getByRole('checkbox', { name: /terms of service/ }));
    await user.click(screen.getByRole('button', { name: 'Save and sign in' }));
  }

  it('a reset lands on the review when the account has passkeys', async () => {
    const { user, router } = recovery([CHROME]);
    await setPassword(user);
    const dialog = await screen.findByRole('dialog', { name: 'Passkeys' });
    expect(within(dialog).getByText('Your new password is set. These passkeys still sign in to your account. Remove any you don’t recognise.')).toBeInTheDocument();
    expect(within(dialog).getByText('Chrome on Mac')).toBeInTheDocument();
    expect(locationOf(router)).toBe(`/p/${ORG_A}?passkeys=true&review=recovery`);
  });

  it('…and on Home with nothing more when it has none', async () => {
    const { user, router } = recovery([]);
    await setPassword(user);
    await waitFor(() => expect(locationOf(router)).toBe(`/p/${ORG_A}`));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
