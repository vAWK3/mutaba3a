import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../api/client';
import { NEW_PASSWORD_POLICY, answerWasLost, passwordProblem, redeemFailure, tokenFromHash } from '../setupLink';

/** mut-236-setup-page.md §2.3–§2.4, test plan "Unit". */

describe('passwordProblem', () => {
  it('refuses fewer than 12 characters and more than 128, and accepts both bounds', () => {
    expect(passwordProblem('')).toBe('tooShort');
    expect(passwordProblem('a'.repeat(11))).toBe('tooShort');
    expect(passwordProblem('a'.repeat(12))).toBeNull();
    expect(passwordProblem('a'.repeat(128))).toBeNull();
    expect(passwordProblem('a'.repeat(129))).toBe('tooLong');
  });

  it('counts the way the server does (UTF-16 code units), so an emoji counts as two', () => {
    expect(passwordProblem('🔑'.repeat(6))).toBeNull();
    expect(passwordProblem(`${'🔑'.repeat(5)}a`)).toBe('tooShort');
  });

  it('mirrors the NewPassword bounds the server publishes in its OpenAPI document', () => {
    const yaml = readFileSync(resolve(__dirname, '../../../../../server/openapi/openapi.yaml'), 'utf8');
    const block = /\n {4}NewPassword:\n((?: {6}.*\n)+)/.exec(yaml)?.[1] ?? '';
    expect(block).toContain(`minLength: ${NEW_PASSWORD_POLICY.minLength}\n`);
    expect(block).toContain(`maxLength: ${NEW_PASSWORD_POLICY.maxLength}\n`);
  });
});

describe('tokenFromHash', () => {
  it('reads the router hash (which carries no #) and treats an empty one as no token', () => {
    expect(tokenFromHash('')).toBeNull();
    expect(tokenFromHash('   ')).toBeNull();
    expect(tokenFromHash(' abc_DEF-123 ')).toBe('abc_DEF-123');
  });
});

describe('redeemFailure', () => {
  const unusable = (state: unknown) => new ApiError(410, 'SETUP_LINK_UNUSABLE', 'unusable', { state });

  it('names the state a 410 gives, and an unknown or missing one as invalid', () => {
    for (const state of ['expired', 'used', 'superseded', 'invalid'] as const) {
      expect(redeemFailure(unusable(state), false)).toEqual({ kind: 'refused', state });
    }
    expect(redeemFailure(unusable('later'), false)).toEqual({ kind: 'refused', state: 'invalid' });
    expect(redeemFailure(new ApiError(410, 'SETUP_LINK_UNUSABLE', 'unusable'), false)).toEqual({ kind: 'refused', state: 'invalid' });
  });

  it('turns "used" after an answer was lost into a sign-in attempt (TD-149, D3); other states stay refusals', () => {
    expect(redeemFailure(unusable('used'), true)).toEqual({ kind: 'trySignIn' });
    expect(redeemFailure(unusable('expired'), true)).toEqual({ kind: 'refused', state: 'expired' });
  });

  it('maps a policy refusal, a rate limit (in whole minutes) and an unreachable server', () => {
    expect(redeemFailure(new ApiError(422, 'VALIDATION_FAILED', 'bad'), false)).toEqual({ kind: 'policy' });
    expect(redeemFailure(new ApiError(429, 'RATE_LIMITED', 'slow', null, null, 61), false)).toEqual({ kind: 'rateLimited', minutes: 2 });
    expect(redeemFailure(new ApiError(0, 'NETWORK', 'down'), false)).toEqual({ kind: 'unreachable' });
    expect(redeemFailure(new ApiError(504, 'UNKNOWN', 'HTTP 504'), false)).toEqual({ kind: 'unreachable' });
    expect(redeemFailure(new Error('boom'), false)).toEqual({ kind: 'unreachable' });
  });
});

describe('answerWasLost', () => {
  it('is true when no answer reached the page or a proxy may have cut one off after the commit', () => {
    expect(answerWasLost(new ApiError(0, 'NETWORK', 'down'))).toBe(true);
    expect(answerWasLost(new ApiError(504, 'UNKNOWN', 'HTTP 504'))).toBe(true);
    expect(answerWasLost(new Error('boom'))).toBe(true);
    expect(answerWasLost(new ApiError(410, 'SETUP_LINK_UNUSABLE', 'used', { state: 'used' }))).toBe(false);
    expect(answerWasLost(new ApiError(429, 'RATE_LIMITED', 'slow'))).toBe(false);
  });
});
