import { describe, expect, it } from 'vitest';
import { ApiError, type AccountantInviteCheck } from '../../../api/client';
import { acceptOutcome, inviteView, signupFailure, type InviteInputs } from '../inviteState';

const invite: AccountantInviteCheck = { profileName: 'Studio', ownerName: 'Rana Haddad', maskedEmail: 's***@khoury-cpa.com', expired: false, expiresAt: '2026-11-17T10:00:00.000Z' };
const base: InviteInputs = { check: { status: 'success', data: invite }, signedIn: false, signingUp: false, outcome: null };

describe('inviteView', () => {
  it('waits for both the check and the session', () => {
    expect(inviteView({ ...base, check: { status: 'pending' } })).toEqual({ kind: 'checking' });
    expect(inviteView({ ...base, signedIn: null })).toEqual({ kind: 'checking' });
  });

  it('signed out: the invite, then the signup form', () => {
    expect(inviteView(base)).toEqual({ kind: 'invite' });
    expect(inviteView({ ...base, signingUp: true })).toEqual({ kind: 'signup' });
  });

  it('signed in: accept', () => {
    expect(inviteView({ ...base, signedIn: true })).toEqual({ kind: 'accept' });
  });

  it('an expired, unknown or malformed invite is gone; an outage offers Retry', () => {
    expect(inviteView({ ...base, check: { status: 'success', data: { ...invite, expired: true } } })).toEqual({ kind: 'gone' });
    expect(inviteView({ ...base, check: { status: 'error', error: new ApiError(404, 'NOT_FOUND', 'x') } })).toEqual({ kind: 'gone' });
    expect(inviteView({ ...base, check: { status: 'error', error: new ApiError(422, 'VALIDATION_FAILED', 'x') } })).toEqual({ kind: 'gone' });
    expect(inviteView({ ...base, check: { status: 'error', error: new ApiError(0, 'NETWORK', 'x') } })).toEqual({ kind: 'unreachable' });
    expect(inviteView({ ...base, check: { status: 'error', error: new ApiError(429, 'RATE_LIMITED', 'x', null, null, 30) } })).toEqual({ kind: 'unreachable', minutes: 1 });
  });

  it('an outcome wins over everything', () => {
    expect(inviteView({ ...base, signedIn: true, outcome: { kind: 'already' } })).toEqual({ kind: 'already' });
  });
});

describe('acceptOutcome', () => {
  it('maps every refusal', () => {
    expect(acceptOutcome(new ApiError(403, 'INVITE_EMAIL_MISMATCH', 'x', { maskedEmail: 'h***@firm.com' }))).toEqual({ kind: 'mismatch', maskedEmail: 'h***@firm.com' });
    expect(acceptOutcome(new ApiError(409, 'CONFLICT', 'x', { reason: 'ALREADY_HAS_ACCESS' }))).toEqual({ kind: 'already' });
    expect(acceptOutcome(new ApiError(404, 'NOT_FOUND', 'x'))).toEqual({ kind: 'gone' });
    expect(acceptOutcome(new ApiError(0, 'NETWORK', 'x'))).toBeNull();
  });
});

describe('signupFailure', () => {
  it('maps every refusal', () => {
    expect(signupFailure(new ApiError(409, 'CONFLICT', 'x', { reason: 'ACCOUNT_EXISTS' }))).toEqual({ kind: 'outcome', outcome: { kind: 'exists' } });
    expect(signupFailure(new ApiError(409, 'TERMS_VERSION_STALE', 'x', { current: '2026-10-19' }))).toEqual({ kind: 'termsStale', current: '2026-10-19' });
    expect(signupFailure(new ApiError(403, 'CHECK_FAILED', 'x'))).toEqual({ kind: 'checkFailed' });
    expect(signupFailure(new ApiError(422, 'VALIDATION_FAILED', 'x'))).toEqual({ kind: 'password' });
    expect(signupFailure(new ApiError(429, 'RATE_LIMITED', 'x', null, null, 120))).toEqual({ kind: 'rateLimited', minutes: 2 });
    expect(signupFailure(new ApiError(404, 'NOT_FOUND', 'x'))).toEqual({ kind: 'outcome', outcome: { kind: 'gone' } });
    expect(signupFailure(new Error('x'))).toEqual({ kind: 'unreachable' });
  });
});
