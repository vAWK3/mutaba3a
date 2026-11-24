import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/client';
import { answerOf, EMPTY_TWO_FACTOR_INPUT, endsTheTry, isTwoFactorRefusal, recoveryCodeOf, setupRequiredOf, twoFactorChallengeOf, twoFactorFailure } from '../twoFactor';

/** MUT-710: the pure half of two-step sign-in, what each refusal means for the page. */

const CHALLENGE = { challengeToken: 'tok', method: 'email', expiresAt: '2026-11-24T10:10:00.000Z', emailHint: 'n•••@firm.ps' };

describe('twoFactorChallengeOf', () => {
  it('reads the challenge a 403 TWO_FACTOR_REQUIRED carries', () => {
    expect(twoFactorChallengeOf(new ApiError(403, 'TWO_FACTOR_REQUIRED', 'x', CHALLENGE))).toEqual(CHALLENGE);
  });

  it('is null for any other refusal, and for a TWO_FACTOR_REQUIRED without a usable challenge', () => {
    expect(twoFactorChallengeOf(new ApiError(401, 'INVALID_CREDENTIALS', 'x'))).toBeNull();
    expect(twoFactorChallengeOf(new ApiError(403, 'TWO_FACTOR_REQUIRED', 'x', { manage: true }))).toBeNull();
    expect(twoFactorChallengeOf(new ApiError(403, 'TWO_FACTOR_REQUIRED', 'x', { ...CHALLENGE, method: 'sms' }))).toBeNull();
    expect(twoFactorChallengeOf(new Error('offline'))).toBeNull();
  });
});

describe('twoFactorFailure', () => {
  it('a wrong code says how many tries are left', () => {
    expect(twoFactorFailure(new ApiError(403, 'TWO_FACTOR_CODE_WRONG', 'x', { triesLeft: 3 }))).toEqual({ kind: 'wrong', triesLeft: 3 });
    expect(twoFactorFailure(new ApiError(403, 'TWO_FACTOR_CODE_WRONG', 'x'))).toEqual({ kind: 'wrong', triesLeft: 1 });
  });

  it('too many tries and an expired step end the try; a lock waits', () => {
    expect(twoFactorFailure(new ApiError(403, 'TWO_FACTOR_TOO_MANY_TRIES', 'x'))).toEqual({ kind: 'tooMany' });
    expect(twoFactorFailure(new ApiError(403, 'TWO_FACTOR_CHALLENGE_EXPIRED', 'x'))).toEqual({ kind: 'expired' });
    expect(twoFactorFailure(new ApiError(429, 'RATE_LIMITED', 'x', null, null, 600))).toEqual({ kind: 'wait', minutes: 10 });
    expect(endsTheTry({ kind: 'tooMany' })).toBe(true);
    expect(endsTheTry({ kind: 'expired' })).toBe(true);
    expect(endsTheTry({ kind: 'wrong', triesLeft: 2 })).toBe(false);
  });

  it('anything else is unreachable', () => {
    expect(twoFactorFailure(new ApiError(500, 'INTERNAL', 'x'))).toEqual({ kind: 'unreachable' });
    expect(twoFactorFailure(new TypeError('fetch failed'))).toEqual({ kind: 'unreachable' });
  });
});

describe('the answer', () => {
  it('a code is sent once it has six digits', () => {
    expect(answerOf({ ...EMPTY_TWO_FACTOR_INPUT, code: '12345' })).toBeNull();
    expect(answerOf({ ...EMPTY_TWO_FACTOR_INPUT, code: '123456' })).toEqual({ code: '123456' });
  });

  it('a recovery code forgives case, spaces and a missing hyphen, and is sent once whole', () => {
    expect(recoveryCodeOf('K7MQ 2XDP')).toBe('k7mq-2xdp');
    expect(recoveryCodeOf('k7mq2xdp')).toBe('k7mq-2xdp');
    expect(recoveryCodeOf('k7m')).toBe('k7m');
    expect(answerOf({ mode: 'recovery', code: '', recoveryCode: 'k7mq-2x' })).toBeNull();
    expect(answerOf({ mode: 'recovery', code: '123456', recoveryCode: 'k7mq-2xdp' })).toEqual({ recoveryCode: 'k7mq-2xdp' });
  });
});

describe('the prompt before issuing', () => {
  it('TWO_FACTOR_SETUP_REQUIRED says whether it is on but this session predates it', () => {
    expect(setupRequiredOf(new ApiError(403, 'TWO_FACTOR_SETUP_REQUIRED', 'x', { enrolled: false }))).toEqual({ enrolled: false });
    expect(setupRequiredOf(new ApiError(403, 'TWO_FACTOR_SETUP_REQUIRED', 'x', { enrolled: true }))).toEqual({ enrolled: true });
    expect(isTwoFactorRefusal(new ApiError(403, 'TWO_FACTOR_SETUP_REQUIRED', 'x'))).toBe(true);
    expect(isTwoFactorRefusal(new ApiError(409, 'CONFLICT', 'x'))).toBe(false);
  });
});
