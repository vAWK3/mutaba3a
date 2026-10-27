import { describe, expect, it } from 'vitest';
import { grantExpiryOf, grantStateOf, isFutureDay, presetDay } from '../grants';

/** MUT-462 (14A): the grant drawer's dates and a grant's standing. */
describe('grantStateOf', () => {
  const now = new Date('2026-10-27T09:00:00Z');

  it('is active with no end, or an end still ahead', () => {
    expect(grantStateOf({ revokedAt: null, expiresAt: null }, now)).toBe('active');
    expect(grantStateOf({ revokedAt: null, expiresAt: '2026-11-26T21:59:59.999Z' }, now)).toBe('active');
  });

  it('is ended once its expiry has passed, and revoked whatever its expiry', () => {
    expect(grantStateOf({ revokedAt: null, expiresAt: '2026-10-27T09:00:00.000Z' }, now)).toBe('ended');
    expect(grantStateOf({ revokedAt: '2026-10-20T00:00:00.000Z', expiresAt: '2027-01-01T00:00:00.000Z' }, now)).toBe('revoked');
  });
});

describe('the expiry a chosen day sends', () => {
  it('is the end of that day where the operator is', () => {
    const iso = grantExpiryOf('2026-11-26')!;
    const end = new Date(iso);
    expect([end.getFullYear(), end.getMonth(), end.getDate(), end.getHours(), end.getMinutes()]).toEqual([2026, 10, 26, 23, 59]);
  });

  it('is no end for an empty field, and null for a day that does not exist', () => {
    expect(grantExpiryOf('')).toBeUndefined();
    expect(grantExpiryOf('2026-02-30')).toBeNull();
    expect(grantExpiryOf('26/11/2026')).toBeNull();
  });
});

describe('the presets and the future-day rule', () => {
  const now = new Date(2026, 9, 27, 12, 0, 0);

  it('puts 30 and 90 days on the local calendar', () => {
    expect(presetDay(30, now)).toBe('2026-11-26');
    expect(presetDay(90, now)).toBe('2027-01-25');
  });

  it('accepts only a day after today', () => {
    expect(isFutureDay('2026-10-28', now)).toBe(true);
    expect(isFutureDay('2026-10-27', now)).toBe(false);
    expect(isFutureDay('2026-10-01', now)).toBe(false);
  });
});
