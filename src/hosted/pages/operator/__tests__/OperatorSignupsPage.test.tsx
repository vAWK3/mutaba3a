import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import type { Me, SignupReview } from '../../../api/client';
import { fail, locationOf, me, never, ok, openYou, profile, renderPortal, stubApi, type Handler } from '../../../__tests__/harness';
import { PORTAL_LANGUAGE_KEY } from '../../../i18n/HostedLanguageProvider';

/**
 * MUT-460: the operator's signup review page (design 6A–18A). The server is stubbed; the passkey sheet is the browser's,
 * so @simplewebauthn/browser is replaced.
 */
const browser = vi.hoisted(() => ({ startAuthentication: vi.fn() }));
const mode = vi.hoisted(() => ({ local: false }));
vi.mock('../../../session/mode', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../session/mode')>();
  return { ...real, useIsLocalMode: () => mode.local, useMode: () => (mode.local ? 'local' : 'remote') };
});
vi.mock('@simplewebauthn/browser', async (importOriginal) => {
  const real = await importOriginal<typeof import('@simplewebauthn/browser')>();
  return { ...real, startAuthentication: browser.startAuthentication, browserSupportsWebAuthn: () => true, browserSupportsWebAuthnAutofill: async () => false };
});

const NOW = new Date('2026-10-27T12:00:00.000Z');
const FRESH = '2026-10-27T12:08:00.000Z';
const CHALLENGE = { challengeId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', publicKey: { challenge: 'abc', rpId: 'localhost', allowCredentials: [] } };
const ASSERTION = { id: 'cred', rawId: 'cred', type: 'public-key', response: { clientDataJSON: 'e30', authenticatorData: 'e30', signature: 'e30', userHandle: 'dQ' }, clientExtensionResults: {} };

const USER_1 = '11111111-aaaa-4aaa-8aaa-111111111111';
const USER_2 = '22222222-aaaa-4aaa-8aaa-222222222222';
const review = (overrides: Partial<SignupReview>): SignupReview => ({
  id: `r-${overrides.userId ?? USER_1}`,
  userId: USER_1,
  email: 'rana@gmail.com',
  displayName: 'Rana',
  locale: 'ar',
  domain: 'gmail.com',
  classification: 'WEBMAIL',
  reasons: ['webmail'],
  createdAt: '2026-10-26T09:00:00.000Z',
  notifiedAt: null,
  decidedAt: null,
  decision: null,
  ...overrides,
});
const OLD = review({});
const NEW = review({ userId: USER_2, email: 'sami@newco.example', domain: 'newco.example', classification: 'BUSINESS_UNVERIFIED', reasons: ['no-mx', 'rdap-age-12d', 'mystery-check'], createdAt: '2026-10-27T09:00:00.000Z' });

const operator = (locale: 'en' | 'ar' = 'en'): Me => {
  const account = me([profile()], locale);
  return { ...account, user: { ...account.user, operator: true } };
};

function portal({ account = operator(), reviews = [OLD, NEW], stepUpUntil = FRESH as string | null, extra = {} as Record<string, Handler>, path = '/operator/signups' } = {}) {
  let waiting = [...reviews];
  const decide = (verb: string) => (request: { url: URL }) => {
    const userId = request.url.pathname.split('/')[4];
    const decided = waiting.find((r) => r.userId === userId)!;
    waiting = waiting.filter((r) => r.userId !== userId);
    return ok({ review: { ...decided, decision: verb === 'approve' ? 'APPROVED' : 'DECLINED' }, mail: 'sent' });
  };
  const api = stubApi({
    'GET /v1/me': () => ok(account),
    'GET /v1/operator/signup-reviews': () => ok({ data: waiting, nextCursor: null, stepUpUntil }),
    [`POST /v1/operator/signup-reviews/${USER_1}/approve`]: decide('approve'),
    [`POST /v1/operator/signup-reviews/${USER_2}/approve`]: decide('approve'),
    [`POST /v1/operator/signup-reviews/${USER_1}/decline`]: decide('decline'),
    'POST /v1/operator/step-up/options': () => ok(CHALLENGE),
    'POST /v1/operator/step-up': () => ok({ stepUpUntil: FRESH }),
    ...extra,
  });
  return { ...renderPortal(path), api };
}

const row = (email: string) => screen.getByRole('listitem', { name: email });

async function openApprove(user: ReturnType<typeof portal>['user']) {
  await user.click(await within(await screen.findByRole('listitem', { name: 'rana@gmail.com' })).findByRole('button', { name: 'Approve' }));
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  localStorage.clear();
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
  vi.stubGlobal('__PASSKEY_RP_ID__', 'localhost');
  browser.startAuthentication.mockReset().mockResolvedValue(ASSERTION);
  mode.local = false;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('who sees the console (AC5)', () => {
  it('a non-operator gets the not-found answer (Home), and the list is never asked for', async () => {
    const { router, api } = portal({ account: me([profile()]) });
    await waitFor(() => expect(locationOf(router)).toMatch(/^\/p\/[0-9a-f-]{36}/));
    expect(api.count('GET /v1/operator/signup-reviews')).toBe(0);
  });

  it('signed out on this device (the digest link): sign in first, then come back to the signups', async () => {
    mode.local = true;
    const { router, api } = portal();
    await waitFor(() => expect(locationOf(router)).toBe('/sign-in?next=%2Foperator%2Fsignups'));
    expect(api.count('GET /v1/operator/signup-reviews')).toBe(0);
  });

  it('You › Account links to the console for an operator only', async () => {
    const { user, router } = portal({ path: '/you' });
    await openYou(user, 'account');
    await user.click(screen.getByRole('link', { name: /Operator/ }));
    await waitFor(() => expect(locationOf(router)).toBe('/operator/signups'));
  });

  it('You › Account has no Operator row for anyone else', async () => {
    const { user } = portal({ account: me([profile()]), path: '/you' });
    await openYou(user, 'account');
    expect(screen.queryByRole('link', { name: /Operator/ })).toBeNull();
  });

  it('/operator opens the Signups tab', async () => {
    const { router } = portal({ path: '/operator' });
    await waitFor(() => expect(locationOf(router)).toBe('/operator/signups'));
  });
});

describe('the list (AC3, design 7A, 13A, 18A)', () => {
  it('shows each waiting signup oldest first, with its wait, domain and what the screen noticed', async () => {
    portal();
    expect(await screen.findByRole('heading', { level: 1, name: 'Operator' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Signups · 2' })).toHaveAttribute('aria-current', 'page');
    const rows = within(screen.getByRole('list', { name: 'Signups waiting for review' })).getAllByRole('listitem');
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual(['rana@gmail.com', 'sami@newco.example']);

    const old = row('rana@gmail.com');
    expect(within(old).getByText('rana@gmail.com')).toHaveAttribute('dir', 'ltr');
    expect(old).toHaveTextContent('Signed up 1 day ago');
    expect(within(old).getByText('Webmail')).toHaveClass('badge-neutral');
    expect(within(old).getByText('Waiting 1 day+')).toHaveClass('badge-warning');

    const fresh = row('sami@newco.example');
    expect(fresh).toHaveTextContent('Signed up 3 hours ago');
    expect(within(fresh).getByText('No mail server')).toHaveClass('badge-warning');
    expect(within(fresh).getByText('Domain 12 days old')).toHaveClass('badge-warning');
    expect(within(fresh).getByText('mystery-check')).toHaveAttribute('dir', 'ltr');
    expect(within(fresh).queryByText('Waiting 1 day+')).toBeNull();
  });

  it('a domain registered today says so, not "0 days old"', async () => {
    portal({ reviews: [review({ classification: 'BUSINESS_UNVERIFIED', reasons: ['rdap-age-0d'] })] });
    expect(await screen.findByText('Domain registered today')).toHaveClass('badge-warning');
  });

  it('says so when no one is waiting', async () => {
    portal({ reviews: [] });
    expect(await screen.findByRole('heading', { name: 'No one is waiting' })).toBeInTheDocument();
    expect(screen.getByText('The digest emails you when someone signs up.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Signups' })).toBeInTheDocument();
  });

  it('shows a loading skeleton, never a number, while the list loads', async () => {
    portal({ extra: { 'GET /v1/operator/signup-reviews': never } });
    expect(await screen.findByLabelText('Loading')).toHaveAttribute('aria-busy', 'true');
  });

  it('reads Arabic by default, right to left, with Western digits', async () => {
    localStorage.clear();
    portal({ account: operator('ar') });
    expect(await screen.findByRole('heading', { level: 1, name: 'المشغّل' })).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(await screen.findByRole('listitem', { name: 'sami@newco.example' })).toHaveTextContent(/3/);
    expect(screen.getByRole('link', { name: 'التسجيلات · 2' })).toBeInTheDocument();
  });
});

describe('approving and declining (AC1, AC2, AC3, design 8A, 11A)', () => {
  it('Approve confirms in the row and says what will be mailed; Cancel and Escape put it back', async () => {
    const { user, api } = portal();
    await user.click(await within(await screen.findByRole('listitem', { name: 'rana@gmail.com' })).findByRole('button', { name: 'Approve' }));
    expect(screen.getByText("rana@gmail.com can sign in. We'll email them now.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(within(row('rana@gmail.com')).getByRole('button', { name: 'Approve' })).toHaveFocus());
    expect(api.count(`POST /v1/operator/signup-reviews/${USER_1}/approve`)).toBe(0);
  });

  it('a fresh step-up approves at once: the row leaves, a toast says the mail went, focus moves on', async () => {
    const { user, api } = portal();
    await user.click(await within(await screen.findByRole('listitem', { name: 'rana@gmail.com' })).findByRole('button', { name: 'Approve' }));
    await user.click(within(row('rana@gmail.com')).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('rana@gmail.com approved · email sent')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('listitem', { name: 'rana@gmail.com' })).toBeNull());
    await waitFor(() => expect(row('sami@newco.example')).toHaveFocus());
    expect(api.count('POST /v1/operator/step-up/options')).toBe(0);
    expect(browser.startAuthentication).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('link', { name: 'Signups · 1' })).toBeInTheDocument());
  });

  it('Decline confirms as danger, deletes and mails, and the last decision leaves the empty state', async () => {
    const { user, api } = portal({ reviews: [OLD] });
    await user.click(await within(await screen.findByRole('listitem', { name: 'rana@gmail.com' })).findByRole('button', { name: 'Decline' }));
    expect(screen.getByText("rana@gmail.com's account will be deleted. We'll email them; they can sign up again.")).toBeInTheDocument();
    const confirm = within(row('rana@gmail.com')).getByRole('button', { name: 'Decline' });
    expect(confirm).toHaveClass('btn-danger');
    await user.click(confirm);
    expect(await screen.findByText('rana@gmail.com declined · email sent')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'No one is waiting' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Operator' })).toHaveFocus());
    expect(api.count(`POST /v1/operator/signup-reviews/${USER_1}/decline`)).toBe(1);
  });

  it('someone else decided first: the row says so and the list is read again', async () => {
    const { user, api } = portal({ extra: { [`POST /v1/operator/signup-reviews/${USER_1}/approve`]: () => fail(409, 'CONFLICT', { reason: 'ALREADY_DECIDED' }) } });
    await user.click(await within(await screen.findByRole('listitem', { name: 'rana@gmail.com' })).findByRole('button', { name: 'Approve' }));
    await user.click(within(row('rana@gmail.com')).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Already decided')).toBeInTheDocument();
    await waitFor(() => expect(api.count('GET /v1/operator/signup-reviews')).toBeGreaterThan(1));
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByText('Already decided')).toBeNull();
  });

  it('a 404 on a decision re-reads /v1/me (a revoked operator leaves) and says the signup is gone', async () => {
    const { user, api } = portal({ extra: { [`POST /v1/operator/signup-reviews/${USER_1}/approve`]: () => fail(404, 'NOT_FOUND') } });
    await openApprove(user);
    const before = api.count('GET /v1/me');
    await user.click(within(row('rana@gmail.com')).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Already decided')).toBeInTheDocument();
    await waitFor(() => expect(api.count('GET /v1/me')).toBeGreaterThan(before));
  });

  it('Cancel waits while a decision is in flight', async () => {
    const { user } = portal({ extra: { [`POST /v1/operator/signup-reviews/${USER_1}/approve`]: never } });
    await openApprove(user);
    await user.click(within(row('rana@gmail.com')).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(within(row('rana@gmail.com')).getByRole('button', { name: 'Cancel' })).toBeDisabled());
    await user.keyboard('{Escape}');
    expect(screen.getByText("rana@gmail.com can sign in. We'll email them now.")).toBeInTheDocument();
  });

  it('an account that has records now can’t be declined, and says so in the row', async () => {
    const { user } = portal({ extra: { [`POST /v1/operator/signup-reviews/${USER_1}/decline`]: () => fail(409, 'CONFLICT', { reason: 'NOT_EMPTY' }) } });
    await user.click(await within(await screen.findByRole('listitem', { name: 'rana@gmail.com' })).findByRole('button', { name: 'Decline' }));
    await user.click(within(row('rana@gmail.com')).getByRole('button', { name: 'Decline' }));
    expect(await screen.findByText("This account has records now, so it can't be declined.")).toBeInTheDocument();
  });
});

describe('the mail didn’t send (AC3, design 9A)', () => {
  it('an approval stays as a warning with the address and Send again, which mails once more', async () => {
    let resent = 0;
    const { user } = portal({
      extra: {
        [`POST /v1/operator/signup-reviews/${USER_1}/approve`]: () => ok({ review: { ...OLD, decision: 'APPROVED' }, mail: 'failed' }),
        [`POST /v1/operator/signup-reviews/${USER_1}/resend`]: () => {
          resent += 1;
          return ok({ review: { ...OLD, decision: 'APPROVED' }, mail: 'sent' });
        },
      },
    });
    await user.click(await within(await screen.findByRole('listitem', { name: 'rana@gmail.com' })).findByRole('button', { name: 'Approve' }));
    await user.click(within(row('rana@gmail.com')).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText("Approved. The email didn't send.")).toBeInTheDocument();
    expect(screen.getByLabelText('Their email address')).toHaveValue('rana@gmail.com');
    await user.click(screen.getByRole('button', { name: 'Send again' }));
    expect(await screen.findByText('Email sent to rana@gmail.com')).toBeInTheDocument();
    expect(resent).toBe(1);
    await waitFor(() => expect(screen.queryByText("Approved. The email didn't send.")).toBeNull());
  });

  it('a server that sends no mail: the address to copy and no Send again, which could never go', async () => {
    const { user } = portal({ extra: { [`POST /v1/operator/signup-reviews/${USER_1}/approve`]: () => ok({ review: { ...OLD, decision: 'APPROVED' }, mail: 'disabled' }) } });
    await openApprove(user);
    await user.click(within(row('rana@gmail.com')).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText("Approved. The email didn't send.")).toBeInTheDocument();
    expect(screen.getByText('Write to them yourself from your own email.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send again' })).toBeNull();
  });

  it('a decline keeps the address to copy, with no Send again: the account is gone', async () => {
    const { user } = portal({ extra: { [`POST /v1/operator/signup-reviews/${USER_1}/decline`]: () => ok({ review: { ...OLD, userId: null, decision: 'DECLINED' }, mail: 'capped' }) } });
    await user.click(await within(await screen.findByRole('listitem', { name: 'rana@gmail.com' })).findByRole('button', { name: 'Decline' }));
    await user.click(within(row('rana@gmail.com')).getByRole('button', { name: 'Decline' }));
    expect(await screen.findByText("Declined. The email didn't send.")).toBeInTheDocument();
    expect(screen.getByLabelText('Their email address')).toHaveValue('rana@gmail.com');
    expect(screen.queryByRole('button', { name: 'Send again' })).toBeNull();
  });
});

describe('the passkey step-up (design 1A, 10A)', () => {

  it('stale: the confirm reads “Approve with passkey”, and one tap steps up and then approves', async () => {
    const { user, api } = portal({ stepUpUntil: null });
    await openApprove(user);
    await user.click(within(row('rana@gmail.com')).getByRole('button', { name: 'Approve with passkey' }));
    expect(await screen.findByText('rana@gmail.com approved · email sent')).toBeInTheDocument();
    const order = api.calls.map((c) => `${c.method} ${c.url.pathname}`).filter((k) => k.startsWith('POST'));
    expect(order).toEqual(['POST /v1/operator/step-up/options', 'POST /v1/operator/step-up', `POST /v1/operator/signup-reviews/${USER_1}/approve`]);
    expect(api.count('POST /v1/operator/step-up')).toBe(1);
  });

  it('after a step-up, the next decision acts directly, with no second prompt', async () => {
    const { user, api } = portal({ stepUpUntil: null });
    await openApprove(user);
    await user.click(within(row('rana@gmail.com')).getByRole('button', { name: 'Approve with passkey' }));
    await screen.findByText('rana@gmail.com approved · email sent');
    await user.click(within(await screen.findByRole('listitem', { name: 'sami@newco.example' })).getByRole('button', { name: 'Approve' }));
    await user.click(within(row('sami@newco.example')).getByRole('button', { name: 'Approve', exact: true }));
    expect(await screen.findByText('sami@newco.example approved · email sent')).toBeInTheDocument();
    expect(api.count(`POST /v1/operator/signup-reviews/${USER_2}/approve`)).toBe(1);
    expect(api.count('POST /v1/operator/step-up/options')).toBe(1);
    expect(browser.startAuthentication).toHaveBeenCalledTimes(1);
  });

  it('after a 403, every row asks for the passkey; Cancel drops the "Confirm with passkey" fallback', async () => {
    const { user } = portal({ extra: { [`POST /v1/operator/signup-reviews/${USER_1}/approve`]: () => fail(403, 'RECENT_SIGN_IN_REQUIRED', { method: 'passkey', windowMinutes: 10 }) } });
    await openApprove(user);
    await user.click(within(row('rana@gmail.com')).getByRole('button', { name: 'Approve' }));
    await within(row('rana@gmail.com')).findByRole('button', { name: 'Confirm with passkey' });
    await user.click(within(row('rana@gmail.com')).getByRole('button', { name: 'Cancel' }));
    await user.click(within(row('rana@gmail.com')).getByRole('button', { name: 'Approve' }));
    expect(within(row('rana@gmail.com')).getByRole('button', { name: 'Approve with passkey' })).toBeInTheDocument();
    await user.click(within(row('sami@newco.example')).getByRole('button', { name: 'Decline' }));
    expect(within(row('sami@newco.example')).getByRole('button', { name: 'Decline with passkey' })).toBeInTheDocument();
  });

  it('cancelling the passkey sheet goes back to the confirm with no message', async () => {
    browser.startAuthentication.mockRejectedValue(Object.assign(new Error('cancelled'), { name: 'NotAllowedError' }));
    const { user, api } = portal({ stepUpUntil: null });
    await openApprove(user);
    await user.click(within(row('rana@gmail.com')).getByRole('button', { name: 'Approve with passkey' }));
    await waitFor(() => expect(browser.startAuthentication).toHaveBeenCalled());
    expect(within(row('rana@gmail.com')).getByRole('button', { name: 'Approve with passkey' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(api.count(`POST /v1/operator/signup-reviews/${USER_1}/approve`)).toBe(0);
  });

  it('a refused passkey says so in the row', async () => {
    const { user } = portal({ stepUpUntil: null, extra: { 'POST /v1/operator/step-up': () => fail(403, 'PASSKEY_NOT_ACCEPTED') } });
    await openApprove(user);
    await user.click(within(row('rana@gmail.com')).getByRole('button', { name: 'Approve with passkey' }));
    expect(await within(row('rana@gmail.com')).findByRole('alert')).toHaveTextContent("Your passkey wasn't accepted. Try again.");
  });

  it('no passkey on the account: says operator actions need one, and links to Passkeys', async () => {
    const { user } = portal({ stepUpUntil: null, extra: { 'POST /v1/operator/step-up/options': () => fail(409, 'CONFLICT', { reason: 'OPERATOR_NEEDS_PASSKEY' }) } });
    await openApprove(user);
    await user.click(within(row('rana@gmail.com')).getByRole('button', { name: 'Approve with passkey' }));
    const alert = await within(row('rana@gmail.com')).findByRole('alert');
    expect(alert).toHaveTextContent('Operator actions need a passkey.');
    expect(within(alert).getByRole('link', { name: 'Add one in Account › Passkeys' })).toHaveAttribute('href', '/you/account?passkeys=true');
  });

  it('a 403 on a direct approve never starts the sheet: it offers “Confirm with passkey”', async () => {
    let first = true;
    const { user } = portal({
      extra: {
        [`POST /v1/operator/signup-reviews/${USER_1}/approve`]: () => {
          if (first) {
            first = false;
            return fail(403, 'RECENT_SIGN_IN_REQUIRED', { method: 'passkey', windowMinutes: 10 });
          }
          return ok({ review: { ...OLD, decision: 'APPROVED' }, mail: 'sent' });
        },
      },
    });
    await openApprove(user);
    await user.click(within(row('rana@gmail.com')).getByRole('button', { name: 'Approve' }));
    const fallback = await within(row('rana@gmail.com')).findByRole('button', { name: 'Confirm with passkey' });
    expect(browser.startAuthentication).not.toHaveBeenCalled();
    await user.click(fallback);
    expect(await screen.findByText('rana@gmail.com approved · email sent')).toBeInTheDocument();
    expect(browser.startAuthentication).toHaveBeenCalledTimes(1);
  });
});
