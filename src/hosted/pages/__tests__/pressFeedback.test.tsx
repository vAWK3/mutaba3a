import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { ORG_A, emptyProfileRoutes, fail, me, ok, profile, renderPortal, stubApi, openYou } from '../../__tests__/harness';
import { PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';
import { CUSTOMERS, PROJECTS, page, payment } from './fixtures';

/**
 * Press feedback (L10, MUT-91): the shared rule in index.css presses `.btn`
 * and `.press`. Every control the portal renders as a <button> must carry one
 * of them, or it is the one button that doesn't respond to a tap.
 */

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
});
afterEach(() => vi.unstubAllGlobals());

/** Tabs (the shared SegmentControl) select a view rather than act, and don't press, like an iOS segmented control. */
function unpressable(): string[] {
  return Array.from(document.querySelectorAll('button:not([role="tab"])'))
    .filter((button) => !button.classList.contains('btn') && !button.classList.contains('press'))
    .map((button) => button.outerHTML.slice(0, 120));
}

describe('every portal button presses (L10)', () => {
  it('in the signed-in shell, the You page and a payments row', async () => {
    stubApi({
      'GET /v1/me': () => ok(me([profile(), profile({ id: '33333333-3333-4333-8333-333333333333', name: 'Second firm' })])),
      ...emptyProfileRoutes(),
      'GET /v1/customers': () => ok(page(CUSTOMERS)),
      'GET /v1/projects': () => ok(page(PROJECTS)),
      'GET /v1/payments': () => ok(page([payment('e1111111-1111-4111-8111-111111111111', 'PAY-0007')])),
    });
    const { user } = renderPortal(`/p/${ORG_A}/payments`);
    await screen.findByRole('button', { name: 'Show where this payment went' });

    expect(unpressable()).toEqual([]);

    // MUT-425: the account menu and the profile switcher became the You page; MUT-426's island opens it
    await openYou(user, 'account');
    expect(await screen.findByRole('button', { name: /^Sign out/ })).toBeInTheDocument();
    expect(unpressable()).toEqual([]);

    await user.click(screen.getByRole('link', { name: 'Profiles' }));
    expect(await screen.findByRole('button', { name: /Second firm/ })).toBeInTheDocument();
    expect(unpressable()).toEqual([]);
  });

  it('on the sign-in page, including the show-password toggle', async () => {
    stubApi({ 'GET /v1/me': () => fail(401, 'UNAUTHENTICATED') });
    renderPortal('/sign-in');
    await screen.findByRole('button', { name: /show/i });
    expect(screen.getAllByRole('button').length).toBeGreaterThan(1);
    expect(unpressable()).toEqual([]);
  });
});
