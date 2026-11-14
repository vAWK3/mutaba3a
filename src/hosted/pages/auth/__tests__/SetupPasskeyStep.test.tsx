import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { ORG_A, ORG_B, emptyProfileRoutes, fail, locationOf, me, ok, profile, renderPortal, stubApi, type Handler } from '../../../__tests__/harness';
import type { Me, PasskeyPrompt } from '../../../api/client';
import { PORTAL_LANGUAGE_KEY } from '../../../i18n/HostedLanguageProvider';

/**
 * MUT-619: right after a setup link sets the password and signs in, `/setup` offers a passkey before Home. Through the
 * real portal (router, query client, toasts) with /v1 stubbed; the platform sheet is @simplewebauthn/browser's, so it
 * is replaced. The live ceremony is release-QA's (portal-selfservice.setup.passkey-*).
 */
const browser = vi.hoisted(() => ({ startRegistration: vi.fn(), supported: { value: true } }));
vi.mock('@simplewebauthn/browser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@simplewebauthn/browser')>()),
  startRegistration: browser.startRegistration,
  browserSupportsWebAuthn: () => browser.supported.value,
  browserSupportsWebAuthnAutofill: async () => false,
}));
const { trackPortal } = vi.hoisted(() => ({ trackPortal: vi.fn(async () => {}) }));
vi.mock('../../../analytics/portalAnalytics', async (original) => ({ ...(await original<typeof import('../../../analytics/portalAnalytics')>()), trackPortal }));

