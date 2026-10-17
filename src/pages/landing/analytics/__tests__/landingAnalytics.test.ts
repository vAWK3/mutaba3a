import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  ctaForHref,
  resetLandingAnalyticsForTests,
  startLandingAnalytics,
  useLandingAnalytics,
  type PostHogLike,
} from '../landingAnalytics';

/** The build's key (one module per build-time constant, PATTERNS) and the SDK, both under test control. */
const { build, sdk } = vi.hoisted(() => ({ build: { key: '' }, sdk: { init: vi.fn(), capture: vi.fn() } }));
vi.mock('../../../../lib/analytics/posthogKey', () => ({
  get POSTHOG_KEY() {
    return build.key;
  },
}));
vi.mock('posthog-js', () => ({ default: sdk }));

const ORIGIN = 'https://mutaba3a.netlify.app';
const KEY = 'phc_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';

function fakePostHog(): PostHogLike & { init: ReturnType<typeof vi.fn>; capture: ReturnType<typeof vi.fn> } {
  return { init: vi.fn(), capture: vi.fn() };
}

describe('ctaForHref', () => {
  it.each([
    ['/app/clients?sample=1', 'open_web_app'],
    ['/app', 'open_web_app'],
    [`${ORIGIN}/app/settings`, 'open_web_app'],
    ['/hosted', 'hosted_offer'],
    ['/hosted/', 'hosted_offer'],
    ['https://apps.apple.com/us/app/x/id6821813829?ct=mutaba3a-landing', 'app_store'],
    ['https://play.google.com/store/apps/details?id=x', 'play_store'],
    ['https://malafat.app/ar?utm_source=mutaba3a', 'malafat'],
  ])('maps %s to %s', (href, cta) => {
    expect(ctaForHref(href, ORIGIN)).toBe(cta);
  });

  it.each(['/download/mac', '/download/windows', '#get-it', '/privacy', 'https://mutaba3a-api.example.run.app/sign-in', 'https://github.com/x', 'mailto:info@malafat.app', '/apple', '/hostedx', 'https://evil.example/app'])(
    'counts nothing for %s',
    (href) => {
      expect(ctaForHref(href, ORIGIN)).toBeNull();
    },
  );
});

describe('startLandingAnalytics', () => {
  beforeEach(() => {
    resetLandingAnalyticsForTests();
    document.body.innerHTML = '';
    document.documentElement.lang = 'ar';
  });
  afterEach(() => resetLandingAnalyticsForTests());

  it('does nothing without a key: no SDK load, no listener', async () => {
    const load = vi.fn();
    await expect(startLandingAnalytics({ key: '', load })).resolves.toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it('loads and inits the SDK once, cookieless and with every feature off', async () => {
    const ph = fakePostHog();
    const load = vi.fn().mockResolvedValue(ph);
    await startLandingAnalytics({ key: KEY, load });
    await startLandingAnalytics({ key: KEY, load });
    expect(load).toHaveBeenCalledTimes(1);
    expect(ph.init).toHaveBeenCalledTimes(1);
    const [key, options] = ph.init.mock.calls[0];
    expect(key).toBe(KEY);
    expect(options).toMatchObject({ cookieless_mode: 'always', autocapture: false, person_profiles: 'never', api_host: 'https://eu.i.posthog.com' });
  });

  it('stamps the visible language on each event', async () => {
    const ph = fakePostHog();
    await startLandingAnalytics({ key: KEY, load: vi.fn().mockResolvedValue(ph) });
    const beforeSend = ph.init.mock.calls[0][1].before_send as (cr: unknown) => { properties: Record<string, unknown> };
    document.documentElement.lang = 'en';
    expect(beforeSend({ uuid: 'u', event: '$pageview', properties: {} }).properties).toMatchObject({ surface: 'landing', locale: 'en' });
  });

  it('sends landing_cta_clicked, at once, when a counted link is clicked', async () => {
    const ph = fakePostHog();
    await startLandingAnalytics({ key: KEY, load: vi.fn().mockResolvedValue(ph) });
    document.body.innerHTML = '<a href="/hosted"><span id="inner">See hosted accounts</span></a><a href="/download/mac" id="mac">Mac</a>';
    document.getElementById('inner')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    document.getElementById('mac')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(ph.capture).toHaveBeenCalledTimes(1);
    expect(ph.capture).toHaveBeenCalledWith('landing_cta_clicked', { cta: 'hosted_offer' }, { send_instantly: true });
  });

  it('never throws into the page when the SDK fails to load', async () => {
    await expect(startLandingAnalytics({ key: KEY, load: vi.fn().mockRejectedValue(new Error('blocked')) })).resolves.toBeNull();
  });
});

describe('useLandingAnalytics', () => {
  beforeEach(() => {
    resetLandingAnalyticsForTests();
    build.key = '';
    sdk.init.mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    resetLandingAnalyticsForTests();
  });

  it('does not touch the SDK without a key', async () => {
    vi.useFakeTimers();
    const { unmount } = renderHook(() => useLandingAnalytics());
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sdk.init).not.toHaveBeenCalled();
    unmount();
  });

  it('waits for the page to finish loading (fonts, hero) before even scheduling, so LCP is untouched', async () => {
    build.key = KEY;
    vi.useFakeTimers();
    vi.stubGlobal('requestIdleCallback', undefined);
    const readyState = vi.spyOn(document, 'readyState', 'get').mockReturnValue('interactive');
    renderHook(() => useLandingAnalytics());
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sdk.init).not.toHaveBeenCalled();
    readyState.mockReturnValue('complete');
    window.dispatchEvent(new Event('load'));
    await vi.advanceTimersByTimeAsync(1500);
    await vi.waitFor(() => expect(sdk.init).toHaveBeenCalledTimes(1));
    readyState.mockRestore();
  });

  it('stops waiting for load when the page is left first', async () => {
    build.key = KEY;
    vi.useFakeTimers();
    vi.stubGlobal('requestIdleCallback', undefined);
    const readyState = vi.spyOn(document, 'readyState', 'get').mockReturnValue('interactive');
    const { unmount } = renderHook(() => useLandingAnalytics());
    unmount();
    window.dispatchEvent(new Event('load'));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sdk.init).not.toHaveBeenCalled();
    readyState.mockRestore();
  });

  it('starts only once the page has gone idle, not during first paint', async () => {
    build.key = KEY;
    vi.useFakeTimers();
    vi.stubGlobal('requestIdleCallback', undefined);
    renderHook(() => useLandingAnalytics());
    expect(sdk.init).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1500);
    await vi.waitFor(() => expect(sdk.init).toHaveBeenCalledTimes(1));
  });
});
