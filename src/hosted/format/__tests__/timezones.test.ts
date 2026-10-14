import { describe, it, expect, vi, afterEach } from 'vitest';
import { browserTimezone, timezoneOptions } from '../timezones';

afterEach(() => vi.restoreAllMocks());

describe('browserTimezone (TZ1)', () => {
  it("returns the browser's zone", () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({ timeZone: 'Asia/Jerusalem' } as Intl.ResolvedDateTimeFormatOptions);
    expect(browserTimezone()).toBe('Asia/Jerusalem');
  });

  it('falls back to UTC when the browser reports none', () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({ timeZone: '' } as Intl.ResolvedDateTimeFormatOptions);
    expect(browserTimezone()).toBe('UTC');
  });
});

describe('timezoneOptions (TZ1)', () => {
  it('offers the full list with the selected zone in it', () => {
    expect(timezoneOptions('Asia/Gaza', ['Africa/Cairo', 'Asia/Gaza', 'Europe/London'])).toEqual(['Africa/Cairo', 'Asia/Gaza', 'Europe/London']);
  });

  it('still offers a selected zone the engine omits (UTC, legacy aliases), in order', () => {
    expect(timezoneOptions('Asia/Calcutta', ['Africa/Cairo', 'Europe/London'])).toEqual(['Africa/Cairo', 'Asia/Calcutta', 'Europe/London']);
  });

  it('offers just the selected zone when the engine lists none', () => {
    expect(timezoneOptions('UTC', [])).toEqual(['UTC']);
  });
});
