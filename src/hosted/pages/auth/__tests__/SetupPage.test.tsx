import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { focusManager } from '@tanstack/react-query';
import { ORG_A, emptyProfileRoutes, fail, locationOf, me, never, ok, renderPortal, stubApi, type Handler } from '../../../__tests__/harness';
import { PORTAL_LANGUAGE_KEY } from '../../../i18n/HostedLanguageProvider';
import { SESSION_CHANNEL, SIGNED_OUT } from '../../../session/channel';

/** `/setup` (MUT-236), mut-236-setup-page-tests.md "Component", one block per state. */

const TOKEN = 'k'.repeat(43);
const EMAIL = 'nour@firm.ps';
const PASSWORD = 'a long enough passphrase';
const CHECK = 'POST /v1/account-setup/check';
const REDEEM = 'POST /v1/account-setup';
const SIGN_IN = 'POST /v1/sessions';
/** The ADR-037 bundle rule (auth-states.test.tsx): no self-service account door, in either language. */
const BANNED = /sign ?up|create account|forgot|reset password|invite|إنشاء حساب|نسيت|إعادة تعيين|دعوة|اشترك/i;

const TERMS_VERSION = '2026-10-19';
const TERMS_URL = 'https://mutaba3a.example/terms';
const valid = (overrides: { locale?: 'en' | 'ar'; purpose?: 'SETUP' | 'RESET' } = {}) => () =>
  ok({
    state: 'valid',
    email: EMAIL,
    locale: overrides.locale ?? 'en',
    purpose: overrides.purpose ?? 'SETUP',
    expiresAt: '2026-10-19T09:00:00.000Z',
    termsVersion: TERMS_VERSION,
  });
const unusable = (state: string) => () => fail(410, 'SETUP_LINK_UNUSABLE', { state });

function routes(extra: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    ...emptyProfileRoutes(),
    'GET /v1/me': () => fail(401, 'UNAUTHENTICATED'),
    [CHECK]: valid(),
    [REDEEM]: () => ok({ email: EMAIL }),
    [SIGN_IN]: () => ok(me()),
    ...extra,
  };
}

const chooseEnglish = () => localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');

async function openForm(extra: Record<string, Handler> = {}) {
  const api = stubApi(routes(extra));
  const view = renderPortal(`/setup#${TOKEN}`);
  const password = await screen.findByLabelText('New password');
  return { ...view, api, password };
}

/** MUT-324: saving needs the terms ticked; every save below agrees unless a test says otherwise. */
async function save(user: ReturnType<typeof renderPortal>['user'], password: HTMLElement, value = PASSWORD, agree = true) {
  await user.clear(password);
  await user.type(password, value);
  const terms = screen.getByRole('checkbox', { name: /terms of service/ });
  if (agree && !(terms as HTMLInputElement).checked) await user.click(terms);
  await user.click(screen.getByRole('button', { name: 'Save and sign in' }));
}

