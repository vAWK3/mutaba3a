import { beforeEach, describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import type { Me, SignupReview } from '../../../api/client';
import { locationOf, me, ok, profile, renderPortal, stubApi } from '../../../__tests__/harness';
import { PORTAL_LANGUAGE_KEY } from '../../../i18n/HostedLanguageProvider';

/**
 * MUT-737 (wireframe mut-737 A, AC3/AC4): with open sign-up the operator's Signups tab is gone; the sign-up history is a
 * filter of Accounts, read-only (no Approve or Decline), with the domain class and the outcome. The account page shows
 * the sign-up's domain class as a chip.
 */

const operator = (): Me => {
  const account = me([profile()], 'en');
  return { ...account, user: { ...account.user, operator: true } };
};
const review = (over: Partial<SignupReview>): SignupReview => ({
  id: 'aaaaaaaa-0000-4000-8000-000000000001',
  userId: 'bbbbbbbb-0000-4000-8000-000000000001',
  email: 'rana@gmail.com',
  displayName: 'Rana',
  locale: 'en',
  domain: 'gmail.com',
  classification: 'WEBMAIL',
  reasons: ['webmail'],
  createdAt: '2026-11-20T09:00:00.000Z',
  notifiedAt: null,
  decidedAt: '2026-11-20T10:00:00.000Z',
  decision: 'APPROVED',
  ...over,
});
const DECLINED = review({ id: 'aaaaaaaa-0000-4000-8000-000000000002', email: 'x@new-domain.ps', domain: 'new-domain.ps', classification: 'BUSINESS_UNVERIFIED', reasons: ['rdap-age-12d'], createdAt: '2026-11-22T09:00:00.000Z', decision: 'DECLINED' });

function portal(path: string, openSignup: boolean) {
  const api = stubApi({
    'GET /v1/me': () => ok(operator()),
    'GET /v1/self-service': () => ok({ signup: true, recovery: true, malafatSignIn: false, signInCode: false, starterPlan: true, openSignup }),
    'GET /v1/operator/signup-reviews': (request) =>
      ok({ data: request.url.searchParams.get('state') === 'decided' ? [review({}), DECLINED] : [], nextCursor: null, stepUpUntil: null }),
    'GET /v1/operator/accounts': () => ok({ data: [], nextCursor: null, stepUpUntil: null }),
  });
  return { ...renderPortal(path), api };
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
});

describe('open sign-up: the history is a filter of Accounts', () => {
  it('no Signups tab; Accounts › Signups lists the history newest first with the class and the outcome, and no actions', async () => {
    const { user, router } = portal('/operator/accounts', true);
    await screen.findByRole('heading', { level: 1, name: 'Operator' });
    expect(await screen.findByRole('link', { name: 'Accounts' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Signups/ })).toBeNull();
    await user.click(await screen.findByRole('radio', { name: 'Signups' }));
    expect(locationOf(router)).toBe('/operator/accounts?view=signups');
    const rows = within(await screen.findByTestId('signup-history')).getAllByTestId('signup-history-row');
    expect(rows[0]).toHaveTextContent('x@new-domain.ps');
    expect(rows[0]).toHaveTextContent('Declined');
    expect(rows[1]).toHaveTextContent('rana@gmail.com');
    expect(rows[1]).toHaveTextContent('Webmail');
    expect(rows[1]).toHaveTextContent('Approved');
    expect(screen.queryByRole('button', { name: /Approve|Decline/ })).toBeNull();
  });

  it('with the review still on, the Signups tab stays and Accounts has no filter', async () => {
    portal('/operator/accounts', false);
    expect(await screen.findByRole('link', { name: /^Signups/ })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Signups' })).toBeNull();
  });
});
