import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { fail, locationOf, me, ok, profile, renderPortal, stubApi, ORG_A, type Handler } from '../../../__tests__/harness';
import { PORTAL_ACCOUNT_LOCALE_KEY, PORTAL_LANGUAGE_KEY } from '../../../i18n/HostedLanguageProvider';

/**
 * MUT-115 (DR1, DR4, §11.4, §11.11): "Sign in with a passkey" on /sign-in, and passkeys in the email field's autofill.
 * The platform sheet is the browser's, so @simplewebauthn/browser is replaced; the server is stubbed.
 */
const browser = vi.hoisted(() => ({ startAuthentication: vi.fn(), autofill: vi.fn(async () => false), cancel: vi.fn() }));
vi.mock('@simplewebauthn/browser', async (importOriginal) => {
  const real = await importOriginal<typeof import('@simplewebauthn/browser')>();
  return {
    ...real,
    startAuthentication: browser.startAuthentication,
    browserSupportsWebAuthn: () => true,
    browserSupportsWebAuthnAutofill: browser.autofill,
    WebAuthnAbortService: { ...real.WebAuthnAbortService, cancelCeremony: browser.cancel },
  };
});

const CHALLENGE = { challengeId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', publicKey: { challenge: 'abc', rpId: 'localhost', allowCredentials: [] } };
const ASSERTION = { id: 'cred', rawId: 'cred', type: 'public-key', response: { clientDataJSON: 'e30', authenticatorData: 'e30', signature: 'e30', userHandle: 'dQ' }, clientExtensionResults: {} };

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
  vi.stubGlobal('__PASSKEY_RP_ID__', 'localhost');
  browser.startAuthentication.mockReset().mockResolvedValue(ASSERTION);
  browser.autofill.mockReset().mockResolvedValue(false);
  browser.cancel.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

function signInPage(extra: Record<string, Handler> = {}, path = '/sign-in') {
  let signedIn = false;
  const api = stubApi({
    'GET /v1/me': () => (signedIn ? ok(me([profile()], 'ar')) : fail(401, 'UNAUTHENTICATED')),
    'GET /v1/self-service': () => ok({ signup: false, recovery: false }),
    'POST /v1/passkey-challenges': () => ok(CHALLENGE, 201),
    'POST /v1/sessions/passkey': () => {
      signedIn = true;
      return ok(me([profile()], 'ar'), 201);
    },
    ...extra,
  });
  return { ...renderPortal(path), api };
}

describe('passkey sign-in (MUT-115)', () => {
  it('is not offered where passkeys don’t work on this host', async () => {
    vi.stubGlobal('__PASSKEY_RP_ID__', '');
    signInPage();
    expect(await screen.findByLabelText('Email')).toHaveAttribute('autocomplete', 'username');
    expect(screen.queryByRole('button', { name: 'Sign in with a passkey' })).toBeNull();
    expect(screen.queryByText('or')).toBeNull();
  });

  it('offers the button under the password form, and passkeys in the email field’s autofill', async () => {
    signInPage();
    expect(await screen.findByLabelText('Email')).toHaveAttribute('autocomplete', 'username webauthn');
    const buttons = screen.getAllByRole('button', { name: /^Sign in/ });
    expect(buttons.map((b) => b.textContent)).toEqual(['Sign in', 'Sign in with a passkey']);
    expect(screen.getByRole('separator')).toHaveTextContent('or');
  });

  it('signs in through the same path as the password: remote mode, the account’s language, `next`', async () => {
    const { user, api, router } = signInPage({}, `/sign-in?next=${encodeURIComponent(`/p/${ORG_A}/expenses`)}`);
    await user.click(await screen.findByRole('button', { name: 'Sign in with a passkey' }));
    await waitFor(() => expect(locationOf(router)).toBe(`/p/${ORG_A}/expenses`));
    expect(api.calls.find((c) => c.url.pathname === '/v1/sessions/passkey')?.body).toEqual({ challengeId: CHALLENGE.challengeId, response: ASSERTION });
    // The account's language is adopted (this browser's own choice, English here, still wins: MUT-209).
    expect(localStorage.getItem(PORTAL_ACCOUNT_LOCALE_KEY)).toContain('ar');
  });

  it('a cancelled sheet shows nothing and sends nothing', async () => {
    browser.startAuthentication.mockRejectedValue(Object.assign(new Error('x'), { name: 'NotAllowedError' }));
    const { user, api } = signInPage();
    await user.click(await screen.findByRole('button', { name: 'Sign in with a passkey' }));
    await waitFor(() => expect(browser.startAuthentication).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(api.count('POST /v1/sessions/passkey')).toBe(0);
  });

  it('a refused passkey points back to the password; a rate limit reads as today', async () => {
    const { user } = signInPage({ 'POST /v1/sessions/passkey': () => fail(401, 'INVALID_CREDENTIALS') });
    await user.click(await screen.findByRole('button', { name: 'Sign in with a passkey' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That passkey didn’t work. Try again, or sign in with your password.');
  });

  it('a pending account gets the under-review screen, as with the password', async () => {
    const { user } = signInPage({ 'POST /v1/sessions/passkey': () => fail(403, 'ACCOUNT_UNDER_REVIEW') });
    await user.click(await screen.findByRole('button', { name: 'Sign in with a passkey' }));
    expect(await screen.findByRole('heading', { name: /review/i })).toBeInTheDocument();
  });

  it('autofill: a passkey picked in the email field signs in', async () => {
    browser.autofill.mockResolvedValue(true);
    const { api, router } = signInPage();
    await waitFor(() => expect(browser.startAuthentication).toHaveBeenCalledWith(expect.objectContaining({ useBrowserAutofill: true })));
    await waitFor(() => expect(api.count('POST /v1/sessions/passkey')).toBe(1));
    await waitFor(() => expect(locationOf(router)).toMatch(new RegExp(`^/p/${ORG_A}`)));
  });

  it('submitting the password ends the autofill wait first', async () => {
    browser.autofill.mockResolvedValue(true);
    browser.startAuthentication.mockImplementation(() => new Promise(() => {}));
    const { user } = signInPage({ 'POST /v1/sessions': () => fail(401, 'INVALID_CREDENTIALS') });
    await waitFor(() => expect(browser.startAuthentication).toHaveBeenCalled());
    await user.type(screen.getByLabelText('Email'), 'nour@firm.ps');
    await user.type(screen.getByLabelText('Password'), 'not-the-password');
    browser.cancel.mockClear();
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(browser.cancel).toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent(/didn’t match|do not match|match/i);
  });
});
