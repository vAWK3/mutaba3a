import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { emptyProfileRoutes, fail, locationOf, me, ok, renderPortal, stubApi, type Handler } from '../../../__tests__/harness';
import { PORTAL_LANGUAGE_KEY } from '../../../i18n/HostedLanguageProvider';

/** MUT-710 (D1, D2; wireframes "Sign in" and "Recovery code"): the second step after the password, before any session. */

const APP = { challengeToken: 'chal-app', method: 'totp', expiresAt: '2026-11-24T10:10:00.000Z' };
const EMAIL = { challengeToken: 'chal-mail', method: 'email', expiresAt: '2026-11-24T10:10:00.000Z', emailHint: 'n•••@firm.ps' };
const signedIn = { ...me(), user: { ...me().user, twoFactor: { enabled: true, method: 'totp', recoveryCodesLeft: 9, requiredForIssuing: false } } };

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
});

async function passwordThenSecondStep(challenge: object, finish: Handler, extra: Record<string, Handler> = {}) {
  let session = false;
  const api = stubApi({
    'GET /v1/me': () => (session ? ok(signedIn) : fail(401, 'UNAUTHENTICATED')),
    'GET /v1/self-service': () => ok({ signup: false, recovery: true }),
    'POST /v1/sessions': () => fail(403, 'TWO_FACTOR_REQUIRED', challenge),
    'POST /v1/sessions/two-factor': (request) => {
      const answer = finish(request);
      if (answer instanceof Response && answer.ok) session = true;
      return answer;
    },
    ...emptyProfileRoutes(),
    ...extra,
  });
  const view = renderPortal('/sign-in');
  await view.user.type(await screen.findByLabelText('Email'), 'nour@firm.ps');
  await view.user.type(screen.getByLabelText('Password'), 'a long enough passphrase');
  await view.user.click(screen.getByRole('button', { name: 'Sign in' }));
  await screen.findByRole('heading', { level: 1, name: 'Two-step sign-in' });
  return { ...view, api };
}

describe('two-step sign-in on /sign-in', () => {
  it('the password asks for the app code; a wrong code says the tries left; the right one signs in', async () => {
    let tries = 0;
    const { user, api, router } = await passwordThenSecondStep(APP, () => (++tries === 1 ? fail(403, 'TWO_FACTOR_CODE_WRONG', { triesLeft: 4 }) : ok(signedIn, 201)));
    expect(screen.getByText('Enter the 6-digit code from your authenticator app.')).toBeInTheDocument();
    // No email method: no "Send a new code".
    expect(screen.queryByRole('button', { name: /Send a new code/ })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Enter the 6-digit code.')).toBeInTheDocument();
    expect(api.count('POST /v1/sessions/two-factor')).toBe(0);

    await user.type(screen.getByLabelText('Code'), '111 111');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That code isn’t right. 4 tries left.');
    expect(screen.getByLabelText('Code')).toHaveValue('');

    await user.type(screen.getByLabelText('Code'), '٢٢٢٢٢٢');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(locationOf(router)).not.toContain('/sign-in'));
    const sent = api.calls.filter((c) => c.url.pathname === '/v1/sessions/two-factor').map((c) => c.body);
    expect(sent).toEqual([
      { challengeToken: 'chal-app', code: '111111' },
      { challengeToken: 'chal-app', code: '222222' },
    ]);
  });

  it('a recovery code in place of the code signs in and says how many are left', async () => {
    const { user, api } = await passwordThenSecondStep(APP, () => ok(signedIn, 201));
    await user.click(screen.getByRole('button', { name: 'Use a recovery code instead' }));
    await user.type(screen.getByLabelText('Recovery code'), 'K7MQ2XDP');
    expect(screen.getByLabelText('Recovery code')).toHaveValue('k7mq-2xdp');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText(/You signed in with a recovery code\. 9 are left\./)).toBeInTheDocument();
    expect(api.calls.find((c) => c.url.pathname === '/v1/sessions/two-factor')?.body).toEqual({ challengeToken: 'chal-app', recoveryCode: 'k7mq-2xdp' });
  });

  it('the email method names where the code went and offers a new one after 30 seconds', async () => {
    await passwordThenSecondStep(EMAIL, () => ok(signedIn, 201));
    expect(screen.getByText('n•••@firm.ps')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send a new code in \d+ seconds/ })).toBeDisabled();
  });

  it('five wrong codes end the try: only "Back to sign in" is left, and it keeps the email', async () => {
    const { user } = await passwordThenSecondStep(APP, () => fail(403, 'TWO_FACTOR_TOO_MANY_TRIES'));
    await user.type(screen.getByLabelText('Code'), '333333');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many wrong codes. Start signing in again.');
    expect(screen.queryByLabelText('Code')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Back to sign in' }));
    expect(await screen.findByLabelText('Email')).toHaveValue('nour@firm.ps');
    expect(screen.getByLabelText('Password')).toHaveValue('');
  });
});
