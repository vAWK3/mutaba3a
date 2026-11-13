import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { emptyProfileRoutes, fail, locationOf, me, ok, renderPortal, stubApi, type Handler } from '../../../../__tests__/harness';
import { PORTAL_LANGUAGE_KEY } from '../../../../i18n/HostedLanguageProvider';
import { currentMode } from '../../../../session/mode';
import { leaveForMalafat } from '../malafatSignIn';

/** MUT-596: Sign in with Malafat, the office step (`/malafat`) and the return (`/malafat/return`). */

const OFFICE = 'GET /v1/auth/malafat/office';
const EXCHANGE = 'POST /v1/auth/malafat/exchange';
const LINK = 'POST /v1/auth/malafat/link';
const CONSENT = 'POST /v1/auth/malafat/consent';
const EMAIL = 'rana@sader.law';
const office = { slug: 'sader', name: 'Sader & Partners' };

function routes(extra: Record<string, Handler> = {}): Record<string, Handler> {
  return { ...emptyProfileRoutes(), 'GET /v1/me': () => fail(401, 'UNAUTHENTICATED'), [OFFICE]: () => ok(office), ...extra };
}

const callsTo = (api: { calls: Array<{ method: string; url: URL; body: unknown }> }, route: string) => api.calls.filter((c) => `${c.method} ${c.url.pathname}` === route);

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
});
afterEach(() => vi.restoreAllMocks());

describe('the office step', () => {
  it('checks the office, remembers it, and leaves for the server start', async () => {
    const go = vi.spyOn(leaveForMalafat, 'go').mockImplementation(() => {});
    const api = stubApi(routes());
    const { user } = renderPortal('/malafat');
    await user.type(await screen.findByLabelText('Your Malafat office address'), 'https://Sader.malafat.app/');
    await user.click(screen.getByRole('button', { name: 'Continue to Malafat' }));
    await waitFor(() => expect(go).toHaveBeenCalledWith('/v1/auth/malafat/start?tenant=sader&client=web'));
    expect(callsTo(api, OFFICE)[0]?.url.searchParams.get('tenant')).toBe('sader');
    expect(localStorage.getItem('mtb3a.malafatOffice')).toBe('sader');
  });

  it('opens on the remembered office', async () => {
    localStorage.setItem('mtb3a.malafatOffice', 'sader');
    stubApi(routes());
    renderPortal('/malafat');
    expect(await screen.findByLabelText('Your Malafat office address')).toHaveValue('sader');
  });

  it('says so here when no office has that address, and never leaves', async () => {
    const go = vi.spyOn(leaveForMalafat, 'go').mockImplementation(() => {});
    stubApi(routes({ [OFFICE]: () => fail(404, 'NOT_FOUND') }));
    const { user } = renderPortal('/malafat');
    const field = await screen.findByLabelText('Your Malafat office address');
    await user.type(field, 'nosuch');
    await user.click(screen.getByRole('button', { name: 'Continue to Malafat' }));
    expect(await screen.findByText("There's no Malafat office at that address. Check it and try again.")).toBeInTheDocument();
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(go).not.toHaveBeenCalled();
  });

  it('asks for an office before checking anything', async () => {
    const api = stubApi(routes());
    const { user } = renderPortal('/malafat');
    await screen.findByLabelText('Your Malafat office address');
    await user.click(screen.getByRole('button', { name: 'Continue to Malafat' }));
    expect(await screen.findByText('Type your office address.')).toBeInTheDocument();
    expect(callsTo(api, OFFICE)).toHaveLength(0);
  });
});

