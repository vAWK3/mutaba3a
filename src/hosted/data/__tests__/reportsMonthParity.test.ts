import { describe, expect, it } from 'vitest';
import * as server from '../../../../server/src/summaries/months';
import { COMPLETE_MONTH_CUTOFF_DAY, firstCountedMonth } from '../reports';

/**
 * MUT-447 (D6/D8, amended): the portal may not import server code outside local mode (ADR-097), so the 7th-day
 * "complete month" rule lives in both places. This test is what keeps them one rule: the portal's Reports stage and
 * the server's verdict usual must count the same months.
 */
describe('complete-month rule parity (portal reports.ts ↔ server summaries/months.ts)', () => {
  it('uses the same cutoff day', () => {
    expect(COMPLETE_MONTH_CUTOFF_DAY).toBe(server.COMPLETE_MONTH_CUTOFF_DAY);
  });

  it.each(['2026-01-01', '2026-01-06', '2026-01-07', '2026-01-08', '2026-02-28', '2026-12-07', '2026-12-08', '2026-12-31'])(
    'agrees on the first counted month for %s',
    (since) => {
      expect(firstCountedMonth(since)).toBe(server.firstCountedMonth(since));
    },
  );
});
