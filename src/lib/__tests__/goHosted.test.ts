import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GO_HOSTED_DISMISSED_KEY,
  GO_HOSTED_SNOOZE_DAYS,
  goHostedEnabled,
  hostedPortalUrl,
  isGoHostedCardDue,
  readDismissedAt,
  writeDismissedAt,
} from '../goHosted';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 14, 12);

describe('isGoHostedCardDue (MUT-187)', () => {
  it('is due when the card was never dismissed', () => {
    expect(isGoHostedCardDue(null, NOW)).toBe(true);
  });

  it('stays hidden for the snooze period after a dismissal', () => {
    expect(isGoHostedCardDue(NOW, NOW)).toBe(false);
    expect(isGoHostedCardDue(NOW - (GO_HOSTED_SNOOZE_DAYS * DAY - 60 * 60 * 1000), NOW)).toBe(false);
  });

  it('comes back after exactly 30 days, and any time later', () => {
    expect(GO_HOSTED_SNOOZE_DAYS).toBe(30);
    expect(isGoHostedCardDue(NOW - 30 * DAY, NOW)).toBe(true);
    expect(isGoHostedCardDue(NOW - 400 * DAY, NOW)).toBe(true);
  });

  it('treats a dismissal in the future as due, so a skewed clock can never hide it for good', () => {
    expect(isGoHostedCardDue(NOW + DAY, NOW)).toBe(true);
    expect(isGoHostedCardDue(Date.UTC(2099, 0, 1), NOW)).toBe(true);
  });
});

describe('dismissal storage (MUT-187)', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('round-trips the dismissal time', () => {
    writeDismissedAt(NOW);
    expect(localStorage.getItem(GO_HOSTED_DISMISSED_KEY)).toBe(String(NOW));
    expect(readDismissedAt()).toBe(NOW);
  });

  it('reads nothing stored as never dismissed', () => {
    expect(readDismissedAt()).toBeNull();
  });

  it.each(['', 'yesterday', 'NaN', '1e999', '{}'])('reads a garbage value %j as never dismissed', (value) => {
    localStorage.setItem(GO_HOSTED_DISMISSED_KEY, value);
    expect(readDismissedAt()).toBeNull();
  });

  it('reads nothing when storage throws (private mode, blocked site data)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(readDismissedAt()).toBeNull();
  });

  it('swallows a write that storage refuses', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    expect(() => writeDismissedAt(NOW)).not.toThrow();
  });
});

describe('build gates (MUT-187)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is off when the build mode is not defined (the test runner) or is desktop', () => {
    expect(goHostedEnabled()).toBe(false);
    vi.stubGlobal('__BUILD_MODE__', 'desktop');
    expect(goHostedEnabled()).toBe(false);
  });

  it('is on in the web build', () => {
    vi.stubGlobal('__BUILD_MODE__', 'web');
    expect(goHostedEnabled()).toBe(true);
  });

  it('reads the portal URL the build defined, or nothing', () => {
    expect(hostedPortalUrl()).toBe('');
    vi.stubGlobal('__PORTAL_URL__', 'https://portal.test');
    expect(hostedPortalUrl()).toBe('https://portal.test');
  });
});
