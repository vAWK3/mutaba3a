import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { fail, ok, renderPortal, stubApi, type Handler } from '../../../__tests__/harness';
import { fakeTurnstile } from '../../../__tests__/turnstile';
import { PORTAL_LANGUAGE_KEY } from '../../../i18n/HostedLanguageProvider';
import { setMode } from '../../../session/mode';

/** `/recover` (MUT-368): "Forgot your password?", the same answer for every address (ADR-037 §4). */

const DOORS = 'GET /v1/self-service';
const RECOVER = 'POST /v1/account-recovery';
const routes = (extra: Record<string, Handler> = {}) => ({
  'GET /v1/me': () => fail(401, 'UNAUTHENTICATED'),
  [DOORS]: () => ok({ signup: false, recovery: true }),
  [RECOVER]: () => ok({ status: 'sent' }, 202),
  ...extra,
});

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
  setMode('local');
});
afterEach(() => vi.unstubAllGlobals());

async function recover(address: string, extra: Record<string, Handler> = {}) {
  const turnstile = fakeTurnstile();
  const api = stubApi(routes(extra));
  const view = renderPortal('/recover');
  const email = await screen.findByLabelText('Email');
  await view.user.type(email, address);
  await view.user.click(screen.getByRole('button', { name: 'Send link' }));
  return { ...view, api, email, turnstile };
}

describe('/recover', () => {
  it('sends the address, the page language and a "recover" check, then says the same thing whatever the address', async () => {
    const view = await recover('nour@firm.ps');
    expect(await screen.findByRole('heading', { level: 1, name: 'Check your email' })).toBeInTheDocument();
    expect(screen.getByText(/has an account, we've sent it a link to choose a new password/)).toBeInTheDocument();
    expect(view.api.calls.find((c) => c.url.pathname === '/v1/account-recovery')?.body).toEqual({ email: 'nour@firm.ps', locale: 'en', turnstileToken: 'token-1' });
    expect(vi.mocked(view.turnstile.api.render).mock.calls[0]![1]).toMatchObject({ action: 'recover' });
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/sign-in');
  });

  it('a limit keeps the address and says how long to wait', async () => {
    const view = await recover('nour@firm.ps', { [RECOVER]: () => fail(429, 'RATE_LIMITED', { retryAfterSeconds: 120 }, { 'Retry-After': '120' }) });
    expect(await screen.findByRole('alert')).toHaveTextContent('Please wait 2 minutes before asking again.');
    expect(view.email).toHaveValue('nour@firm.ps');
  });

  it('a 404 from recovery is an outage, never a silent nothing (review #7)', async () => {
    const view = await recover('nour@firm.ps', { [RECOVER]: () => fail(404, 'NOT_FOUND') });
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't reach MTB3A");
    expect(view.email).toHaveValue('nour@firm.ps');
  });

  it('while the server mails no links it says who can help, with no form and no check (D14)', async () => {
    const turnstile = fakeTurnstile();
    stubApi(routes({ [DOORS]: () => ok({ signup: false, recovery: false }) }));
    renderPortal('/recover');
    expect(await screen.findByRole('heading', { name: "Resetting by email isn't available yet" })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'info@malafat.app' })).toHaveAttribute('href', 'mailto:info@malafat.app');
    expect(screen.queryByLabelText('Email')).toBeNull();
    expect(turnstile.api.render).not.toHaveBeenCalled();
  });

  it('reads right to left in Arabic, with the address kept left to right', async () => {
    localStorage.setItem(PORTAL_LANGUAGE_KEY, 'ar');
    fakeTurnstile();
    stubApi(routes());
    const { user } = renderPortal('/recover');
    await user.type(await screen.findByLabelText('البريد الإلكتروني'), 'nour@firm.ps');
    await user.click(screen.getByRole('button', { name: 'أرسل الرابط' }));
    const address = await screen.findByText('nour@firm.ps');
    expect(address.tagName).toBe('BDI');
    expect(document.documentElement.dir).toBe('rtl');
  });
});
