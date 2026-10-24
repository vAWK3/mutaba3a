import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { fail, locationOf, never, ok, renderPortal, stubApi, type Handler } from '../../../__tests__/harness';
import { fakeTurnstile } from '../../../__tests__/turnstile';
import { PORTAL_LANGUAGE_KEY } from '../../../i18n/HostedLanguageProvider';
import { setMode } from '../../../session/mode';

/** `/signup` (MUT-368), mut-368-portal-signup-recover.md §3.2–§3.3, one block per state. */

const DOORS = 'GET /v1/self-service';
const SIGNUP = 'POST /v1/signups';
const OFFER = 'https://landing.test/hosted';
const open = (extra: Record<string, Handler> = {}) => ({
  'GET /v1/me': () => fail(401, 'UNAUTHENTICATED'),
  [DOORS]: () => ok({ signup: true, recovery: true }),
  [SIGNUP]: () => ok({ status: 'sent' }, 202),
  ...extra,
});

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
  setMode('local');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function showForm(routes: Record<string, Handler> = open(), mode: 'pass' | 'hold' | 'fail' = 'pass') {
  const turnstile = fakeTurnstile(mode);
  const api = stubApi(routes);
  const view = renderPortal('/signup');
  const email = await screen.findByLabelText('Email');
  return { ...view, api, email, turnstile };
}

async function ask(view: Awaited<ReturnType<typeof showForm>>, address: string) {
  await view.user.clear(view.email);
  await view.user.type(view.email, address);
  await view.user.click(screen.getByRole('button', { name: 'Continue' }));
}

