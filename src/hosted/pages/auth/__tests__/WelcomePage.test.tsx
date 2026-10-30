import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { fail, renderPortal, stubApi } from '../../../__tests__/harness';
import { PORTAL_LANGUAGE_KEY } from '../../../i18n/HostedLanguageProvider';
import { MODE_KEY, setUnhintedMode } from '../../../session/mode';

/**
 * The welcome (MUT-513) where this browser can't open its records: the local chunk fails to boot. Its own file, so the
 * boot isn't already cached by a test that opened the app (local-mode.test.tsx covers the doors themselves).
 */

vi.mock('@mut/local-backend', () => ({ bootLocalBackend: () => Promise.reject(new Error('IndexedDB blocked')) }));

const { countWelcomeChoice } = vi.hoisted(() => ({ countWelcomeChoice: vi.fn() }));
vi.mock('../../../analytics/portalAnalytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../analytics/portalAnalytics')>()),
  countWelcomeChoice,
}));

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
  setUnhintedMode('probe');
  countWelcomeChoice.mockClear();
});

describe('the welcome on a browser that blocks storage', () => {
  it("Try saves nothing and says this browser won't let MTB3A save here", async () => {
    stubApi({ 'GET /v1/me': () => fail(401, 'UNAUTHENTICATED') });
    const { user } = renderPortal('/');

    await user.click(await screen.findByRole('button', { name: 'Try it on this device' }));

    expect(await screen.findByRole('heading', { name: "This browser won't let MTB3A save here" })).toBeInTheDocument();
    expect(localStorage.getItem(MODE_KEY)).toBeNull();
  });
});

// MUT-513 (D3): each door is counted once, as it is chosen; the count never holds the door up.
describe('counting the doors', () => {
  it.each([
    ['Sign in', 'link', 'sign_in'],
    ['Create an account', 'link', 'signup'],
    ['Try it on this device', 'button', 'local'],
  ] as const)('%s counts %s as %s', async (name, role, choice) => {
    stubApi({ 'GET /v1/me': () => fail(401, 'UNAUTHENTICATED') });
    const { user } = renderPortal('/');

    await user.click(await screen.findByRole(role, { name }));

    expect(countWelcomeChoice).toHaveBeenCalledTimes(1);
    expect(countWelcomeChoice).toHaveBeenCalledWith(choice);
  });
});
