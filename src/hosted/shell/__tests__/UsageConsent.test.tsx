import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { ORG_A, emptyProfileRoutes, me, ok, renderPortal, stubApi } from '../../__tests__/harness';
import { USAGE_RECORD_KEY, resetPortalUsageForTests } from '../../analytics/portalAnalytics';
import { PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';

/**
 * MUT-155 through the real shell: the one-time prompt, the account-menu
 * toggle, and sign-out forgetting the choice. PostHog itself is a spy.
 */

const { build, sdk, consent } = vi.hoisted(() => {
  // Like the real SDK with opt_out_capturing_by_default: opted out until opted in
  const consent = { out: true };
  return {
    build: { key: 'phc_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789' },
    consent,
    sdk: {
      init: vi.fn(),
      capture: vi.fn(),
      opt_out_capturing: vi.fn(() => {
        consent.out = true;
      }),
      opt_in_capturing: vi.fn(() => {
        consent.out = false;
      }),
      has_opted_out_capturing: vi.fn(() => consent.out),
      reset: vi.fn(),
    },
  };
});
vi.mock('../../../lib/analytics/posthogKey', () => ({
  get POSTHOG_KEY() {
    return build.key;
  },
}));
vi.mock('posthog-js', () => ({ default: sdk }));

const USER_ID = me().user.id;
const captured = () => sdk.capture.mock.calls.map(([event]) => event);
const region = () => screen.queryByRole('region', { name: 'Share anonymous usage?' });

async function openMenu(user: ReturnType<typeof renderPortal>['user']) {
  await user.click(await screen.findByRole('button', { name: /Account/ }));
  return screen.getByRole('menu', { name: 'Account' });
}

beforeEach(() => {
  resetPortalUsageForTests();
  localStorage.clear();
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
  Object.values(sdk).forEach((fn) => fn.mockClear());
  consent.out = true;
  build.key = 'phc_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
  stubApi({ ...emptyProfileRoutes(), 'GET /v1/me': () => ok(me()), 'DELETE /v1/sessions/current': () => new Response(null, { status: 204 }) });
});

describe('Usage prompt (MUT-155)', () => {
  it('asks once with two equal buttons, and loads nothing before an answer', async () => {
    renderPortal(`/p/${ORG_A}`);
    const prompt = await screen.findByRole('region', { name: 'Share anonymous usage?' });
    const turnOn = within(prompt).getByRole('button', { name: 'Share anonymous usage' });
    const decline = within(prompt).getByRole('button', { name: 'Not now' });
    expect(turnOn.className).toBe(decline.className);
    expect(sdk.init).not.toHaveBeenCalled();
  });

  it('turning it on starts counting from the prompt and hides it', async () => {
    const { user } = renderPortal(`/p/${ORG_A}`);
    await user.click(within((await screen.findByRole('region', { name: 'Share anonymous usage?' }))).getByRole('button', { name: 'Share anonymous usage' }));
    await waitFor(() => expect(sdk.capture).toHaveBeenCalledWith('analytics_opted_in', { prompt: 'first_run' }));
    expect(region()).toBeNull();
    expect(JSON.parse(localStorage.getItem(USAGE_RECORD_KEY)!)).toEqual({ owner: USER_ID, choice: 'on' });
  });

  it('"Not now" keeps everything off and is not asked again', async () => {
    const { user, unmount } = renderPortal(`/p/${ORG_A}`);
    await user.click(within((await screen.findByRole('region', { name: 'Share anonymous usage?' }))).getByRole('button', { name: 'Not now' }));
    expect(region()).toBeNull();
    unmount();
    renderPortal(`/p/${ORG_A}`);
    await screen.findByRole('button', { name: /Account/ });
    expect(region()).toBeNull();
    expect(sdk.init).not.toHaveBeenCalled();
  });

  it('shows nothing at all when the build has no key', async () => {
    build.key = '';
    const { user } = renderPortal(`/p/${ORG_A}`);
    const menu = await openMenu(user);
    expect(region()).toBeNull();
    expect(within(menu).queryByRole('menuitemcheckbox', { name: 'Share anonymous usage' })).toBeNull();
  });

  it('reads in Arabic for an Arabic reader', async () => {
    localStorage.setItem(PORTAL_LANGUAGE_KEY, 'ar');
    renderPortal(`/p/${ORG_A}`);
    const prompt = await screen.findByRole('region', { name: 'مشاركة بيانات استخدام مجهولة؟' });
    expect(within(prompt).getByRole('button', { name: 'ليس الآن' })).toBeInTheDocument();
  });
});

describe('Account menu toggle (MUT-155)', () => {
  it('reflects the choice and turns it off with one last note', async () => {
    localStorage.setItem(USAGE_RECORD_KEY, JSON.stringify({ owner: USER_ID, choice: 'on' }));
    const { user } = renderPortal(`/p/${ORG_A}`);
    await waitFor(() => expect(captured()).toContain('portal_opened'));
    const toggle = within(await openMenu(user)).getByRole('menuitemcheckbox', { name: 'Share anonymous usage' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await user.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'));
    expect(captured()).toEqual(['portal_opened', 'analytics_opted_out']);
    expect(sdk.opt_out_capturing).toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(USAGE_RECORD_KEY)!)).toEqual({ owner: USER_ID, choice: 'off' });
  });

  it('turns it on from the menu, saying so', async () => {
    localStorage.setItem(USAGE_RECORD_KEY, JSON.stringify({ owner: USER_ID, choice: 'off' }));
    const { user } = renderPortal(`/p/${ORG_A}`);
    const toggle = within(await openMenu(user)).getByRole('menuitemcheckbox', { name: 'Share anonymous usage' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await user.click(toggle);
    await waitFor(() => expect(sdk.capture).toHaveBeenCalledWith('analytics_opted_in', { prompt: 'settings' }));
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });
});

describe('Sign-out (MUT-155, README rule 6)', () => {
  it('forgets the choice and the ID, sending nothing', async () => {
    localStorage.setItem(USAGE_RECORD_KEY, JSON.stringify({ owner: USER_ID, choice: 'on' }));
    localStorage.setItem('ph_phc_test_posthog', '{"distinct_id":"x"}');
    const { user } = renderPortal(`/p/${ORG_A}`);
    await waitFor(() => expect(captured()).toEqual(['portal_opened']));
    await user.click(within(await openMenu(user)).getByRole('menuitem', { name: 'Sign out' }));
    await waitFor(() => expect(localStorage.getItem(USAGE_RECORD_KEY)).toBeNull());
    expect(localStorage.getItem('ph_phc_test_posthog')).toBeNull();
    expect(captured()).toEqual(['portal_opened']);
    expect(sdk.reset).toHaveBeenCalledWith(true);
  });
});