describe('/signup open', () => {
  it('asks for an email, says the terms come with the password, and sends the address, the page language and the check', async () => {
    vi.stubGlobal('__TERMS_URL__', 'https://landing.test/terms');
    const view = await showForm();
    expect(screen.getByRole('heading', { level: 1, name: 'Create your account' })).toBeInTheDocument();
    expect(view.email).toHaveFocus();
    expect(view.email).toHaveAttribute('dir', 'ltr');
    expect(screen.getByText(/You'll accept the terms when you set your password/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Read the terms' }).getAttribute('href')).toMatch(/^https:\/\/landing\.test\/terms/);
    expect(vi.mocked(view.turnstile.api.render).mock.calls[0]![1]).toMatchObject({ action: 'signup', language: 'en' });

    await ask(view, '  rana@studio.example ');

    expect(await screen.findByRole('heading', { level: 1, name: 'Check your email' })).toBeInTheDocument();
    expect(view.api.calls.find((c) => `${c.method} ${c.url.pathname}` === SIGNUP)?.body).toEqual({ email: 'rana@studio.example', locale: 'en', turnstileToken: 'token-1' });
    expect(screen.getByText('rana@studio.example')).toBeInTheDocument();
    expect(screen.getByText(/If this address already has an account, the email says how to sign in instead/)).toBeInTheDocument();
  });

  it('opens in Arabic, right to left, when no language was chosen', async () => {
    localStorage.clear();
    fakeTurnstile();
    stubApi(open());
    renderPortal('/signup');
    expect(await screen.findByRole('heading', { level: 1, name: 'أنشئ حسابك' })).toBeInTheDocument();
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('"Send again" waits out a minute, then goes back to the form with the address kept', async () => {
    // Only the clock and the countdown's interval are fake: typing, queries and the check run as usual.
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    const view = await showForm();
    await ask(view, 'rana@studio.example');
    await screen.findByRole('heading', { level: 1, name: 'Check your email' });
    const again = screen.getByRole('button', { name: /Send again in \d+ seconds/ });
    expect(again).toBeDisabled();
    act(() => vi.advanceTimersByTime(60_000));
    const ready = screen.getByRole('button', { name: 'Send again' });
    expect(ready).toBeEnabled();
    fireEvent.click(ready);
    vi.useRealTimers();
    expect(await screen.findByLabelText('Email')).toHaveValue('rana@studio.example');
  });

  it.each([
    ['disposable', 'This address is from a throwaway email service. Use one you’ll keep.'.replace('’', "'")],
    ['no-mail', "This address can't receive email. Check it for typos, or use another one."],
  ])('a %s address is refused under the field, the address kept and the check run again', async (reason, copy) => {
    const view = await showForm(open({ [SIGNUP]: () => fail(400, 'EMAIL_NOT_ACCEPTED', { reason }) }));
    await ask(view, 'rana@nomail.example');
    expect(await screen.findByText(copy)).toBeInTheDocument();
    expect(view.email).toHaveValue('rana@nomail.example');
    expect(view.email).toHaveAttribute('aria-invalid', 'true');
    expect(view.turnstile.api.reset).toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Check your email' })).toBeNull();
  });

  it('a refused check says so; the next press sends a fresh token', async () => {
    let first = true;
    const view = await showForm(open({ [SIGNUP]: () => (first ? ((first = false), fail(403, 'CHECK_FAILED')) : ok({ status: 'sent' }, 202)) }));
    await ask(view, 'rana@studio.example');
    expect(await screen.findByRole('alert')).toHaveTextContent("The check didn't pass. Try again.");
    expect(view.email).toHaveValue('rana@studio.example');
    await view.user.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('heading', { name: 'Check your email' });
    const tokens = view.api.calls.filter((c) => c.url.pathname === '/v1/signups').map((c) => (c.body as { turnstileToken: string }).turnstileToken);
    expect(tokens).toEqual(['token-1', 'token-2']);
  });

  it('a limit says how long to wait: a minute, or hours for the day budget', async () => {
    let wait = 30;
    const view = await showForm(open({ [SIGNUP]: () => fail(429, 'RATE_LIMITED', { retryAfterSeconds: wait }, { 'Retry-After': String(wait) }) }));
    await ask(view, 'rana@studio.example');
    expect(await screen.findByRole('alert')).toHaveTextContent('Please wait a minute before asking again.');
    wait = 3 * 3600;
    await view.user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText("You've asked several times today. Try again in 3 hours.")).toBeInTheDocument();
    expect(view.email).toHaveValue('rana@studio.example');
  });

  it('a malformed address is caught before anything is sent', async () => {
    const view = await showForm();
    await ask(view, 'rana@');
    expect(screen.getByText('Enter an email address, like name@firm.ps.')).toBeInTheDocument();
    expect(view.api.count(SIGNUP)).toBe(0);
  });

  it('pressed before the check finished, it waits for the token and then sends (D15)', async () => {
    const view = await showForm(open(), 'hold');
    await ask(view, 'rana@studio.example');
    expect(screen.getByRole('button', { name: "Checking that you're a person…" })).toBeDisabled();
    expect(view.api.count(SIGNUP)).toBe(0);
    await act(async () => view.turnstile.issue());
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
    expect(view.api.count(SIGNUP)).toBe(1);
  });

  it('while it waits for the check the address can’t change, and the address checked is the one sent (review #2)', async () => {
    const view = await showForm(open(), 'hold');
    await ask(view, 'rana@studio.example');
    expect(view.email).toHaveAttribute('readonly');
    await act(async () => view.turnstile.issue());
    await screen.findByRole('heading', { name: 'Check your email' });
    expect(view.api.calls.find((c) => c.url.pathname === '/v1/signups')?.body).toMatchObject({ email: 'rana@studio.example' });
  });

  it('a check that fails while the press waits frees the button again (review #3)', async () => {
    const view = await showForm(open(), 'hold');
    await ask(view, 'rana@studio.example');
    expect(screen.getByRole('button', { name: "Checking that you're a person…" })).toBeDisabled();
    await act(async () => void view.turnstile.last()!['error-callback']('600010'));
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
    expect(screen.getByText(/The check that you're a person couldn't run/)).toBeInTheDocument();
    expect(view.api.count(SIGNUP)).toBe(0);
  });

  it('a check that can’t run says so, offers Try again and the support address, and sends nothing', async () => {
    const view = await showForm(open(), 'fail');
    const message = await screen.findByText(/The check that you're a person couldn't run/);
    expect(within(message).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(within(message).getByRole('link', { name: 'info@malafat.app' })).toHaveAttribute('href', 'mailto:info@malafat.app');
    await ask(view, 'rana@studio.example');
    expect(view.api.count(SIGNUP)).toBe(0);
  });

  it('a 404 from the server (signup closed meanwhile) shows the closed screen', async () => {
    const view = await showForm(open({ [SIGNUP]: () => fail(404, 'NOT_FOUND') }));
    await ask(view, 'rana@studio.example');
    expect(await screen.findByRole('heading', { name: 'Accounts are by request for now' })).toBeInTheDocument();
  });
});

describe('/signup closed or unknown', () => {
  it('while the server opens no signup: accounts are by request, linking the landing form; no form, no check', async () => {
    vi.stubGlobal('__HOSTED_OFFER_URL__', OFFER);
    const turnstile = fakeTurnstile();
    stubApi(open({ [DOORS]: () => ok({ signup: false, recovery: true }) }));
    renderPortal('/signup');
    expect(await screen.findByRole('heading', { name: 'Accounts are by request for now' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Request an account' })).toHaveAttribute('href', OFFER);
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in');
    expect(screen.queryByLabelText('Email')).toBeNull();
    expect(turnstile.api.render).not.toHaveBeenCalled();
  });

  it('no answer about the doors is "can’t reach", with Try again, never "by request" (review P2-10)', async () => {
    fakeTurnstile();
    let down = true;
    const api = stubApi(open({ [DOORS]: () => (down ? fail(503, 'UNKNOWN') : ok({ signup: true, recovery: true })) }));
    const { user } = renderPortal('/signup');
    expect(await screen.findByRole('heading', { name: "Can't reach MTB3A right now" })).toBeInTheDocument();
    expect(screen.queryByText('Accounts are by request for now')).toBeNull();
    down = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByLabelText('Email')).toBeInTheDocument();
    expect(api.count(DOORS)).toBe(2);
  });

  it('a signed-in person who opens /signup goes Home', async () => {
    setMode('remote');
    fakeTurnstile();
    stubApi(open({ 'GET /v1/me': never }));
    renderPortal('/signup');
    expect(await screen.findByText('Checking your session')).toBeInTheDocument();
  });
});

describe('the doors request', () => {
  it('goes to the server even signed out, and only once per page', async () => {
    const view = await showForm();
    await ask(view, 'rana@studio.example');
    await screen.findByRole('heading', { name: 'Check your email' });
    expect(view.api.count(DOORS)).toBe(1);
    expect(locationOf(view.router)).toBe('/signup');
  });
});
