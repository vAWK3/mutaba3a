import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/client';
import { mapDeskError } from '../accountantErrors';

/**
 * MUT-768 (accountant channel): the desk's refusals, in mapProfileError's pure shape. Each is a banner at the top of the
 * drawer body (never a toast). A refusal that means the desk list is stale asks for a re-read.
 */
const refusal = (status: number, code: string, details: Record<string, unknown> | null = null) => new ApiError(status, code as never, code, details, 'req-1', null);

describe('mapDeskError', () => {
  it('names an unapproved accountant, and re-reads the desk', () => {
    expect(mapDeskError(refusal(403, 'ACCOUNTANT_NOT_APPROVED'))).toEqual({ banner: { tone: 'info', key: 'hosted.desk.errors.notApproved' }, refetchDesk: true });
  });

  it('tells a refused address apart from other validation failures', () => {
    expect(mapDeskError(refusal(422, 'VALIDATION_FAILED', { reason: 'ADDRESS_REFUSED' })).banner).toEqual({ tone: 'error', key: 'hosted.desk.errors.addressRefused' });
    expect(mapDeskError(refusal(422, 'VALIDATION_FAILED', { field: 'email' })).banner.key).toBe('hosted.desk.errors.failed');
  });

  it('names which daily limit was reached', () => {
    expect(mapDeskError(refusal(429, 'RATE_LIMITED', { limit: 'CREATE_PER_DAY', max: 50 })).banner).toEqual({ tone: 'error', key: 'hosted.desk.errors.limitCreate', vars: { max: '50' } });
    expect(mapDeskError(refusal(429, 'RATE_LIMITED', { limit: 'LOOKUP_PER_DAY', max: 100 })).banner.key).toBe('hosted.desk.errors.limitLookup');
    expect(mapDeskError(refusal(429, 'RATE_LIMITED', { limit: 'REISSUE_PER_DAY', max: 5 })).banner.key).toBe('hosted.desk.errors.limitReissue');
    expect(mapDeskError(refusal(429, 'RATE_LIMITED')).banner.key).toBe('hosted.desk.errors.rateLimited');
  });

  it('answers a customer who has claimed meanwhile, and a taken address', () => {
    expect(mapDeskError(refusal(403, 'CUSTOMER_CLAIMED'))).toEqual({ banner: { tone: 'info', key: 'hosted.desk.errors.claimed' }, refetchDesk: true });
    expect(mapDeskError(refusal(409, 'CONFLICT', { reason: 'EMAIL_TAKEN' })).banner.key).toBe('hosted.desk.errors.emailTaken');
  });

  it('maps the activation refusals', () => {
    expect(mapDeskError(refusal(409, 'CONFLICT', { reason: 'ALREADY_SUBSCRIBED' }))).toEqual({ banner: { tone: 'info', key: 'hosted.desk.errors.alreadyPaid' }, refetchDesk: true });
    expect(mapDeskError(refusal(409, 'CONFLICT', { reason: 'CONTACT_US' })).banner.key).toBe('hosted.desk.errors.cardUnavailable');
    expect(mapDeskError(refusal(422, 'VALIDATION_FAILED', { reason: 'COUNTRY_NEEDS_BUSINESS' })).banner.key).toBe('hosted.desk.errors.countryNeedsBusiness');
    expect(mapDeskError(refusal(422, 'VALIDATION_FAILED', { reason: 'ADDRESS_INVALID' })).banner.key).toBe('hosted.desk.errors.addressInvalid');
    expect(mapDeskError(refusal(502, 'STRIPE_UNAVAILABLE')).banner.key).toBe('hosted.desk.errors.stripeDown');
    expect(mapDeskError(refusal(503, 'BILLING_NOT_CONFIGURED')).banner.key).toBe('hosted.desk.errors.stripeDown');
  });

  it('falls back to one generic banner for anything else, including a non-API error', () => {
    expect(mapDeskError(refusal(500, 'INTERNAL')).banner).toEqual({ tone: 'error', key: 'hosted.desk.errors.failed' });
    expect(mapDeskError(new Error('offline')).banner).toEqual({ tone: 'error', key: 'hosted.desk.errors.failed' });
  });
});
