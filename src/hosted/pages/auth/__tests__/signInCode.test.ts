import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../api/client';
import { codeDigits, codeFailure, refusalReason } from '../signInCode';

/** MUT-618 (D6, D9): what a refused code means for the page, and what PostHog may record of it. */
describe('codeDigits', () => {
  it.each([
    ['123456', '123456'],
    ['123 456', '123456'],
    ['12-34-56', '123456'],
    ['١٢٣٤٥٦', '123456'],
    ['۱۲۳۴۵۶', '123456'],
    ['1234567', '123456'],
    ['abc', ''],
  ])('%s → %s', (typed, digits) => expect(codeDigits(typed)).toBe(digits));
});

describe('codeFailure', () => {
  const err = (status: number, code: string, details: unknown = null, retry: number | null = null) => new ApiError(status, code as never, code, details, null, retry);
  it('maps each server answer', () => {
    expect(codeFailure(err(401, 'SIGN_IN_CODE_WRONG', { triesLeft: 2 }))).toEqual({ kind: 'wrong', triesLeft: 2 });
    expect(codeFailure(err(401, 'SIGN_IN_CODE_EXPIRED'))).toEqual({ kind: 'expired' });
    expect(codeFailure(err(401, 'INVALID_CREDENTIALS'))).toEqual({ kind: 'expired' });
    expect(codeFailure(err(401, 'SIGN_IN_CODE_TOO_MANY_TRIES'))).toEqual({ kind: 'tooMany' });
    expect(codeFailure(err(403, 'ACCOUNT_UNDER_REVIEW'))).toEqual({ kind: 'underReview' });
    expect(codeFailure(err(429, 'RATE_LIMITED', null, 900))).toEqual({ kind: 'wait', minutes: 15 });
    expect(codeFailure(err(503, 'SERVICE_UNAVAILABLE'))).toEqual({ kind: 'unreachable' });
    expect(codeFailure(new TypeError('offline'))).toEqual({ kind: 'unreachable' });
  });

  it('records a reason for every refusal and none for an outage (errors go to Sentry)', () => {
    expect(refusalReason({ kind: 'wrong', triesLeft: 1 })).toBe('wrong');
    expect(refusalReason({ kind: 'tooMany' })).toBe('too_many_tries');
    expect(refusalReason({ kind: 'wait', minutes: 1 })).toBe('rate_limited');
    expect(refusalReason({ kind: 'unreachable' })).toBeNull();
  });
});
