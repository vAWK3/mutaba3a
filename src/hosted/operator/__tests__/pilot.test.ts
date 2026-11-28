import { describe, expect, it } from 'vitest';
import { isCohort, pilotChipOf, rowPilotOf } from '../pilot';

/** MUT-757 (P8): the Accounts row's pilot chip from `endsAt`, and the grant form's cohort rule. */
const NOW = new Date('2026-12-01T12:00:00Z');
const at = (days: number) => new Date(NOW.getTime() + days * 86_400_000).toISOString();

describe('pilotChipOf', () => {
  it('ends on a date until the last 14 days, then days left, then Ended', () => {
    expect(pilotChipOf({ endsAt: at(15) }, NOW)).toEqual({ kind: 'ends', endsAt: at(15) });
    expect(pilotChipOf({ endsAt: at(14) }, NOW)).toEqual({ kind: 'daysLeft', days: 14 });
    expect(pilotChipOf({ endsAt: at(0.1) }, NOW)).toEqual({ kind: 'daysLeft', days: 1 });
    expect(pilotChipOf({ endsAt: at(0) }, NOW)).toEqual({ kind: 'ended' });
    expect(pilotChipOf({ endsAt: at(-3) }, NOW)).toEqual({ kind: 'ended' });
  });

  it('a row without a pilot (or an older server) has none', () => {
    expect(rowPilotOf({ pilot: null })).toBeNull();
    expect(rowPilotOf({})).toBeNull();
  });
});

describe('isCohort', () => {
  it('a lowercase slug, never a name', () => {
    expect(isCohort('dec-2026')).toBe(true);
    expect(isCohort('acct.nasser_1')).toBe(true);
    expect(isCohort('Rana Haddad')).toBe(false);
    expect(isCohort('-x')).toBe(false);
    expect(isCohort('a'.repeat(65))).toBe(false);
  });
});
