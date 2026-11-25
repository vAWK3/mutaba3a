import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { ORG_A, emptyProfileRoutes, fail, locationOf, me, ok, profile, renderPortal, stubApi, type Handler } from '../../__tests__/harness';

/** MUT-710 (D8, D9; wireframes "Turn on" and "Manage"): You › Account › Two-step sign-in (`?twoFactor=true`). */

type State = { enabled: boolean; method: 'totp' | 'email' | null; recoveryCodesLeft: number; requiredForIssuing: boolean };
const OFF: State = { enabled: false, method: null, recoveryCodesLeft: 0, requiredForIssuing: false };
const ON: State = { enabled: true, method: 'totp', recoveryCodesLeft: 8, requiredForIssuing: false };
const CODES = ['k7mq-2xdp', 'h4vt-9wcn', 'p3rf-6jxa', 'z8bn-4tqe', 'c2wy-7hmk', 'f9ds-3pvr', 'm6ga-8kzt', 'x5ue-2nfb', 'r4jh-9cwq', 'v7tp-6mya'];
const ENROLMENT = { enrolmentToken: 'enrol-1', method: 'totp', expiresAt: '2026-11-24T10:10:00.000Z', secret: 'JBSWY3DPEHPK3PXP7QMR', otpauthUri: 'otpauth://totp/MTB3A:nour%40firm.ps?secret=JBSWY3DPEHPK3PXP7QMR', qrSvg: '<svg xmlns="http://www.w3.org/2000/svg"/>', emailCodeRequired: false };

function portal(path: string, initial: State, routes: Record<string, Handler> = {}) {
  let state = initial;
  const person = () => ({ ...me([profile()]), user: { ...me().user, twoFactor: state } });
  const api = stubApi({
    'GET /v1/me': () => ok(person()),
    ...emptyProfileRoutes(),
    'GET /v1/me/two-factor': () => ok(state),
    ...routes,
  });
  return { ...renderPortal(path), api, set: (next: State) => (state = next) };
}

describe('Two-step sign-in drawer (MUT-710)', () => {
  it('You › Account shows it off with what it does, and opens the drawer', async () => {
    const { user, router } = portal(`/p/${ORG_A}/you/account`, OFF);
    const row = await screen.findByRole('button', { name: /^Two-step sign-in/ });
    expect(row).toHaveTextContent('Off. A code after your password, from an app or by email.');
    await user.click(row);
    expect(await screen.findByRole('dialog', { name: 'Turn on two-step sign-in' })).toBeInTheDocument();
    expect(locationOf(router)).toBe(`/p/${ORG_A}/you/account?twoFactor=true`);
  });

  it('turns on with the app: password, QR and key, the code, then the ten codes; Done waits for the tick', async () => {
    const { user, api, set } = portal(`/p/${ORG_A}?twoFactor=true`, OFF, {
      'POST /v1/me/two-factor/enrolment': () => ok(ENROLMENT, 201),
      'POST /v1/me/two-factor/enrolment/confirm': () => {
        set({ ...ON, recoveryCodesLeft: 10 });
        return ok({ recoveryCodes: CODES });
      },
    });
    const choose = await screen.findByRole('dialog', { name: 'Turn on two-step sign-in' });
    expect(within(choose).getByRole('radio', { name: /Authenticator app/ })).toBeChecked();
    await user.type(within(choose).getByLabelText('Current password'), 'my password');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    const prove = await screen.findByRole('dialog', { name: 'Authenticator app' });
    expect(within(prove).getByRole('img', { name: 'QR code for your authenticator app' })).toBeInTheDocument();
    expect(within(prove).getByText('JBSW Y3DP EHPK 3PXP 7QMR')).toBeInTheDocument();
    await user.type(within(prove).getByLabelText('Code the app shows'), '123456');
    await user.click(screen.getByRole('button', { name: 'Turn on' }));

    const codes = await screen.findByRole('dialog', { name: 'Save your recovery codes' });
    expect(within(codes).getAllByRole('listitem').map((li) => li.textContent)).toEqual(CODES);
    const done = within(codes).getAllByRole('button', { name: 'Done' }).at(-1)!;
    expect(done).toHaveAttribute('aria-disabled', 'true');
    await user.click(within(codes).getByRole('checkbox', { name: 'I’ve saved these codes' }));
    await user.click(done);
    expect(await screen.findByText('Two-step sign-in is on. Your other sessions were signed out.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const sent = (path: string) => api.calls.find((c) => c.url.pathname === path)?.body;
    expect(sent('/v1/me/two-factor/enrolment')).toEqual({ method: 'totp', currentPassword: 'my password' });
    expect(sent('/v1/me/two-factor/enrolment/confirm')).toEqual({ enrolmentToken: 'enrol-1', code: '123456' });
  });

  it('a wrong current password is said, and nothing moves on', async () => {
    const { user } = portal(`/p/${ORG_A}?twoFactor=true`, OFF, { 'POST /v1/me/two-factor/enrolment': () => fail(403, 'CURRENT_PASSWORD_WRONG') });
    const choose = await screen.findByRole('dialog', { name: 'Turn on two-step sign-in' });
    await user.type(within(choose).getByLabelText('Current password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await within(choose).findByRole('alert')).toHaveTextContent('Current password is wrong.');
    expect(screen.getByRole('dialog', { name: 'Turn on two-step sign-in' })).toBeInTheDocument();
  });

  it('on: shows the method and the codes left; turning off takes the password and the current code', async () => {
    const challenge = { challengeToken: 'manage-1', method: 'totp', expiresAt: '2026-11-24T10:10:00.000Z' };
    const { user, api } = portal(`/p/${ORG_A}?twoFactor=true`, ON, {
      'POST /v1/me/two-factor/challenge': () => ok(challenge, 201),
      'DELETE /v1/me/two-factor': () => new Response(null, { status: 204 }),
    });
    await screen.findByRole('button', { name: 'Turn off two-step sign-in' });
    const manage = screen.getByRole('dialog', { name: 'Two-step sign-in' });
    expect(manage).toHaveTextContent('Authenticator app');
    expect(manage).toHaveTextContent('8 of 10 left');
    await user.click(within(manage).getByRole('button', { name: 'Turn off two-step sign-in' }));

    const confirm = await screen.findByRole('dialog', { name: 'Turn off two-step sign-in' });
    await user.type(within(confirm).getByLabelText('Current password'), 'my password');
    await user.type(await within(confirm).findByLabelText('Code from your app'), '654321');
    await user.click(within(confirm).getAllByRole('button', { name: 'Turn off two-step sign-in' }).at(-1)!);
    expect(await screen.findByText('Two-step sign-in is off.')).toBeInTheDocument();
    expect(api.calls.find((c) => c.method === 'DELETE' && c.url.pathname === '/v1/me/two-factor')?.body).toEqual({ currentPassword: 'my password', challengeToken: 'manage-1', code: '654321' });
  });

  it('while a profile issues documents, turning off is shown but says why it can’t be done', async () => {
    portal(`/p/${ORG_A}?twoFactor=true`, { ...ON, requiredForIssuing: true });
    const off = await screen.findByRole('button', { name: /Turn off two-step sign-in/ });
    expect(off).toHaveAttribute('aria-disabled', 'true');
    expect(off).toHaveTextContent('Required while you issue documents or are connected to the Tax Authority.');
  });
});
