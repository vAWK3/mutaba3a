import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import {
  ORG_A,
  ORG_B,
  emptyProfileRoutes,
  fail,
  locationOf,
  me,
  never,
  ok,
  profile,
  renderPortal,
  stubApi,
} from '../../__tests__/harness';
import { PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';
import { SESSION_CHANNEL } from '../channel';

/** mut-43-auth-states.md §2–§3, one block per state. */

const BANNED = /sign ?up|create account|forgot|reset password|invite|إنشاء حساب|نسيت|إعادة تعيين|دعوة|اشترك/i;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
});
afterEach(() => vi.unstubAllGlobals());

function signedIn(extra = {}) {
  return stubApi({ 'GET /v1/me': () => ok(me()), ...emptyProfileRoutes(), ...extra });
}

describe('S1 checking session', () => {
  it('shows neither the form nor the shell while /v1/me is pending, and the spinner only after 400 ms', async () => {
    stubApi({ 'GET /v1/me': never });
    renderPortal('/');
    expect(await screen.findByText('Mutaba3a')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByLabelText('Email')).toBeNull();
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(await screen.findByRole('status', {}, { timeout: 1500 })).toHaveAccessibleName('Checking your session');
  });
});

describe('S2 boot unreachable', () => {
  it.each([
    ['a network error', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['a 500', () => fail(500, 'INTERNAL')],
  ])('renders the boot card on %s, and Try again recovers', async (_label, failure) => {
    let attempt = 0;
    stubApi({
      'GET /v1/me': () => (++attempt === 1 ? failure() : ok(me())),
      ...emptyProfileRoutes(),
    });
    const { user } = renderPortal('/');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Can't reach Mutaba3a right now");
    expect(screen.queryByLabelText('Email')).toBeNull();
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('navigation', { name: 'Sections' })).toBeInTheDocument();
  });
});

