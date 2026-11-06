import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { ORG_A, emptyProfileRoutes, fail, locationOf, me, ok, profile, renderPortal, stubApi, type Handler } from '../../../__tests__/harness';
import { fakeTurnstile } from '../../../__tests__/turnstile';
import { PORTAL_LANGUAGE_KEY } from '../../../i18n/HostedLanguageProvider';

/** MUT-562: the accept-invite page (layout B): signed out, signup then sign-in, signed in, and every refusal (AC4, AC6). */

const TOKEN = 'k'.repeat(43);
const STUDIO = '55555555-5555-4555-8555-555555555555';
const CHECK = 'POST /v1/accountant-invites/check';
const ACCEPT = 'POST /v1/accountant-invites/accept';
const SIGNUP = 'POST /v1/accountant-invites/signup';
const PASSWORD = 'a long enough passphrase';

const invite = { profileName: 'Studio', ownerName: 'Rana Haddad', maskedEmail: 's***@khoury-cpa.com', expired: false, expiresAt: '2026-11-17T10:00:00.000Z', termsVersion: '2026-10-19' };
const clientRow = { profileId: STUDIO, name: 'Studio', ownerName: 'Rana Haddad', sharedSince: '2026-11-06T10:00:00.000Z', profileType: 'business', status: 'active', endedReason: null, endedAt: null };
const signedInMe = () => ({ ...me([profile({ owned: true, isPersonalDefault: true })]), clients: [clientRow] });

function routes(signedIn: boolean, extra: Record<string, Handler> = {}): Record<string, Handler> {
  // Signing in (POST /v1/sessions) starts the session the rest of the portal then reads
  let session = signedIn;
  const signIn = extra['POST /v1/sessions'];
  return {
    ...emptyProfileRoutes(),
    'GET /v1/me': () => (session ? ok(signedInMe()) : fail(401, 'UNAUTHENTICATED')),
    'GET /v1/billing': () => ok({ configured: false }),
    [CHECK]: () => ok(invite),
    'GET /v1/clients': () => ok({ items: [{ ...clientRow, entriesThisMonth: 0, lastActivityAt: null }] }),
    'GET /v1/profile-entries': () => ok({ items: [], nextCursor: null }),
    'GET /v1/summaries/activity': () => ok({ currencies: [] }),
    'GET /v1/expense-categories': () => ok({ items: [] }),
    ...extra,
    ...(signIn
      ? {
          'POST /v1/sessions': (request) => {
            session = true;
            return signIn(request);
          },
        }
      : {}),
  };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener: () => {}, removeEventListener: () => {} }));
});
afterEach(() => vi.unstubAllGlobals());

