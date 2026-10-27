import { describe, expect, it } from 'vitest';
import type { SignupReview } from '../../api/client';
import { mailRetryable, mailWentOut, reviewChips, waitingOf } from '../signupReviews';

/** MUT-460 (design 13A, 18A): what a waiting signup's row says about it. */
const review = (overrides: Partial<SignupReview> = {}): SignupReview => ({
  id: 'r1',
  userId: 'u1',
  email: 'nour@gmail.com',
  displayName: 'Nour',
  locale: 'ar',
  domain: 'gmail.com',
  classification: 'WEBMAIL',
  reasons: ['webmail'],
  createdAt: '2026-10-27T09:00:00.000Z',
  notifiedAt: null,
  decidedAt: null,
  decision: null,
  ...overrides,
});

describe('reviewChips', () => {
  it('names each reason the screen gives, risky ones as warnings', () => {
    expect(reviewChips(review({ classification: 'BUSINESS_UNVERIFIED', reasons: ['no-mx', 'dns-unavailable', 'relay'] }))).toEqual([
      { kind: 'known', key: 'noMx', tone: 'warning' },
      { kind: 'known', key: 'dnsUnavailable', tone: 'neutral' },
      { kind: 'known', key: 'relay', tone: 'warning' },
    ]);
  });

  it('reads a young domain’s age in days, as a warning', () => {
    expect(reviewChips(review({ classification: 'BUSINESS_UNVERIFIED', reasons: ['rdap-age-12d'] }))).toEqual([{ kind: 'age', days: 12, tone: 'warning' }]);
  });

  it('shows a code it doesn’t know as the raw code', () => {
    expect(reviewChips(review({ reasons: ['brand-new-check'] }))).toEqual([{ kind: 'raw', code: 'brand-new-check' }]);
  });

  it('with no reasons, names the classification', () => {
    expect(reviewChips(review({ classification: 'BUSINESS', reasons: [] }))).toEqual([{ kind: 'known', key: 'business', tone: 'neutral' }]);
    expect(reviewChips(review({ classification: 'BUSINESS_UNVERIFIED', reasons: [] }))).toEqual([{ kind: 'known', key: 'unverified', tone: 'warning' }]);
  });
});

describe('waitingOf', () => {
  const at = (iso: string) => waitingOf('2026-10-27T09:00:00.000Z', new Date(iso));
  it('counts minutes, then hours, then days', () => {
    expect(at('2026-10-27T09:20:00.000Z')).toEqual({ count: 20, unit: 'minute', overADay: false });
    expect(at('2026-10-27T12:30:00.000Z')).toEqual({ count: 3, unit: 'hour', overADay: false });
    expect(at('2026-10-29T10:00:00.000Z')).toEqual({ count: 2, unit: 'day', overADay: true });
  });
  it('a day exactly is over a day; a clock behind the server is a minute', () => {
    expect(at('2026-10-28T09:00:00.000Z')).toEqual({ count: 1, unit: 'day', overADay: true });
    expect(at('2026-10-27T08:00:00.000Z')).toEqual({ count: 1, unit: 'minute', overADay: false });
  });
});

describe('mailRetryable', () => {
  it('only a failed or capped send is worth another try', () => {
    expect(mailRetryable('failed')).toBe(true);
    expect(mailRetryable('capped')).toBe(true);
    for (const mail of ['suppressed', 'refused', 'disabled', 'sent', 'duplicate', undefined] as const) expect(mailRetryable(mail)).toBe(false);
  });
});

describe('mailWentOut', () => {
  it('sent and duplicate went out; everything else did not', () => {
    expect(mailWentOut('sent')).toBe(true);
    expect(mailWentOut('duplicate')).toBe(true);
    for (const mail of ['suppressed', 'refused', 'capped', 'disabled', 'failed'] as const) expect(mailWentOut(mail)).toBe(false);
  });
});