describe('S3 sign in', () => {
  it('sends a 401 from /v1/me to /sign-in with next, focused on email, with no signup or reset affordance', async () => {
    stubApi({ 'GET /v1/me': () => fail(401, 'UNAUTHENTICATED') });
    const { router, container } = renderPortal('/p/abc/receivables');
    const email = await screen.findByLabelText('Email');
    expect(locationOf(router)).toBe('/sign-in?next=%2Fp%2Fabc%2Freceivables');
    expect(email).toHaveFocus();
    expect(email).toHaveAttribute('autocomplete', 'username');
    expect(email).toHaveAttribute('dir', 'ltr');
    const password = screen.getByLabelText('Password');
    expect(password).toHaveAttribute('autocomplete', 'current-password');
    expect(password).toHaveAttribute('dir', 'ltr');
    expect(container.textContent).not.toMatch(BANNED);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.getByText("Can't sign in? Ask the person who set up your account for a new password.")).toBeInTheDocument();
  });

  it('adds no next when the person was headed to the root', async () => {
    stubApi({ 'GET /v1/me': () => fail(401, 'UNAUTHENTICATED') });
    const { router } = renderPortal('/');
    await screen.findByLabelText('Email');
    expect(locationOf(router)).toBe('/sign-in');
  });

  it('toggles password visibility with an aria-pressed button', async () => {
    stubApi({ 'GET /v1/me': () => fail(401, 'UNAUTHENTICATED') });
    const { user } = renderPortal('/sign-in');
    const toggle = await screen.findByRole('button', { name: 'Show' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await user.click(toggle);
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('redirects to next when a session already exists', async () => {
    signedIn();
    const { router } = renderPortal(`/sign-in?next=${encodeURIComponent(`/p/${ORG_A}/payments`)}`);
    await waitFor(() => expect(locationOf(router)).toBe(`/p/${ORG_A}/payments`));
  });
});

async function onSignIn(responses: Record<string, Parameters<typeof stubApi>[0][string]> = {}, path = '/sign-in') {
  const api = stubApi({ 'GET /v1/me': () => fail(401, 'UNAUTHENTICATED'), ...emptyProfileRoutes(), ...responses });
  const portal = renderPortal(path);
  await screen.findByLabelText('Email');
  return { ...portal, api };
}

describe('S4 missing input', () => {
  it('sends nothing and marks both fields', async () => {
    const { user, api } = await onSignIn();
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Enter your email.')).toBeInTheDocument();
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveFocus();
    expect(api.count('POST /v1/sessions')).toBe(0);
  });

  it('flags a malformed email', async () => {
    const { user, api } = await onSignIn();
    await user.type(screen.getByLabelText('Email'), 'nour-at-firm');
    await user.type(screen.getByLabelText('Password'), 'secret');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Enter an email address, like name@firm.ps.')).toBeInTheDocument();
    expect(api.count('POST /v1/sessions')).toBe(0);
  });
});

async function submit(user: ReturnType<typeof renderPortal>['user']) {
  await user.type(screen.getByLabelText('Email'), 'nour@firm.ps');
  await user.type(screen.getByLabelText('Password'), 'correct horse');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('S5 signing in', () => {
  it('disables the button and freezes the fields while the request is in flight', async () => {
    const { user, api } = await onSignIn({ 'POST /v1/sessions': never });
    await submit(user);
    const button = await screen.findByRole('button', { name: /Signing in/ });
    expect(button).toBeDisabled();
    expect(screen.getByLabelText('Email')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Password')).toHaveAttribute('readonly');
    await user.click(button);
    expect(api.count('POST /v1/sessions')).toBe(1);
  });
});

describe('S6 did not match', () => {
  it('shows one banner, clears and focuses the password, keeps the email', async () => {
    const { user } = await onSignIn({ 'POST /v1/sessions': () => fail(401, 'INVALID_CREDENTIALS') });
    await submit(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "That email and password don't match. After 5 tries, sign-in pauses for 15 minutes.",
    );
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(screen.getByLabelText('Password')).toHaveFocus();
    expect(screen.getByLabelText('Email')).toHaveValue('nour@firm.ps');
  });
});

describe('S7 too many attempts', () => {
  it('reads Retry-After and pluralises the minutes', async () => {
    const { user } = await onSignIn({
      'POST /v1/sessions': () => fail(429, 'RATE_LIMITED', { retryAfterSeconds: 150 }, { 'Retry-After': '150' }),
    });
    await submit(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again in 3 minutes.');
  });

  it('uses the Arabic few form', async () => {
    localStorage.setItem(PORTAL_LANGUAGE_KEY, 'ar');
    const api = stubApi({
      'GET /v1/me': () => fail(401, 'UNAUTHENTICATED'),
      'POST /v1/sessions': () => fail(429, 'RATE_LIMITED', null, { 'Retry-After': '150' }),
    });
    const { user } = renderPortal('/sign-in');
    await user.type(await screen.findByLabelText('البريد الإلكتروني'), 'nour@firm.ps');
    await user.type(screen.getByLabelText('كلمة المرور'), 'x');
    await user.click(screen.getByRole('button', { name: 'تسجيل الدخول' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('حاول مجدداً بعد 3 دقائق.');
    expect(api.count('POST /v1/sessions')).toBe(1);
  });
});

describe('S8 cannot reach (sign-in)', () => {
  it.each([
    ['a network error', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['a 500', () => fail(500, 'INTERNAL')],
    ['a 403', () => fail(403, 'CROSS_SITE_REQUEST')],
  ])('keeps the values on %s', async (_label, failure) => {
    const { user } = await onSignIn({ 'POST /v1/sessions': failure });
    await submit(user);
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't reach Mutaba3a. Check your connection and try again.");
    expect(screen.getByLabelText('Email')).toHaveValue('nour@firm.ps');
    expect(screen.getByLabelText('Password')).toHaveValue('correct horse');
  });
});

describe('S9/S10 arrival notes', () => {
  it('reason=expired notes it and returns to next after sign-in', async () => {
    const target = `/p/${ORG_A}/receivables`;
    const { user, router } = await onSignIn({ 'POST /v1/sessions': () => ok(me(), 201) }, `/sign-in?next=${encodeURIComponent(target)}&reason=expired`);
    expect(screen.getByRole('note')).toHaveTextContent("You've been signed out. Sign in again to continue.");
    await submit(user);
    await waitFor(() => expect(locationOf(router)).toBe(target));
  });

  it('reason=signed_out notes it and drops next', async () => {
    const { user, router } = await onSignIn(
      { 'POST /v1/sessions': () => ok(me(), 201) },
      `/sign-in?next=${encodeURIComponent(`/p/${ORG_A}/payments`)}&reason=signed_out`,
    );
    expect(screen.getByRole('note')).toHaveTextContent("You've signed out.");
    await submit(user);
    await waitFor(() => expect(locationOf(router)).toBe(`/p/${ORG_A}`));
  });
});

describe('S11 no profiles', () => {
  it('offers only Sign out', async () => {
    stubApi({ 'GET /v1/me': () => ok(me([])) });
    renderPortal('/');
    expect(await screen.findByText("Your account isn't connected to a profile yet")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Sections' })).toBeNull();
  });
});

describe('S12 profile unavailable', () => {
  it('offers the first remaining profile for an unknown id', async () => {
    signedIn();
    const { user, router } = renderPortal(`/p/${ORG_B}`);
    expect(await screen.findByText("This profile isn't available")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Go to Haddad & Partners' }));
    await waitFor(() => expect(locationOf(router)).toBe(`/p/${ORG_A}`));
  });

  it('turns a 404 into S12 when /v1/me no longer lists the profile', async () => {
    let meCalls = 0;
    stubApi({
      ...emptyProfileRoutes(),
      'GET /v1/me': () => ok(++meCalls === 1 ? me() : me([profile({ id: ORG_B, name: 'Other firm' })])),
      'GET /v1/receivables': () => fail(404, 'NOT_FOUND'),
    });
    renderPortal(`/p/${ORG_A}/receivables`);
    expect(await screen.findByText("This profile isn't available")).toBeInTheDocument();
  });

  it('keeps an ordinary not-found when the profile is still listed', async () => {
    signedIn({ 'GET /v1/receivables': () => fail(404, 'NOT_FOUND') });
    renderPortal(`/p/${ORG_A}/receivables`);
    expect(await screen.findByRole('alert')).toHaveTextContent("Can't reach Mutaba3a right now");
    expect(screen.queryByText("This profile isn't available")).toBeNull();
  });
});

describe('S13 / E2 sign out', () => {
  it('keeps the person in place with a toast when DELETE fails', async () => {
    signedIn({ 'DELETE /v1/sessions/current': () => Promise.reject(new TypeError('offline')) });
    const { user, router } = renderPortal(`/p/${ORG_A}`);
    await user.click(await screen.findByRole('button', { name: /Account/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't sign out. Check your connection and try again.");
    expect(locationOf(router)).toBe(`/p/${ORG_A}`);
  });

  it('clears the cache, broadcasts and lands on the signed-out note', async () => {
    const received: unknown[] = [];
    const listener = new BroadcastChannel(SESSION_CHANNEL);
    listener.onmessage = (event) => received.push(event.data);
    let meStatus = 200;
    stubApi({
      ...emptyProfileRoutes(),
      'GET /v1/me': () => (meStatus === 200 ? ok(me()) : fail(401, 'UNAUTHENTICATED')),
      'DELETE /v1/sessions/current': () => {
        meStatus = 401;
        return new Response(null, { status: 204 });
      },
    });
    const { user, router, queryClient } = renderPortal(`/p/${ORG_A}`);
    await user.click(await screen.findByRole('button', { name: /Account/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    expect(await screen.findByText("You've signed out.")).toBeInTheDocument();
    expect(locationOf(router)).toBe('/sign-in?reason=signed_out');
    expect(queryClient.getQueryCache().findAll({ queryKey: ['p'] })).toHaveLength(0);
    await waitFor(() => expect(received).toEqual(['signed_out']));
    // This tab hears its own announcement too; the sign-in form must survive it (not fall back to the session check).
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await screen.findByLabelText('Email')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
    listener.close();
  });
});

describe('E1 session ends mid-use', () => {
  it('clears the cache before the sign-in route renders, and keeps next', async () => {
    let fail401 = false;
    stubApi({
      ...emptyProfileRoutes(),
      'GET /v1/me': () => (fail401 ? fail(401, 'SESSION_EXPIRED') : ok(me())),
      'GET /v1/receivables': () => (fail401 ? fail(401, 'SESSION_EXPIRED') : ok({ items: [], nextCursor: null })),
    });
    const { router, queryClient } = renderPortal(`/p/${ORG_A}/receivables`);
    await screen.findByText('Nothing is owed on this profile right now');
    fail401 = true;
    const seenOnSignIn: number[] = [];
    const unsubscribe = router.subscribe('onResolved', () => {
      if (router.state.location.pathname === '/sign-in') seenOnSignIn.push(queryClient.getQueryCache().getAll().filter((q) => q.state.data !== undefined && q.queryKey[0] === 'p').length);
    });
    await act(() => queryClient.invalidateQueries({ queryKey: ['p'] }));
    expect(await screen.findByText("You've been signed out. Sign in again to continue.")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/sign-in');
    expect(router.state.location.search).toEqual({ next: `/p/${ORG_A}/receivables`, reason: 'expired' });
    expect(seenOnSignIn.every((n) => n === 0)).toBe(true);
    unsubscribe();
  });
});

describe('E3 signed out in another tab', () => {
  it('clears and navigates on a signed_out broadcast', async () => {
    let revoked = false;
    stubApi({ ...emptyProfileRoutes(), 'GET /v1/me': () => (revoked ? fail(401, 'SESSION_EXPIRED') : ok(me())) });
    const { router } = renderPortal(`/p/${ORG_A}`);
    await screen.findByRole('navigation', { name: 'Sections' });
    revoked = true; // the other tab's DELETE revoked the shared cookie's session
    const other = new BroadcastChannel(SESSION_CHANNEL);
    other.postMessage('signed_out');
    expect(await screen.findByText("You've signed out.")).toBeInTheDocument();
    expect(locationOf(router)).toBe('/sign-in?reason=signed_out');
    other.close();
  });
});

describe('E3 on the sign-in page', () => {
  it('leaves the form alone when a signed_out announcement arrives (the signing-out tab hears its own)', async () => {
    stubApi({ 'GET /v1/me': () => fail(401, 'UNAUTHENTICATED') });
    const { user } = renderPortal('/sign-in?reason=signed_out');
    await screen.findByLabelText('Email');
    const announcer = new BroadcastChannel(SESSION_CHANNEL);
    announcer.postMessage('signed_out');
    await new Promise((resolve) => setTimeout(resolve, 100));
    // Any re-render after the announcement (here a language switch) must still find a settled session check.
    await user.click(screen.getByRole('button', { name: 'عربي' }));
    expect(await screen.findByLabelText('البريد الإلكتروني', {}, { timeout: 1500 })).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
    announcer.close();
  });
});

describe('E4 account locale', () => {
  it('applies the account locale after /v1/me when the browser has no stored choice', async () => {
    localStorage.clear();
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US');
    stubApi({ 'GET /v1/me': () => ok(me([profile()], 'ar')), ...emptyProfileRoutes() });
    renderPortal(`/p/${ORG_A}`);
    expect(await screen.findByRole('navigation', { name: 'الأقسام' })).toBeInTheDocument();
    expect(document.documentElement.dir).toBe('rtl');
  });
});
