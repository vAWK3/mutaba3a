import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { fail, locationOf, renderPortal, stubApi } from '../../../__tests__/harness';
import { PORTAL_LANGUAGE_KEY } from '../../../i18n/HostedLanguageProvider';
import { MODE_KEY, setMode, setUnhintedMode } from '../../../session/mode';

/**
 * The welcome (MUT-513) where this browser can't open its records: the local chunk fails to boot. Its own file, so the
 * boot isn't already cached by a test that opened the app (local-mode.test.tsx covers the doors themselves).
 */

const { boot } = vi.hoisted(() => ({ boot: vi.fn() }));
vi.mock('@mut/local-backend', () => ({ bootLocalBackend: () => boot() }));
/** A local backend that boots and answers nothing: enough to show that storage now works. */
const workingBackend = { fetch: () => Promise.resolve(new Response('{}', { status: 404 })), onRemoteWrite: () => () => {}, exportRecords: vi.fn(), readRecordsFile: vi.fn() };

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
  boot.mockReset();
  boot.mockRejectedValue(new Error('IndexedDB blocked'));
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

// Review: the can't-save screen's two ways out
describe('leaving the can\'t-save screen', () => {
  async function blocked() {
    stubApi({ 'GET /v1/me': () => fail(401, 'UNAUTHENTICATED') });
    const rendered = renderPortal('/');
    await rendered.user.click(await screen.findByRole('button', { name: 'Try it on this device' }));
    await screen.findByRole('heading', { name: "This browser won't let MTB3A save here" });
    return rendered;
  }

  it('Sign in goes to sign-in and saves nothing', async () => {
    const { user, router } = await blocked();

    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(locationOf(router)).toBe('/sign-in'));
    expect(localStorage.getItem(MODE_KEY)).toBeNull();
  });

  it('Try again once storage works chooses this device, and the door is counted once', async () => {
    const { user } = await blocked();
    boot.mockResolvedValue(workingBackend);

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(localStorage.getItem(MODE_KEY)).toBe('local'));
    expect(countWelcomeChoice).toHaveBeenCalledTimes(1);
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

// Review: the count is what new visitors choose; someone already on this device who reopens the welcome isn't counted
it('the welcome reopened on this device counts no door', async () => {
  setMode('local');
  stubApi({});
  const { user } = renderPortal('/welcome');

  await user.click(await screen.findByRole('link', { name: 'Sign in' }));

  expect(countWelcomeChoice).not.toHaveBeenCalled();
});