describe('the return', () => {
  it('signs a linked person in: one exchange, the fragment stripped', async () => {
    const api = stubApi(routes({ [EXCHANGE]: () => ok({ state: 'signed_in', me: me() }), 'GET /v1/me': () => ok(me()) }));
    const { router } = renderPortal('/malafat/return#result=code-1');
    await waitFor(() => expect(locationOf(router)).not.toMatch(/^\/malafat/));
    expect(callsTo(api, EXCHANGE).map((c) => c.body)).toEqual([{ result: 'code-1' }]);
    expect(router.history.location.href).not.toContain('code-1');
    expect(currentMode()).toBe('remote');
  });

  it('shows what Malafat said when the person declined, and exchanges nothing', async () => {
    const api = stubApi(routes());
    renderPortal('/malafat/return#error=access_denied');
    expect(await screen.findByText("You didn't allow MTB3A in Malafat. Nothing was changed.")).toBeInTheDocument();
    expect(callsTo(api, EXCHANGE)).toHaveLength(0);
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/sign-in');
  });

  it('reads a used code as an expired sign-in', async () => {
    stubApi(routes({ [EXCHANGE]: () => fail(404, 'NOT_FOUND') }));
    renderPortal('/malafat/return#result=used');
    expect(await screen.findByText('This sign-in has expired. Start again.')).toBeInTheDocument();
  });

  it('a new person consents, naming the currency and agreeing to the terms, and is signed in', async () => {
    const ticket = { state: 'needs_consent', ticket: 't-1', email: 'nadia@sader.law', creates: true, office, termsVersion: '2026-10-19' };
    const api = stubApi(routes({ [EXCHANGE]: () => ok(ticket), [CONSENT]: () => ok({ state: 'signed_in', me: me() }), 'GET /v1/me': () => ok(me()) }));
    const { user, router } = renderPortal('/malafat/return#result=code-2');
    expect(await screen.findByText(/We'll create an MTB3A account for nadia@sader.law/)).toBeInTheDocument();
    expect(screen.getByText('Sader & Partners')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Base currency'), 'USD');
    await user.click(screen.getByRole('button', { name: 'Create account and continue' }));
    expect(await screen.findByText('Tick to agree to the terms before you continue.')).toBeInTheDocument();
    expect(callsTo(api, CONSENT)).toHaveLength(0);
    await user.click(screen.getByRole('checkbox', { name: /terms of service/ }));
    await user.click(screen.getByRole('button', { name: 'Create account and continue' }));
    await waitFor(() => expect(locationOf(router)).not.toMatch(/^\/malafat/));
    expect(callsTo(api, CONSENT)[0]?.body).toMatchObject({ ticket: 't-1', defaultCurrency: 'USD', acceptedTermsVersion: '2026-10-19' });
  });

  it('terms that changed while the consent was open: the new version, to tick again', async () => {
    let calls = 0;
    const ticket = { state: 'needs_consent', ticket: 't-5', email: 'nadia@sader.law', creates: true, office, termsVersion: '2026-10-19' };
    const api = stubApi(
      routes({
        [EXCHANGE]: () => ok(ticket),
        [CONSENT]: () => (++calls === 1 ? fail(409, 'TERMS_VERSION_STALE', { current: '2026-11-01' }) : ok({ state: 'signed_in', me: me() })),
        'GET /v1/me': () => ok(me()),
      }),
    );
    const { user } = renderPortal('/malafat/return#result=code-5');
    await user.click(await screen.findByRole('checkbox', { name: /terms of service/ }));
    await user.click(screen.getByRole('button', { name: 'Create account and continue' }));
    expect(await screen.findByText(/The terms changed while this page was open/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /terms of service/ })).not.toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: /terms of service/ }));
    await user.click(screen.getByRole('button', { name: 'Create account and continue' }));
    await waitFor(() => expect(callsTo(api, CONSENT)).toHaveLength(2));
    expect(callsTo(api, CONSENT)[1]?.body).toMatchObject({ acceptedTermsVersion: '2026-11-01' });
  });

  it('linking proves the existing account with its password; a wrong one asks again', async () => {
    let tries = 0;
    const linkState = { state: 'needs_link', ticket: 't-2', email: EMAIL, creates: false, office };
    const api = stubApi(
      routes({
        [EXCHANGE]: () => ok(linkState),
        [LINK]: () => (++tries === 1 ? fail(401, 'INVALID_CREDENTIALS') : ok({ state: 'needs_consent', ticket: 't-3', email: EMAIL, creates: false, office })),
        [CONSENT]: () => ok({ state: 'signed_in', me: me() }),
        'GET /v1/me': () => ok(me()),
      }),
    );
    const { user, router } = renderPortal('/malafat/return#result=code-3');
    const password = await screen.findByLabelText('Your MTB3A password');
    await user.type(password, 'wrong');
    await user.click(screen.getByRole('button', { name: 'Connect the accounts' }));
    expect(await screen.findByText("That password doesn't match this account.")).toBeInTheDocument();
    await user.type(password, 'right one');
    await user.click(screen.getByRole('button', { name: 'Connect the accounts' }));
    await user.click(await screen.findByRole('button', { name: 'Connect and continue' }));
    await waitFor(() => expect(locationOf(router)).not.toMatch(/^\/malafat/));
    expect(callsTo(api, LINK).map((c) => c.body)).toEqual([
      { ticket: 't-2', password: 'wrong' },
      { ticket: 't-2', password: 'right one' },
    ]);
    expect(callsTo(api, CONSENT)[0]?.body).toEqual({ ticket: 't-3' });
  });

  it('says when this Malafat account already belongs to another MTB3A account', async () => {
    stubApi(
      routes({
        [EXCHANGE]: () => ok({ state: 'needs_link', ticket: 't-4', email: EMAIL, creates: false, office }),
        [LINK]: () => fail(409, 'CONFLICT', { reason: 'IDENTITY_LINKED_ELSEWHERE' }),
      }),
    );
    const { user } = renderPortal('/malafat/return#result=code-4');
    await user.type(await screen.findByLabelText('Your MTB3A password'), 'pw');
    await user.click(screen.getByRole('button', { name: 'Connect the accounts' }));
    expect(await screen.findByText('This Malafat account is already connected to another MTB3A account.')).toBeInTheDocument();
  });
});
