import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { fail, locationOf, me, ok, profile, renderPortal, stubApi, ORG_A, type Handler } from '../../../__tests__/harness';
import { fakeTurnstile } from '../../../__tests__/turnstile';
import { PORTAL_LANGUAGE_KEY } from '../../../i18n/HostedLanguageProvider';

/** "Email me a sign-in code" on /sign-in (MUT-618, ADR-256 D9). */

const ASK = 'POST /v1/sign-in-codes';
const CODE = 'POST /v1/sessions/code';
const DOORS = { signup: false, recovery: true, malafatSignIn: false, signInCode: true };

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
  vi.stubGlobal('__PASSKEY_RP_ID__', '');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function page(extra: Record<string, Handler> = {}, doors = DOORS, path = '/sign-in') {
  let signedIn = false;
  const turnstile = fakeTurnstile();
  const api = stubApi({
    'GET /v1/me': () => (signedIn ? ok(me([profile()], 'en')) : fail(401, 'UNAUTHENTICATED')),
    'GET /v1/self-service': () => ok(doors),
    [ASK]: () => ok({ status: 'sent' }, 202),
    [CODE]: () => {
      signedIn = true;
      return ok(me([profile()], 'en'), 201);
    },
    ...extra,
  });
  return { ...renderPortal(path), api, turnstile };
}

async function toCodeStep(view: ReturnType<typeof page>, address = 'rana@studio.ps') {
  await view.user.type(await screen.findByLabelText('Email'), address);
  await view.user.click(await screen.findByRole('button', { name: 'Email me a sign-in code' }));
  return screen.findByLabelText('Sign-in code');
}

