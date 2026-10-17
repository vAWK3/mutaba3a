import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  USAGE_RECORD_KEY,
  choosePortalUsage,
  endPortalUsage,
  resetPortalUsageForTests,
  syncPortalUsage,
  trackPortal,
  usePortalUsage,
} from '../portalAnalytics';

const { build, sdk, calls } = vi.hoisted(() => {
  const calls: string[] = [];
  const sdk = {
    init: vi.fn((key: string) => calls.push(`init:${key}`)),
    capture: vi.fn((event: string) => calls.push(`capture:${event}`)),
    opt_out_capturing: vi.fn(() => calls.push('opt_out')),
    opt_in_capturing: vi.fn(() => calls.push('opt_in')),
    reset: vi.fn(() => calls.push('reset')),
  };
  return { build: { key: 'phc_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789' }, sdk, calls };
});
vi.mock('../../../lib/analytics/posthogKey', () => ({
  get POSTHOG_KEY() {
    return build.key;
  },
}));
vi.mock('posthog-js', () => ({ default: sdk }));

const ME = 'user-1';
const OTHER = 'user-2';
const record = () => JSON.parse(localStorage.getItem(USAGE_RECORD_KEY) ?? 'null');

beforeEach(() => {
  resetPortalUsageForTests();
  localStorage.clear();
  calls.length = 0;
  Object.values(sdk).forEach((fn) => fn.mockClear());
  build.key = 'phc_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
  document.documentElement.lang = 'en';
});

describe('before anyone chooses', () => {
  it('asks, and loads nothing', async () => {
    await syncPortalUsage(ME);
    expect(usePortalUsage.getState()).toMatchObject({ choice: null, owner: ME });
    expect(calls).toEqual([]);
  });

  it('sends nothing for a save while no choice is made', async () => {
    await syncPortalUsage(ME);
    await trackPortal('income_recorded', { currency: 'USD', paid: true });
    expect(calls).toEqual([]);
  });

  it('does nothing at all in a build without a key, and never asks', async () => {
    build.key = '';
    await syncPortalUsage(ME);
    expect(usePortalUsage.getState().choice).toBe('unavailable');
    await choosePortalUsage('on', 'first_run');
    expect(calls).toEqual([]);
  });
});

describe('turning it on', () => {
  it('starts the SDK only now, with the portal config, then sends analytics_opted_in', async () => {
    await syncPortalUsage(ME);
    await choosePortalUsage('on', 'first_run');
    expect(calls).toEqual([`init:${build.key}`, 'capture:analytics_opted_in']);
    const [, options] = sdk.init.mock.calls[0];
    expect(options).toMatchObject({ persistence: 'localStorage', request_batching: false, person_profiles: 'never', autocapture: false });
    expect(sdk.capture).toHaveBeenCalledWith('analytics_opted_in', { prompt: 'first_run' });
    expect(record()).toEqual({ owner: ME, choice: 'on' });
  });

  it('counts the portal opening once per page load when already on', async () => {
    localStorage.setItem(USAGE_RECORD_KEY, JSON.stringify({ owner: ME, choice: 'on' }));
    await syncPortalUsage(ME);
    await syncPortalUsage(ME);
    expect(calls).toEqual([`init:${build.key}`, 'capture:portal_opened']);
  });

  it('sends saves while on', async () => {
    await syncPortalUsage(ME);
    await choosePortalUsage('on', 'settings');
    await trackPortal('expense_recorded', { currency: 'ILS' });
    expect(sdk.capture).toHaveBeenLastCalledWith('expense_recorded', { currency: 'ILS' });
  });
});

describe('turning it off', () => {
  it('sends one last note, resets, opts out, and deletes the ID from the browser', async () => {
    await syncPortalUsage(ME);
    await choosePortalUsage('on', 'first_run');
    localStorage.setItem('ph_phc_x_posthog', '{"distinct_id":"abc"}');
    localStorage.setItem('__ph_opt_in_out_phc_x', '1');
    calls.length = 0;
    await choosePortalUsage('off', 'settings');
    expect(calls).toEqual(['capture:analytics_opted_out', 'reset', 'opt_out']);
    expect(sdk.reset).toHaveBeenCalledWith(true);
    expect(Object.keys(localStorage).filter((k) => /ph_/.test(k))).toEqual([]);
    expect(record()).toEqual({ owner: ME, choice: 'off' });
  });

  it('sends nothing afterwards', async () => {
    await syncPortalUsage(ME);
    await choosePortalUsage('on', 'first_run');
    await choosePortalUsage('off', 'settings');
    calls.length = 0;
    await trackPortal('payment_recorded', { currency: 'EUR' });
    expect(calls).toEqual([]);
  });

  it('declining at the prompt sends nothing and never loads the SDK', async () => {
    await syncPortalUsage(ME);
    await choosePortalUsage('off', 'first_run');
    expect(calls).toEqual([]);
    expect(record()).toEqual({ owner: ME, choice: 'off' });
  });

  it('turning it on again in the same page starts a fresh ID with no $opt_in event', async () => {
    await syncPortalUsage(ME);
    await choosePortalUsage('on', 'first_run');
    await choosePortalUsage('off', 'settings');
    calls.length = 0;
    await choosePortalUsage('on', 'settings');
    expect(calls).toEqual(['reset', 'opt_in', 'capture:analytics_opted_in']);
    expect(sdk.opt_in_capturing).toHaveBeenCalledWith({ captureEventName: false });
  });
});

describe('sign-out and another account (rule 6)', () => {
  it('sign-out resets without sending anything and forgets the choice', async () => {
    await syncPortalUsage(ME);
    await choosePortalUsage('on', 'first_run');
    localStorage.setItem('ph_phc_x_posthog', '{}');
    calls.length = 0;
    endPortalUsage();
    expect(calls).toEqual(['reset', 'opt_out']);
    expect(sdk.capture).not.toHaveBeenCalledWith('analytics_opted_out', expect.anything());
    expect(localStorage.getItem(USAGE_RECORD_KEY)).toBeNull();
    expect(Object.keys(localStorage).filter((k) => /ph_/.test(k))).toEqual([]);
    expect(usePortalUsage.getState().choice).toBeNull();
  });

  it('another account signing in on this browser is asked afresh, and the old ID is gone', async () => {
    localStorage.setItem(USAGE_RECORD_KEY, JSON.stringify({ owner: ME, choice: 'on' }));
    localStorage.setItem('ph_phc_x_posthog', '{"distinct_id":"old"}');
    await syncPortalUsage(OTHER);
    expect(usePortalUsage.getState()).toMatchObject({ choice: null, owner: OTHER });
    expect(localStorage.getItem(USAGE_RECORD_KEY)).toBeNull();
    expect(Object.keys(localStorage).filter((k) => /ph_/.test(k))).toEqual([]);
    expect(sdk.capture).not.toHaveBeenCalled();
  });

  it('an unreadable record counts as no choice', async () => {
    localStorage.setItem(USAGE_RECORD_KEY, '{oops');
    await syncPortalUsage(ME);
    expect(usePortalUsage.getState().choice).toBeNull();
  });
});

describe('failure never reaches the page', () => {
  it('swallows an SDK that fails to load, and stays silent', async () => {
    sdk.init.mockImplementationOnce(() => {
      throw new Error('blocked');
    });
    await syncPortalUsage(ME);
    await expect(choosePortalUsage('on', 'first_run')).resolves.toBeUndefined();
    await expect(trackPortal('income_recorded', { currency: 'USD', paid: false })).resolves.toBeUndefined();
  });
});
