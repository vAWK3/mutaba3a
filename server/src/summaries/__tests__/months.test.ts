import { describe, expect, it } from 'vitest';
import { COMPLETE_MONTH_CUTOFF_DAY, firstCountedMonth } from '../months.js';

/** MUT-447 (D6/D8): the one "complete month" rule the portal's Reports stage and the server's usual share. */
describe('firstCountedMonth', () => {
  it('counts the first month when records began by the cutoff day', () => {
    expect(COMPLETE_MONTH_CUTOFF_DAY).toBe(7);
    expect(firstCountedMonth('2026-03-01')).toBe('2026-03');
    expect(firstCountedMonth('2026-03-07')).toBe('2026-03');
  });

  it('starts at the next month when records began after the cutoff day', () => {
    expect(firstCountedMonth('2026-03-08')).toBe('2026-04');
    expect(firstCountedMonth('2026-12-20')).toBe('2027-01');
  });
});
