import { describe, it, expect, vi, beforeEach } from 'vitest';
import { countWelcomeChoice, resetPortalUsageForTests } from '../portalAnalytics';

/**
 * The welcome's door count (MUT-513, ADR-230): sent before anyone signs in, so never through the consented instance.
 * posthog-js is faked: `init` with a name returns that named instance, as the SDK does.
 */

const { build, sdk, welcome } = vi.hoisted(() => {
  const welcome = { capture: vi.fn() };
  const sdk = {
    init: vi.fn((_key: string, _options: Record<string, unknown>, name?: string) => (name === 'welcome' ? welcome : undefined)),
    capture: vi.fn(),
    opt_in_capturing: vi.fn(),
    opt_out_capturing: vi.fn(),
    has_opted_out_capturing: vi.fn(() => true),
    reset: vi.fn(),
  };
  return { build: { key: 'phc_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789' }, sdk, welcome };
});
vi.mock('../../../lib/analytics/posthogKey', () => ({
  get POSTHOG_KEY() {
    return build.key;
  },
}));
vi.mock('posthog-js', () => ({ default: sdk }));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  resetPortalUsageForTests();
  localStorage.clear();
  for (const fn of [sdk.init, sdk.capture, sdk.opt_in_capturing, sdk.opt_out_capturing, welcome.capture]) fn.mockClear();
  build.key = 'phc_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
});

describe('countWelcomeChoice', () => {
  it('sends the door once, through its own cookieless instance named welcome', async () => {
    countWelcomeChoice('local');
    await vi.waitFor(() => expect(welcome.capture).toHaveBeenCalledWith('portal_welcome_choice', { choice: 'local' }));

    expect(sdk.init).toHaveBeenCalledTimes(1);
    const [key, options, name] = sdk.init.mock.calls[0]!;
    expect(key).toBe(build.key);
    expect(name).toBe('welcome');
    expect(options).toMatchObject({ cookieless_mode: 'always', capture_pageview: false });
  });

  it('never touches the consented instance: no opt-in, nothing captured on it', async () => {
    countWelcomeChoice('sign_in');
    await vi.waitFor(() => expect(welcome.capture).toHaveBeenCalled());

    expect(sdk.capture).not.toHaveBeenCalled();
    expect(sdk.opt_in_capturing).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  });

  it('a second door on the same page reuses the instance', async () => {
    countWelcomeChoice('sign_in');
    countWelcomeChoice('signup');
    await vi.waitFor(() => expect(welcome.capture).toHaveBeenCalledTimes(2));

    expect(sdk.init).toHaveBeenCalledTimes(1);
  });

  it('a build with no key loads and sends nothing', async () => {
    build.key = '';
    countWelcomeChoice('local');
    await flush();

    expect(sdk.init).not.toHaveBeenCalled();
    expect(welcome.capture).not.toHaveBeenCalled();
  });

  it('never throws to the door, even when the SDK does', async () => {
    welcome.capture.mockImplementationOnce(() => {
      throw new Error('blocked');
    });

    expect(() => countWelcomeChoice('local')).not.toThrow();
    await flush();
  });
});