const TOKEN = 'k'.repeat(43);
const EMAIL = 'nour@firm.ps';
const PASSWORD = 'a long enough passphrase';
const DAY = 24 * 60 * 60 * 1000;
const DUE: PasskeyPrompt = { due: true, notNowCount: 0, hiddenUntil: null };
const PASSKEY = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'iCloud Keychain', createdAt: '2026-11-14T09:00:00.000Z', lastUsedAt: null, deviceType: 'multiDevice', backedUp: true };
const OPTIONS = { challengeId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', publicKey: { challenge: 'abc', rp: { id: 'localhost', name: 'MTB3A' }, user: { id: 'dQ', name: EMAIL, displayName: 'Nour' }, pubKeyCredParams: [{ type: 'public-key', alg: -7 }] } };
const REGISTRATION = { id: 'cred', rawId: 'cred', type: 'public-key', response: { clientDataJSON: 'e30', attestationObject: 'e30' }, clientExtensionResults: {} };
const STEP = 'Create a passkey';
const PERSONAL = profile({ id: ORG_B, name: 'Personal', isPersonalDefault: true, owned: true, type: 'PERSONAL' });

type Purpose = 'SETUP' | 'RESET' | 'SIGNUP';
interface Options {
  purpose?: Purpose;
  prompt?: PasskeyPrompt | null;
  passkeys?: unknown[];
  locale?: 'en' | 'ar';
  routes?: Record<string, Handler>;
}

/** A /v1 where the redeem and the sign-in work, and /v1/me answers the signed-in person once they are. */
function setup({ purpose = 'SETUP', prompt = DUE, passkeys: initial = [], locale = 'en', routes = {} }: Options = {}) {
  let signedIn = false;
  let current: PasskeyPrompt | null = prompt;
  let passkeys = [...initial];
  const meNow = (): Me => {
    const base = me(purpose === 'SIGNUP' ? [profile(), PERSONAL] : [profile()], locale);
    return { ...base, user: { ...base.user, passkeyPrompt: current && (passkeys.length ? { ...current, due: false } : current) } };
  };
  const api = stubApi({
    ...emptyProfileRoutes(),
    'GET /v1/me': () => (signedIn ? ok(meNow()) : fail(401, 'UNAUTHENTICATED')),
    'POST /v1/account-setup/check': () =>
      ok({ state: 'valid', email: EMAIL, locale, purpose, expiresAt: '2026-11-15T09:00:00.000Z', termsVersion: '2026-10-19' }),
    'POST /v1/account-setup': () => ok({ email: EMAIL, status: 'ACTIVE' }),
    'POST /v1/sessions': () => {
      signedIn = true;
      return ok(meNow());
    },
    'GET /v1/passkeys': () => ok({ items: passkeys, limit: 10 }),
    'POST /v1/passkeys/creation-options': () => ok(OPTIONS),
    'POST /v1/passkeys': () => {
      passkeys = [PASSKEY];
      return ok(PASSKEY, 201);
    },
    'PATCH /v1/me/passkey-prompt': () => {
      current = { due: false, notNowCount: (current?.notNowCount ?? 0) + 1, hiddenUntil: new Date(Date.now() + 30 * DAY).toISOString() };
      return ok(current);
    },
    ...routes,
  });
  return api;
}

async function setPassword(options: Options = {}) {
  const api = setup(options);
  const view = renderPortal(`/setup#${TOKEN}`);
  const password = await screen.findByLabelText(options.locale === 'ar' ? 'كلمة المرور الجديدة' : 'New password');
  await view.user.type(password, PASSWORD);
  await view.user.click(screen.getByRole('checkbox', { name: /terms of service|شروط الخدمة/ }));
  await view.user.click(screen.getByRole('button', { name: options.purpose === 'SIGNUP' ? 'Create account' : /Save and sign in|احفظ وسجّل الدخول/ }));
  return { ...view, api };
}

const calls = (api: ReturnType<typeof setup>, key: string) => api.calls.filter((c) => `${c.method} ${c.url.pathname}` === key);

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
  vi.stubGlobal('__PASSKEY_RP_ID__', 'localhost');
  browser.supported.value = true;
  browser.startRegistration.mockReset().mockResolvedValue(REGISTRATION);
  trackPortal.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the passkey step after setting a password', () => {
  it('offers a passkey before Home, on /setup, and counts the offer', async () => {
    const { router } = await setPassword();
    const heading = await screen.findByRole('heading', { level: 1, name: STEP });
    expect(screen.getByText(/so you won’t need to type it/)).toBeInTheDocument();
    expect(screen.getByText(/iCloud Keychain or Google Password Manager/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: STEP })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Not now' })).toBeEnabled();
    expect(locationOf(router)).toBe('/setup');
    await waitFor(() => expect(heading).toHaveFocus());
    expect(trackPortal).toHaveBeenCalledWith('setup_passkey_offered', { link: 'setup' });
  });

  it('Create a passkey registers one and lands on Home, with no Home suggestion left', async () => {
    const { api, user, router } = await setPassword();
    await user.click(await screen.findByRole('button', { name: STEP }));
    await waitFor(() => expect(locationOf(router)).toBe(`/p/${ORG_A}`));
    expect(browser.startRegistration).toHaveBeenCalledTimes(1);
    expect(calls(api, 'POST /v1/passkeys')).toHaveLength(1);
    // No password with the add: the sign-in is seconds old
    expect(calls(api, 'POST /v1/passkeys/creation-options')[0]!.body ?? {}).not.toHaveProperty('currentPassword');
    expect(await screen.findByText('Passkey added')).toBeInTheDocument();
    expect(screen.queryByText('Add a passkey: the more secure way to sign in.')).not.toBeInTheDocument();
    expect(calls(api, 'PATCH /v1/me/passkey-prompt')).toHaveLength(0);
    expect(trackPortal).toHaveBeenCalledWith('setup_passkey_created', { link: 'setup' });
  });

  it('after Create, the cached /v1/me already says no offer is due, so Home never shows the card before its refetch', async () => {
    const { user, router, queryClient } = await setPassword();
    await user.click(await screen.findByRole('button', { name: STEP }));
    await waitFor(() => expect(locationOf(router)).toBe(`/p/${ORG_A}`));
    expect(queryClient.getQueryData<Me>(['me'])?.user.passkeyPrompt?.due).toBe(false);
  });

  it('past the 10-minute window, the add sends the password just set once, instead of failing', async () => {
    const { api, user, router } = await setPassword({
      routes: {
        'POST /v1/passkeys/creation-options': (request) =>
          (request.body as { currentPassword?: string } | null)?.currentPassword === PASSWORD ? ok(OPTIONS) : fail(403, 'RECENT_SIGN_IN_REQUIRED'),
      },
    });
    await user.click(await screen.findByRole('button', { name: STEP }));
    await waitFor(() => expect(locationOf(router)).toBe(`/p/${ORG_A}`));
    expect(calls(api, 'POST /v1/passkeys/creation-options')).toHaveLength(2);
    expect(calls(api, 'POST /v1/passkeys')[0]!.body).toMatchObject({ currentPassword: PASSWORD });
  });

  it('Not now spends one MUT-370 offer, then lands on Home with no suggestion card', async () => {
    const { api, user, router } = await setPassword();
    await user.click(await screen.findByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(locationOf(router)).toBe(`/p/${ORG_A}`));
    expect(calls(api, 'PATCH /v1/me/passkey-prompt').map((c) => c.body)).toEqual([{ action: 'not-now' }]);
    expect(browser.startRegistration).not.toHaveBeenCalled();
    expect(screen.queryByText('Add a passkey: the more secure way to sign in.')).not.toBeInTheDocument();
    expect(trackPortal).toHaveBeenCalledWith('setup_passkey_not_now', { link: 'setup' });
  });

  it('Not now still lands on Home when the answer cannot be saved: setup never gets stuck', async () => {
    const { user, router } = await setPassword({ routes: { 'PATCH /v1/me/passkey-prompt': () => fail(503, 'UNAVAILABLE') } });
    await user.click(await screen.findByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(locationOf(router)).toBe(`/p/${ORG_A}`));
  });

  it('a cancelled sheet says no passkey was made and keeps both choices; Not now then continues', async () => {
    browser.startRegistration.mockRejectedValue(Object.assign(new Error('cancelled'), { name: 'NotAllowedError' }));
    const { api, user, router } = await setPassword();
    await user.click(await screen.findByRole('button', { name: STEP }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No passkey was created.');
    expect(locationOf(router)).toBe('/setup');
    expect(screen.getByRole('button', { name: STEP })).toBeEnabled();
    expect(trackPortal).toHaveBeenCalledWith('setup_passkey_not_created', { link: 'setup', reason: 'cancelled' });
    await user.click(screen.getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(locationOf(router)).toBe(`/p/${ORG_A}`));
    expect(calls(api, 'PATCH /v1/me/passkey-prompt')).toHaveLength(1);
  });

  it('a failed add says it could not create one; Create a passkey can be tried again', async () => {
    let tries = 0;
    const { user, router } = await setPassword({
      routes: { 'POST /v1/passkeys': () => (++tries === 1 ? fail(500, 'INTERNAL') : ok(PASSKEY, 201)) },
    });
    await user.click(await screen.findByRole('button', { name: STEP }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t create a passkey.');
    expect(trackPortal).toHaveBeenCalledWith('setup_passkey_not_created', { link: 'setup', reason: 'other' });
    await user.click(screen.getByRole('button', { name: STEP }));
    await waitFor(() => expect(locationOf(router)).toBe(`/p/${ORG_A}`));
  });

  it('holds both buttons while the sheet is open, so a second press starts nothing', async () => {
    let finish: (value: unknown) => void = () => {};
    browser.startRegistration.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const { user } = await setPassword();
    await user.click(await screen.findByRole('button', { name: STEP }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Not now' })).toBeDisabled());
    finish(REGISTRATION);
  });

  it('reads right to left in Arabic', async () => {
    localStorage.removeItem(PORTAL_LANGUAGE_KEY);
    await setPassword({ locale: 'ar' });
    expect(await screen.findByRole('heading', { level: 1, name: 'أنشئ مفتاح مرور' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ليس الآن' })).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
  });
});

describe('after a lost answer (TD-149)', () => {
  it('the retry that signs in instead of calling the link used also offers the step', async () => {
    let redeems = 0;
    const { user } = await setPassword({
      routes: {
        'POST /v1/account-setup': () => (++redeems === 1 ? Promise.reject(new TypeError('Failed to fetch')) : fail(410, 'SETUP_LINK_UNUSABLE', { state: 'used' })),
      },
    });
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Save and sign in' }));
    expect(await screen.findByRole('heading', { level: 1, name: STEP })).toBeInTheDocument();
  });
});

describe('when the step is not offered', () => {
  it('a device that cannot make passkeys goes straight to Home', async () => {
    browser.supported.value = false;
    const { router } = await setPassword();
    await waitFor(() => expect(locationOf(router)).toBe(`/p/${ORG_A}`));
    expect(screen.queryByRole('heading', { name: STEP })).not.toBeInTheDocument();
    expect(trackPortal).not.toHaveBeenCalledWith('setup_passkey_offered', expect.anything());
  });

  it('an account whose offers are spent or hidden goes straight to Home', async () => {
    const { router } = await setPassword({ prompt: { due: false, notNowCount: 3, hiddenUntil: null } });
    await waitFor(() => expect(locationOf(router)).toBe(`/p/${ORG_A}`));
    expect(screen.queryByRole('heading', { name: STEP })).not.toBeInTheDocument();
  });

  it('a recovery on an account that holds passkeys still goes to the MUT-415 review, not the step', async () => {
    const { router } = await setPassword({ purpose: 'RESET', passkeys: [PASSKEY] });
    await waitFor(() => expect(locationOf(router)).toContain('review=recovery'));
    expect(screen.queryByRole('heading', { name: STEP })).not.toBeInTheDocument();
  });
});

describe('a new account (signup link)', () => {
  it('offers the step, then Not now goes on to the personal profile, as before (D13)', async () => {
    const { user, router } = await setPassword({ purpose: 'SIGNUP' });
    await screen.findByRole('heading', { level: 1, name: STEP });
    expect(trackPortal).toHaveBeenCalledWith('setup_passkey_offered', { link: 'signup' });
    await user.click(screen.getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(locationOf(router)).toContain(`/p/${ORG_B}`));
  });
});
