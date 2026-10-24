import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../api/client';
import { selfServiceFailure, waitFor } from '../selfService';

/** MUT-368 (§3.3): what a refused signup or recovery request means for the page. Pure, so each row is pinned here. */

const err = (status: number, code: string, details: unknown = null, retryAfterSeconds: number | null = null) =>
  new ApiError(status, code as never, code, details, null, retryAfterSeconds);

describe('selfServiceFailure', () => {
  it('a 404 is signup closed on this server', () => {
    expect(selfServiceFailure(err(404, 'NOT_FOUND'))).toEqual({ kind: 'closed' });
  });

  it('EMAIL_NOT_ACCEPTED names its reason: a throwaway service, a domain with no mail, or anything else', () => {
    expect(selfServiceFailure(err(400, 'EMAIL_NOT_ACCEPTED', { reason: 'disposable' }))).toEqual({ kind: 'notAccepted', reason: 'disposable' });
    expect(selfServiceFailure(err(400, 'EMAIL_NOT_ACCEPTED', { reason: 'no-mail' }))).toEqual({ kind: 'notAccepted', reason: 'no-mail' });
    expect(selfServiceFailure(err(400, 'EMAIL_NOT_ACCEPTED', { reason: 'later-reason' }))).toEqual({ kind: 'notAccepted', reason: 'other' });
    expect(selfServiceFailure(err(400, 'EMAIL_NOT_ACCEPTED'))).toEqual({ kind: 'notAccepted', reason: 'other' });
  });

  it('CHECK_FAILED is the bot check refusing the token', () => {
    expect(selfServiceFailure(err(403, 'CHECK_FAILED'))).toEqual({ kind: 'checkFailed' });
  });

  it('a 422 naming the email is the field’s own error; any other 422 is our bug, read as unreachable', () => {
    expect(selfServiceFailure(err(422, 'VALIDATION_FAILED', [{ path: ['email'], message: 'must be an email address' }]))).toEqual({ kind: 'invalidEmail' });
    expect(selfServiceFailure(err(422, 'VALIDATION_FAILED', [{ path: ['turnstileToken'], message: 'Required' }]))).toEqual({ kind: 'unreachable' });
    expect(selfServiceFailure(err(422, 'VALIDATION_FAILED'))).toEqual({ kind: 'unreachable' });
  });

  it('a 429 says how long to wait, in minutes', () => {
    expect(selfServiceFailure(err(429, 'RATE_LIMITED', { retryAfterSeconds: 42 }, 42))).toEqual({ kind: 'rateLimited', minutes: 1 });
    expect(selfServiceFailure(err(429, 'RATE_LIMITED', null, 7200))).toEqual({ kind: 'rateLimited', minutes: 120 });
  });

  it('anything else (no answer, a 5xx, a cross-site refusal, a non-API error) is unreachable', () => {
    expect(selfServiceFailure(err(0, 'NETWORK'))).toEqual({ kind: 'unreachable' });
    expect(selfServiceFailure(err(503, 'UNKNOWN'))).toEqual({ kind: 'unreachable' });
    expect(selfServiceFailure(err(403, 'CROSS_SITE_REQUEST'))).toEqual({ kind: 'unreachable' });
    expect(selfServiceFailure(new Error('boom'))).toEqual({ kind: 'unreachable' });
  });
});

describe('waitFor', () => {
  it('counts minutes up to an hour, then whole hours (the 5-a-day budget answers up to 24 h)', () => {
    expect(waitFor(1)).toEqual({ unit: 'minutes', count: 1 });
    expect(waitFor(60)).toEqual({ unit: 'minutes', count: 60 });
    expect(waitFor(61)).toEqual({ unit: 'hours', count: 2 });
    expect(waitFor(1440)).toEqual({ unit: 'hours', count: 24 });
  });
});