const redeems = (api: { calls: Array<{ method: string; url: URL; body: unknown }> }) => api.calls.filter((c) => `${c.method} ${c.url.pathname}` === REDEEM);

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('a valid link', () => {
  it('checks the token from the fragment, strips the fragment, and opens the form in the account language', async () => {
    const { api, router } = await openForm();
    expect(api.calls.find((c) => `${c.method} ${c.url.pathname}` === CHECK)?.body).toEqual({ token: TOKEN });
    expect(locationOf(router)).toBe('/setup');
    expect(router.history.location.href).not.toContain('#');
    expect(screen.getByRole('heading', { level: 1, name: 'Set your password' })).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('lang', 'en');
  });

  it('opens in Arabic, right to left, for an Arabic account', async () => {
    stubApi(routes({ [CHECK]: valid({ locale: 'ar' }) }));
    renderPortal(`/setup#${TOKEN}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'اختر كلمة المرور' })).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
  });

  it('keeps a language chosen in this browser over the account locale (MUT-209)', async () => {
    chooseEnglish();
    stubApi(routes({ [CHECK]: valid({ locale: 'ar' }) }));
    renderPortal(`/setup#${TOKEN}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Set your password' })).toBeInTheDocument();
  });

  it('words a reset link as a new password that signs the account out elsewhere', async () => {
    await openForm({ [CHECK]: valid({ purpose: 'RESET' }) });
    expect(screen.getByRole('heading', { level: 1, name: 'Choose a new password' })).toBeInTheDocument();
    expect(screen.getByText(/signs this account out everywhere else/)).toBeInTheDocument();
  });

  it('hands password managers a visible read-only username and a new-password field, with the rule shown (D2)', async () => {
    const { container, password } = await openForm();
    const account = screen.getByLabelText('Account');
    expect(account).toHaveValue(EMAIL);
    expect(account).toHaveAttribute('autocomplete', 'username');
    expect(account).toHaveAttribute('readonly');
    expect(container.querySelectorAll('input[autocomplete="username"]')).toHaveLength(1);
    expect(password).toHaveAttribute('autocomplete', 'new-password');
    expect(password).toHaveAttribute('dir', 'ltr');
    expect(password).toHaveFocus();
    expect(password).toHaveAccessibleDescription('Use 12 to 128 characters.');
  });

  it('never re-checks the link when the window regains focus (eng review A1)', async () => {
    const { api } = await openForm();
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await act(async () => {});
    expect(api.count(CHECK)).toBe(1);
  });
});

describe('the password rule', () => {
  it('refuses a short or a long password inline and sends nothing', async () => {
    const { api, user, password } = await openForm();
    await save(user, password, 'a'.repeat(11));
    expect(screen.getByText('Use at least 12 characters.')).toBeInTheDocument();
    expect(password).toHaveAttribute('aria-invalid', 'true');
    expect(password).toHaveFocus();
    await save(user, password, 'a'.repeat(129));
    expect(screen.getByText('Use 128 characters or fewer.')).toBeInTheDocument();
    expect(api.count(REDEEM)).toBe(0);
  });
});

describe('saving', () => {
  it('sets the password, signs in with it, and lands on Home', async () => {
    const { api, user, password, router } = await openForm();
    await save(user, password);
    await waitFor(() => expect(locationOf(router)).toBe(`/p/${ORG_A}`));
    expect(api.calls.find((c) => `${c.method} ${c.url.pathname}` === REDEEM)?.body).toEqual({
      token: TOKEN,
      password: PASSWORD,
      acceptedTermsVersion: TERMS_VERSION,
      termsLocale: 'en',
    });
    expect(api.calls.find((c) => `${c.method} ${c.url.pathname}` === SIGN_IN)?.body).toEqual({ email: EMAIL, password: PASSWORD });
  });

  it('holds the button while saving, so a second click sends nothing', async () => {
    const { api, user, password } = await openForm({ [REDEEM]: never });
    await save(user, password);
    const button = screen.getByRole('button', { name: 'Saving…' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    await user.click(button);
    expect(api.count(REDEEM)).toBe(1);
  });

  it('says the link expired when it ran out while the form was open, and drops the form', async () => {
    const { user, password } = await openForm({ [REDEEM]: unusable('expired') });
    await save(user, password);
    expect(await screen.findByRole('heading', { level: 1, name: 'This link has expired' })).toBeInTheDocument();
    expect(screen.queryByLabelText('New password')).toBeNull();
  });

  it('shows a plain "used" on a first attempt, without trying to sign in', async () => {
    const { api, user, password } = await openForm({ [REDEEM]: unusable('used') });
    await save(user, password);
    expect(await screen.findByRole('heading', { level: 1, name: 'This link has been used' })).toBeInTheDocument();
    expect(api.count(SIGN_IN)).toBe(0);
  });

  it('after a lost answer, a "used" retry signs in with the typed password (TD-149, D3)', async () => {
    let attempt = 0;
    const { api, user, password, router } = await openForm({
      [REDEEM]: () => (++attempt === 1 ? Promise.reject(new TypeError('Failed to fetch')) : unusable('used')()),
    });
    await save(user, password);
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't reach Mutaba3a");
    expect(screen.getByLabelText('New password')).toHaveValue(PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Save and sign in' }));
    await waitFor(() => expect(locationOf(router)).toBe(`/p/${ORG_A}`));
    expect(api.calls.find((c) => `${c.method} ${c.url.pathname}` === SIGN_IN)?.body).toEqual({ email: EMAIL, password: PASSWORD });
  });

  it('after a lost answer, if that sign-in fails it says the password is probably saved, never "ask for a new link"', async () => {
    let attempt = 0;
    const { user, password } = await openForm({
      [REDEEM]: () => (++attempt === 1 ? fail(504, 'UNKNOWN') : unusable('used')()),
      [SIGN_IN]: () => fail(401, 'INVALID_CREDENTIALS'),
    });
    await save(user, password);
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Save and sign in' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Your password is probably saved' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute('href', '/sign-in');
    expect(screen.queryByText(/new link/)).toBeNull();
  });

  it('says a rate limit in minutes and keeps the form', async () => {
    const { user, password } = await openForm({ [REDEEM]: () => fail(429, 'RATE_LIMITED', { retryAfterSeconds: 120 }) });
    await save(user, password);
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again in 2 minutes.');
    expect(screen.getByLabelText('New password')).toBeInTheDocument();
  });

  it('when the password is set but the sign-in fails, says so and links to sign-in', async () => {
    const { user, password } = await openForm({ [SIGN_IN]: () => fail(429, 'RATE_LIMITED') });
    await save(user, password);
    expect(await screen.findByRole('heading', { level: 1, name: 'Your password is saved' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute('href', '/sign-in');
  });
});

describe('the terms (MUT-324)', () => {
  it('refuses to save until the terms are ticked, says why, and sends nothing', async () => {
    const { api, user, password } = await openForm();
    await save(user, password, PASSWORD, false);
    expect(await screen.findByText('Tick to agree to the terms before you continue.')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /terms of service/ })).toHaveFocus();
    expect(redeems(api)).toHaveLength(0);
  });

  it('on an Arabic page, links the Arabic text and records Arabic', async () => {
    vi.stubGlobal('__TERMS_URL__', TERMS_URL);
    const api = stubApi(routes({ [CHECK]: valid({ locale: 'ar' }) }));
    const { user } = renderPortal(`/setup#${TOKEN}`);
    const password = await screen.findByLabelText('كلمة المرور الجديدة');
    expect(screen.getByRole('link', { name: 'شروط الخدمة' })).toHaveAttribute('href', `${TERMS_URL}/${TERMS_VERSION}?lang=ar`);
    await user.type(password, PASSWORD);
    await user.click(screen.getByRole('checkbox', { name: /شروط الخدمة/ }));
    await user.click(screen.getByRole('button', { name: 'احفظ وسجّل الدخول' }));
    await waitFor(() => expect(redeems(api)).toHaveLength(1));
    expect(redeems(api)[0]?.body).toEqual({ token: TOKEN, password: PASSWORD, acceptedTermsVersion: TERMS_VERSION, termsLocale: 'ar' });
  });

  it('links the exact version being accepted, in the language recorded, in a new tab', async () => {
    vi.stubGlobal('__TERMS_URL__', TERMS_URL);
    await openForm();
    const link = screen.getByRole('link', { name: 'terms of service' });
    expect(link).toHaveAttribute('href', `${TERMS_URL}/${TERMS_VERSION}?lang=en`);
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('when the terms changed while the page was open, asks to read the new version and tick again', async () => {
    vi.stubGlobal('__TERMS_URL__', TERMS_URL);
    const { api, user, password } = await openForm({ [REDEEM]: () => fail(409, 'TERMS_VERSION_STALE', { current: '2027-01-01' }) });
    await save(user, password);
    expect(await screen.findByText(/The terms changed while this page was open/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /terms of service/ })).not.toBeChecked();
    expect(screen.getByRole('link', { name: 'terms of service' })).toHaveAttribute('href', `${TERMS_URL}/2027-01-01?lang=en`);
    expect(screen.queryByText('Use 12 to 128 characters.', { selector: '.hp-field-error' })).not.toBeInTheDocument();
    await save(user, password);
    await waitFor(() => expect(redeems(api)).toHaveLength(2));
    expect((redeems(api)[1]?.body as { acceptedTermsVersion: string }).acceptedTermsVersion).toBe('2027-01-01');
  });

  it('when the server says the terms changed but not to what, asks the link again for the version, so the retry is not stale', async () => {
    vi.stubGlobal('__TERMS_URL__', TERMS_URL);
    let checks = 0;
    const { api, user, password } = await openForm({
      [CHECK]: () => ok({ state: 'valid', email: EMAIL, locale: 'en', purpose: 'SETUP', expiresAt: '2026-10-19T09:00:00.000Z', termsVersion: ++checks === 1 ? TERMS_VERSION : '2027-01-01' }),
      [REDEEM]: (call) =>
        (call.body as { acceptedTermsVersion: string }).acceptedTermsVersion === '2027-01-01' ? ok({ email: EMAIL }) : fail(409, 'TERMS_VERSION_STALE'),
    });
    await save(user, password);
    expect(await screen.findByText(/The terms changed while this page was open/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('link', { name: 'terms of service' })).toHaveAttribute('href', `${TERMS_URL}/2027-01-01?lang=en`));
    await save(user, password);
    await waitFor(() => expect(redeems(api)).toHaveLength(2));
    expect((redeems(api)[1]?.body as { acceptedTermsVersion: string }).acceptedTermsVersion).toBe('2027-01-01');
  });
});

describe('a link that cannot be used', () => {
  const CASES = [
    ['expired', 'This link has expired'],
    ['used', 'This link has been used'],
    ['superseded', 'A newer link replaced this one'],
    ['invalid', "This link doesn't work"],
  ] as const;

  for (const [state, heading] of CASES) {
    it(`says "${heading}" for a ${state} link, with no form`, async () => {
      chooseEnglish();
      const api = stubApi(routes({ [CHECK]: () => ok({ state }) }));
      const { container } = renderPortal(`/setup#${TOKEN}`);
      expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
      expect(screen.queryByLabelText('New password')).toBeNull();
      expect(container.querySelector('input')).toBeNull();
      expect(container.textContent).not.toMatch(BANNED);
      expect(api.count(REDEEM)).toBe(0);
      if (state === 'used') expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute('href', '/sign-in');
    });
  }

  it('says each in Arabic too', async () => {
    stubApi(routes({ [CHECK]: () => ok({ state: 'expired' }) }));
    renderPortal(`/setup#${TOKEN}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'انتهت صلاحية هذا الرابط' })).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
  });

  it('treats a malformed token (422) as a link that does not work', async () => {
    chooseEnglish();
    stubApi(routes({ [CHECK]: () => fail(422, 'VALIDATION_FAILED') }));
    renderPortal(`/setup#${TOKEN}`);
    expect(await screen.findByRole('heading', { level: 1, name: "This link doesn't work" })).toBeInTheDocument();
  });

  it('says the link is incomplete when the fragment is missing, and asks the server nothing', async () => {
    chooseEnglish();
    const api = stubApi(routes());
    renderPortal('/setup');
    expect(await screen.findByRole('heading', { level: 1, name: 'This link is incomplete' })).toBeInTheDocument();
    expect(api.count(CHECK)).toBe(0);
  });
});

describe('a second link pasted into the same tab', () => {
  it('checks the new token, although only the fragment changed', async () => {
    chooseEnglish();
    const fresh = 'n'.repeat(43);
    const api = stubApi(routes({ [CHECK]: ({ body }) => ((body as { token: string }).token === fresh ? valid()() : ok({ state: 'expired' })) }));
    const { router } = renderPortal(`/setup#${TOKEN}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'This link has expired' })).toBeInTheDocument();
    await act(() => router.navigate({ to: '/setup', hash: fresh }));
    expect(await screen.findByLabelText('New password')).toBeInTheDocument();
    expect(api.calls.filter((c) => `${c.method} ${c.url.pathname}` === CHECK).map((c) => (c.body as { token: string }).token)).toEqual([TOKEN, fresh]);
    await waitFor(() => expect(locationOf(router)).toBe('/setup'));
  });
});

describe('when the check does not get through', () => {
  it('offers Try again when the server is unreachable, and the retry shows the form', async () => {
    chooseEnglish();
    let attempt = 0;
    stubApi(routes({ [CHECK]: () => (++attempt === 1 ? Promise.reject(new TypeError('Failed to fetch')) : valid()()) }));
    const { user } = renderPortal(`/setup#${TOKEN}`);
    expect(await screen.findByText("Couldn't reach Mutaba3a. Check your connection and try again.")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByLabelText('New password')).toBeInTheDocument();
  });

  it('says a rate limit in minutes', async () => {
    chooseEnglish();
    stubApi(routes({ [CHECK]: () => fail(429, 'RATE_LIMITED', { retryAfterSeconds: 60 }) }));
    renderPortal(`/setup#${TOKEN}`);
    expect(await screen.findByText('Too many attempts from this network. Try again in 1 minute.')).toBeInTheDocument();
  });
});

describe('another tab signing out', () => {
  it('leaves /setup where it is', async () => {
    const { router } = await openForm();
    const other = new BroadcastChannel(SESSION_CHANNEL);
    other.postMessage(SIGNED_OUT);
    other.close();
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(locationOf(router)).toBe('/setup');
    expect(screen.getByLabelText('New password')).toBeInTheDocument();
  });
});