describe('the link', () => {
  it('sits beside "Forgot your password?" while the server mails codes', async () => {
    page();
    const forgot = await screen.findByRole('link', { name: 'Forgot your password?' });
    const link = await screen.findByRole('button', { name: 'Email me a sign-in code' });
    expect(link.parentElement).toBe(forgot.parentElement);
  });

  it('is not offered while the server mails nothing', async () => {
    page({}, { ...DOORS, recovery: false, signInCode: false });
    await screen.findByLabelText('Email');
    expect(screen.queryByRole('button', { name: 'Email me a sign-in code' })).toBeNull();
  });

  it('asks for the email first, and sends nothing', async () => {
    const view = page();
    await view.user.click(await screen.findByRole('button', { name: 'Email me a sign-in code' }));
    expect(screen.getByText('Enter your email.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveFocus();
    expect(view.api.count(ASK)).toBe(0);
  });
});

describe('the code step', () => {
  it('mails a code for the typed address after a "sign-in-code" check, then signs in with it', async () => {
    const view = page({}, DOORS, `/sign-in?next=${encodeURIComponent(`/p/${ORG_A}/expenses`)}`);
    const field = await toCodeStep(view);
    expect(view.api.calls.find((c) => c.url.pathname === '/v1/sign-in-codes')?.body).toEqual({ email: 'rana@studio.ps', locale: 'en', turnstileToken: 'token-1' });
    expect(vi.mocked(view.turnstile.api.render).mock.calls[0]![1]).toMatchObject({ action: 'sign-in-code' });
    expect(screen.getByRole('heading', { level: 1, name: 'Check your email' })).toBeInTheDocument();
    expect(field).toHaveAttribute('autocomplete', 'one-time-code');
    expect(field).toHaveAttribute('inputmode', 'numeric');
    await view.user.type(field, '123 456');
    expect(field).toHaveValue('123456');
    await view.user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(locationOf(view.router)).toBe(`/p/${ORG_A}/expenses`));
    expect(view.api.calls.find((c) => c.url.pathname === '/v1/sessions/code')?.body).toEqual({ email: 'rana@studio.ps', code: '123456' });
  });

  it('takes Arabic-Indic digits as typed', async () => {
    const view = page();
    const field = await toCodeStep(view);
    await view.user.type(field, '١٢٣٤٥٦');
    expect(field).toHaveValue('123456');
  });

  it('a short code asks for all six digits and sends nothing', async () => {
    const view = page();
    const field = await toCodeStep(view);
    await view.user.type(field, '123');
    await view.user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Enter the 6-digit code from the email.')).toBeInTheDocument();
    expect(view.api.count(CODE)).toBe(0);
  });

  it.each([
    ['a wrong code says how many tries are left', fail(401, 'SIGN_IN_CODE_WRONG', { triesLeft: 3 }), 'That code isn’t right. 3 tries left.'],
    ['an expired code offers a new one', fail(401, 'SIGN_IN_CODE_EXPIRED'), 'That code has expired or was already used. Send a new one.'],
    ['the fifth wrong try', fail(401, 'SIGN_IN_CODE_TOO_MANY_TRIES'), 'Too many wrong tries. That code no longer works; send a new one.'],
    ['a lockout says how long to wait', fail(429, 'RATE_LIMITED', { retryAfterSeconds: 900 }, { 'Retry-After': '900' }), 'Too many tries. Try again in 15 minutes.'],
    ['a server failure says it couldn’t reach MTB3A', fail(503, 'SERVICE_UNAVAILABLE'), "Couldn't reach MTB3A"],
  ] as const)('%s', async (_name, answer, message) => {
    const view = page({ [CODE]: () => answer.clone() });
    const field = await toCodeStep(view);
    await view.user.type(field, '123456');
    await view.user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByLabelText('Sign-in code')).toBeInTheDocument();
  });

  it('the right code on an account under review shows the review notice', async () => {
    const view = page({ [CODE]: () => fail(403, 'ACCOUNT_UNDER_REVIEW') });
    const field = await toCodeStep(view);
    await view.user.type(field, '123456');
    await view.user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { level: 1, name: "We're reviewing your account" })).toBeInTheDocument();
  });

  it('"Resend code" waits a minute, then asks again with a fresh check', async () => {
    const view = page();
    await toCodeStep(view);
    expect(screen.getByRole('button', { name: /Resend code in \d+ seconds/ })).toBeDisabled();
    const real = Date.now.bind(Date);
    vi.spyOn(Date, 'now').mockImplementation(() => real() + 61_000);
    await view.user.click(await screen.findByRole('button', { name: 'Resend code' }, { timeout: 2500 }));
    expect(await screen.findByText('We’ve sent a new code. The older one no longer works.')).toBeInTheDocument();
    const asks = view.api.calls.filter((c) => c.url.pathname === '/v1/sign-in-codes').map((c) => (c.body as { turnstileToken: string }).turnstileToken);
    expect(asks).toHaveLength(2);
    expect(asks[0]).not.toBe(asks[1]);
  });

  it('a limited ask says how long to wait', async () => {
    const view = page({ [ASK]: () => fail(429, 'RATE_LIMITED', { retryAfterSeconds: 60 }, { 'Retry-After': '60' }) });
    await view.user.type(await screen.findByLabelText('Email'), 'rana@studio.ps');
    await view.user.click(await screen.findByRole('button', { name: 'Email me a sign-in code' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Please wait a minute before asking again.');
  });

  it('"Use my password instead" goes back with the email kept', async () => {
    const view = page();
    await toCodeStep(view);
    await view.user.click(screen.getByRole('button', { name: 'Use my password instead' }));
    expect(await screen.findByLabelText('Email')).toHaveValue('rana@studio.ps');
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
  });

  it('reads right to left in Arabic, with the address and the code left to right', async () => {
    localStorage.setItem(PORTAL_LANGUAGE_KEY, 'ar');
    const view = page();
    await view.user.type(await screen.findByLabelText('البريد الإلكتروني'), 'rana@studio.ps');
    await view.user.click(await screen.findByRole('button', { name: 'أرسل لي رمز دخول بالبريد' }));
    const field = await screen.findByLabelText('رمز الدخول');
    expect(field).toHaveAttribute('dir', 'ltr');
    expect((await screen.findByText('rana@studio.ps')).tagName).toBe('BDI');
    expect(document.documentElement.dir).toBe('rtl');
  });
});
