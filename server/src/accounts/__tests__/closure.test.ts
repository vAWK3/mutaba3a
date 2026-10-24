import { describe, expect, it } from 'vitest';
import {
  CLOSING_OPEN_ENDPOINTS,
  GRACE_DAYS,
  closingRefusal,
  closureDeadline,
  deletionDayOf,
  isAccountGone,
  isDueForPurge,
  subscriptionActionsAtClose,
} from '../closure.js';

const at = (iso: string) => new Date(iso);
const closure = (requestedAt: string, overrides: Partial<{ purgeStartedAt: Date | null }> = {}) => ({
  requestedAt: at(requestedAt),
  deleteAfter: closureDeadline(at(requestedAt)),
  endedSubscriptionIds: [],
  purgeStartedAt: null,
  purgeLastTriedAt: null,
  ...overrides,
});

describe('closure rules (MUT-333)', () => {
  it('gives 30 days of grace, to the millisecond', () => {
    expect(GRACE_DAYS).toBe(30);
    expect(closureDeadline(at('2026-10-24T10:00:00.000Z')).toISOString()).toBe('2026-11-23T10:00:00.000Z');
  });

  it('lets a closing session reach only me, keep my account and the two sign-outs (D3, R8)', () => {
    expect([...CLOSING_OPEN_ENDPOINTS].sort()).toEqual(['DELETE /v1/device-sessions/current', 'DELETE /v1/me/closure', 'DELETE /v1/sessions/current', 'GET /v1/me']);
    expect(CLOSING_OPEN_ENDPOINTS.has('POST /v1/me/closure')).toBe(false);
  });

  it('refuses everything else with 403 ACCOUNT_CLOSING naming the deletion instant', () => {
    const c = closure('2026-10-24T10:00:00.000Z');
    const error = closingRefusal(c);
    expect(error.code).toBe('ACCOUNT_CLOSING');
    expect(error.status).toBe(403);
    expect(error.details).toEqual({ deleteAfter: '2026-11-23T10:00:00.000Z' });
  });

  it('treats an account as gone once its deadline passes or the purge has claimed it (D5, R1)', () => {
    const c = closure('2026-10-24T10:00:00.000Z');
    expect(isAccountGone(null, at('2030-01-01T00:00:00Z'))).toBe(false);
    expect(isAccountGone(c, at('2026-11-23T09:59:59.999Z'))).toBe(false);
    expect(isAccountGone(c, at('2026-11-23T10:00:00.000Z'))).toBe(true);
    expect(isAccountGone({ ...c, purgeStartedAt: at('2026-11-01T00:00:00Z') }, at('2026-11-01T00:00:01Z'))).toBe(true);
  });

  it('is due for the hard delete only when both columns agree that 30 days passed (D19)', () => {
    const c = closure('2026-10-24T10:00:00.000Z');
    expect(isDueForPurge(c, at('2026-11-23T09:59:59.999Z'))).toBe(false);
    expect(isDueForPurge(c, at('2026-11-23T10:00:00.000Z'))).toBe(true);
    // A deleteAfter that someone moved earlier by hand is not enough on its own.
    expect(isDueForPurge({ ...c, deleteAfter: at('2026-10-25T00:00:00Z') }, at('2026-10-26T00:00:00Z'))).toBe(false);
    expect(isDueForPurge(null, at('2030-01-01T00:00:00Z'))).toBe(false);
  });

  it('ends paying subscriptions at the period end and cancels failing ones now; ones already ending are left alone (D1, R6, R7)', () => {
    const actions = subscriptionActionsAtClose([
      { id: 'sub_active', status: 'active', cancelAtPeriodEnd: false, cancelAt: null },
      { id: 'sub_trialing', status: 'trialing', cancelAtPeriodEnd: false, cancelAt: null },
      { id: 'sub_ending', status: 'active', cancelAtPeriodEnd: true, cancelAt: null },
      { id: 'sub_cancel_at', status: 'active', cancelAtPeriodEnd: false, cancelAt: at('2026-11-30T00:00:00Z') },
      { id: 'sub_past_due', status: 'past_due', cancelAtPeriodEnd: false, cancelAt: null },
      { id: 'sub_unpaid', status: 'unpaid', cancelAtPeriodEnd: true, cancelAt: null },
      { id: 'sub_canceled', status: 'canceled', cancelAtPeriodEnd: false, cancelAt: null },
      { id: 'sub_incomplete', status: 'incomplete_expired', cancelAtPeriodEnd: false, cancelAt: null },
    ]);
    expect(actions).toEqual({ endAtPeriodEnd: ['sub_active', 'sub_trialing'], cancelNow: ['sub_past_due', 'sub_unpaid'] });
  });

  it('names the deletion day in the person’s zone, allowing the hourly job’s lag (R16)', () => {
    // 22:30 UTC is 00:30 the next day in Jerusalem (UTC+2 in late November).
    expect(deletionDayOf(at('2026-11-23T22:30:00.000Z'), 'Asia/Jerusalem')).toEqual({ year: 2026, month: 11, day: 24 });
    // 21:30 UTC is 23:30 in Jerusalem, but the hourly job may run up to an hour later: 00:30 on the 24th.
    expect(deletionDayOf(at('2026-11-23T21:30:00.000Z'), 'Asia/Jerusalem')).toEqual({ year: 2026, month: 11, day: 24 });
    expect(deletionDayOf(at('2026-11-23T10:00:00.000Z'), 'UTC')).toEqual({ year: 2026, month: 11, day: 23 });
    // An unknown zone falls back to UTC rather than failing the close.
    expect(deletionDayOf(at('2026-11-23T10:00:00.000Z'), 'Not/AZone')).toEqual({ year: 2026, month: 11, day: 23 });
  });
});