describe('signed out', () => {
  it('strips the token from the address, checks it in the body, and shows who invited you to what', async () => {
    const api = stubApi(routes(false));
    const { router } = renderPortal(`/accountant-invite#${TOKEN}`);
    expect(await screen.findByRole('heading', { name: 'Rana Haddad invited you to read Studio' })).toBeInTheDocument();
    expect(screen.getByText(/For s\*\*\*@khoury-cpa.com · ends/)).toBeInTheDocument();
    expect(locationOf(router)).toBe('/accountant-invite');
    expect(api.calls.find((c) => `${c.method} ${c.url.pathname}` === CHECK)?.body).toEqual({ token: TOKEN });
    expect(screen.getByRole('link', { name: 'Sign in to accept' })).toHaveAttribute('href', '/sign-in?next=%2Faccountant-invite');
    expect(sessionStorage.getItem('mtb3a-accountant-invite')).toBe(TOKEN);
  });

  it('Create an account: email fixed, the free note, then signup, sign-in and the client book', async () => {
    fakeTurnstile('pass');
    const api = stubApi(
      routes(false, {
        [SIGNUP]: () => ok({ email: 'sami@khoury-cpa.com', status: 'ACTIVE', client: clientRow }, 201),
        'POST /v1/sessions': () => ok(signedInMe()),
      }),
    );
    const { user, router } = renderPortal(`/accountant-invite#${TOKEN}`);
    await user.click(await screen.findByRole('button', { name: 'Create an account' }));
    expect(screen.getByLabelText('Email')).toHaveValue('s***@khoury-cpa.com');
    expect(screen.getByText("The invite's address; it can't be changed.")).toBeInTheDocument();
    expect(screen.getByText(/Reading up to 3 client books is always free/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Name'), 'Sami Khoury');
    await user.type(screen.getByLabelText('Password'), PASSWORD);
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Create account and accept' }));
    await waitFor(() => expect(locationOf(router)).toBe(`/client-books/${STUDIO}`));
    const signup = api.calls.find((c) => `${c.method} ${c.url.pathname}` === SIGNUP)!;
    expect(signup.body).toMatchObject({ token: TOKEN, password: PASSWORD, displayName: 'Sami Khoury', turnstileToken: expect.any(String) });
    expect(api.calls.find((c) => c.url.pathname === '/v1/sessions')?.body).toEqual({ email: 'sami@khoury-cpa.com', password: PASSWORD });
    expect(sessionStorage.getItem('mtb3a-accountant-invite')).toBeNull();
  });

  it('names the check’s terms version; terms changed meanwhile clear the tick and name the new version, sent again only by the person', async () => {
    fakeTurnstile('pass');
    let tries = 0;
    const api = stubApi(
      routes(false, {
        [SIGNUP]: () => (++tries === 1 ? fail(409, 'TERMS_VERSION_STALE', { current: '2026-11-01' }) : ok({ email: 'sami@khoury-cpa.com', status: 'ACTIVE', client: clientRow }, 201)),
        'POST /v1/sessions': () => ok(signedInMe()),
      }),
    );
    const { user, router } = renderPortal(`/accountant-invite#${TOKEN}`);
    await user.click(await screen.findByRole('button', { name: 'Create an account' }));
    await user.type(screen.getByLabelText('Password'), PASSWORD);
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Create account and accept' }));
    expect(await screen.findByText('The terms were just updated. Read them and tick the box again.')).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(api.count(`POST /v1/accountant-invites/signup`)).toBe(1);
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Create account and accept' }));
    await waitFor(() => expect(locationOf(router)).toBe(`/client-books/${STUDIO}`));
    const bodies = api.calls.filter((c) => `${c.method} ${c.url.pathname}` === SIGNUP).map((c) => c.body as { acceptedTermsVersion?: string });
    expect(bodies.map((b) => b.acceptedTermsVersion)).toEqual(['2026-10-19', '2026-11-01']);
  });

  it('an address that already has an account: sign in to accept', async () => {
    fakeTurnstile('pass');
    stubApi(routes(false, { [SIGNUP]: () => fail(409, 'CONFLICT', { reason: 'ACCOUNT_EXISTS' }) }));
    const { user } = renderPortal(`/accountant-invite#${TOKEN}`);
    await user.click(await screen.findByRole('button', { name: 'Create an account' }));
    await user.type(screen.getByLabelText('Password'), PASSWORD);
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Create account and accept' }));
    expect(await screen.findByRole('heading', { name: 'You already have an account' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in to accept' })).toBeInTheDocument();
  });

  it('a used, withdrawn or expired invite is gone', async () => {
    stubApi(routes(false, { [CHECK]: () => fail(404, 'NOT_FOUND') }));
    renderPortal(`/accountant-invite#${TOKEN}`);
    expect(await screen.findByRole('heading', { name: 'This invite is no longer available' })).toBeInTheDocument();
  });
});

describe('signed in', () => {
  it('Accept lands on the new client (AC4)', async () => {
    const api = stubApi(routes(true, { [ACCEPT]: () => ok(clientRow) }));
    const { user, router } = renderPortal(`/accountant-invite#${TOKEN}`);
    expect(await screen.findByRole('heading', { name: "Accept Rana Haddad's invite?" })).toBeInTheDocument();
    expect(screen.getByText(/You're signed in as/)).toHaveTextContent('nour@firm.ps');
    await user.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(locationOf(router)).toBe(`/client-books/${STUDIO}`));
    expect(api.calls.find((c) => `${c.method} ${c.url.pathname}` === ACCEPT)?.body).toEqual({ token: TOKEN });
  });

  it('the token survives the sign-in round trip in this tab', async () => {
    sessionStorage.setItem('mtb3a-accountant-invite', TOKEN);
    stubApi(routes(true));
    renderPortal('/accountant-invite');
    expect(await screen.findByRole('heading', { name: "Accept Rana Haddad's invite?" })).toBeInTheDocument();
  });

  it('another address: the masked one, the same-domain hint, sign out and use another account', async () => {
    stubApi(routes(true, { [ACCEPT]: () => fail(403, 'INVITE_EMAIL_MISMATCH', { maskedEmail: 'h***@firm.com' }) }));
    const { user } = renderPortal(`/accountant-invite#${TOKEN}`);
    await user.click(await screen.findByRole('button', { name: 'Accept' }));
    expect(await screen.findByRole('heading', { name: 'This invite was sent to another address' })).toBeInTheDocument();
    expect(screen.getByText(/h\*\*\*@firm.com/)).toBeInTheDocument();
    expect(screen.getByText(/same company domain works too/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out and use another account' })).toBeInTheDocument();
  });

  it('already reading it: Open', async () => {
    stubApi(routes(true, { [ACCEPT]: () => fail(409, 'CONFLICT', { reason: 'ALREADY_HAS_ACCESS' }) }));
    const { user } = renderPortal(`/accountant-invite#${TOKEN}`);
    await user.click(await screen.findByRole('button', { name: 'Accept' }));
    expect(await screen.findByRole('heading', { name: 'You can already read this profile' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/client-books');
  });

  it('Not now goes Home', async () => {
    stubApi(routes(true));
    const { user, router } = renderPortal(`/accountant-invite#${TOKEN}`);
    await user.click(await screen.findByRole('link', { name: 'Not now' }));
    await waitFor(() => expect(locationOf(router)).toBe(`/p/${ORG_A}`));
  });
});
