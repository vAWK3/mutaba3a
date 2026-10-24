import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { fail, ok, renderPortal, stubApi, type Handler } from '../../../__tests__/harness';
import { PORTAL_LANGUAGE_KEY } from '../../../i18n/HostedLanguageProvider';

/** `/sign-in` and the self-service doors (MUT-368): what shows depends on what the server opens (D1, D14). */

const OFFER = 'https://landing.test/hosted';
const routes = (doors: { signup: boolean; recovery: boolean } | null, extra: Record<string, Handler> = {}) => ({
  'GET /v1/me': () => fail(401, 'UNAUTHENTICATED'),
  ...(doors ? { 'GET /v1/self-service': () => ok(doors) } : {}),
  ...extra,
});

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
  vi.stubGlobal('__HOSTED_OFFER_URL__', OFFER);
});
afterEach(() => vi.unstubAllGlobals());

async function onSignIn(doors: { signup: boolean; recovery: boolean } | null, extra: Record<string, Handler> = {}) {
  const api = stubApi(routes(doors, extra));
  const view = renderPortal('/sign-in');
  await screen.findByLabelText('Email');
  return { ...view, api };
}

describe('the doors on sign-in', () => {
  it('both open: "Forgot your password?" and "Create an account", and no request form', async () => {
    await onSignIn({ signup: true, recovery: true });
    expect(await screen.findByRole('link', { name: 'Forgot your password?' })).toHaveAttribute('href', '/recover');
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute('href', '/signup');
    expect(screen.queryByRole('link', { name: 'Request one' })).toBeNull();
    expect(screen.queryByText(/Ask the person who set up your account/)).toBeNull();
  });

  it('recovery only (GA not yet open): "Forgot your password?" and the landing request form', async () => {
    await onSignIn({ signup: false, recovery: true });
    expect(await screen.findByRole('link', { name: 'Forgot your password?' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Request one' })).toHaveAttribute('href', OFFER);
    expect(screen.queryByRole('link', { name: 'Create an account' })).toBeNull();
  });

  it.each([
    ['mail off', { signup: false, recovery: false }],
    ['no answer', null],
  ] as const)('%s: no door, and today\'s "ask the person who set up your account"', async (_name, doors) => {
    await onSignIn(doors);
    expect(screen.getByText("Can't sign in? Ask the person who set up your account for a new password.")).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Forgot your password?' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Create an account' })).toBeNull();
  });
});

describe('an account waiting for review (MUT-367)', () => {
  it('the right password shows the under-review screen; Sign out gives back an empty sign-in page', async () => {
    const { user } = await onSignIn({ signup: true, recovery: true }, { 'POST /v1/sessions': () => fail(403, 'ACCOUNT_UNDER_REVIEW') });
    await user.type(screen.getByLabelText('Email'), 'rana@gmail.com');
    await user.type(screen.getByLabelText('Password'), 'a long enough passphrase');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { level: 1, name: "We're reviewing your account" })).toBeInTheDocument();
    expect(screen.getByText("We'll email you within 2 working days.")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'info@malafat.app' })).toHaveAttribute('href', 'mailto:info@malafat.app');
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByLabelText('Email')).toHaveValue('');
    expect(screen.getByLabelText('Password')).toHaveValue('');
  });

  it('a wrong password is still the usual refusal, which reveals nothing', async () => {
    const { user } = await onSignIn(null, { 'POST /v1/sessions': () => fail(401, 'INVALID_CREDENTIALS') });
    await user.type(screen.getByLabelText('Email'), 'rana@gmail.com');
    await user.type(screen.getByLabelText('Password'), 'not the password at all');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("That email and password don't match.");
    expect(screen.queryByText("We're reviewing your account")).toBeNull();
  });
});
