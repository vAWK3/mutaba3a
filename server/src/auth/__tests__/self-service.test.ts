import { describe, expect, it } from 'vitest';
import type { SignupLinkRecord } from '../../repositories/ports.js';
import { answerNoEarlierThan, defaultDisplayName, recoveryPurposeOf, SELF_SERVICE_POLICY, signupAccountOutcome, signupLinkState } from '../self-service.js';

/** MUT-366 (ADR-159, ADR-175): the pure rules behind self-service signup and recovery. */
const NOW = new Date('2026-10-23T10:00:00Z');
const hours = (h: number) => new Date(NOW.getTime() + h * 3_600_000);

function signupLink(overrides: Partial<SignupLinkRecord> = {}): SignupLinkRecord {
  return {
    id: 'link-1',
    purpose: 'SIGNUP',
    userId: null,
    email: 'rana@studio.example',
    locale: 'ar',
    tokenDigest: 'd'.repeat(64),
    createdAt: NOW,
    expiresAt: hours(24),
    usedAt: null,
    cancelledAt: null,
    mailed: true,
    domainClass: 'BUSINESS',
    domainReasons: [],
    ...overrides,
  };
}

describe('SELF_SERVICE_POLICY (MUT-366)', () => {
  it('holds the ticket’s numbers', () => {
    expect(SELF_SERVICE_POLICY).toMatchObject({
      signupLinkHours: 24,
      recoveryResetHours: 1,
      recoverySetupHours: 24,
      ipPerHour: 10,
      addressPerMinute: 1,
      addressPerDay: 5,
      signupFloorMs: 3000,
      recoveryFloorMs: 1500,
      pruneAfterExpiryDays: 7,
    });
  });
});

describe('signupLinkState (MUT-366)', () => {
  it('is valid while unused, open, unexpired and nobody holds the email', () => {
    expect(signupLinkState(signupLink(), null, NOW)).toBe('valid');
  });

  it('is used once anyone holds the email, whatever the link says (a racing link, an operator create)', () => {
    expect(signupLinkState(signupLink(), { id: 'someone' }, NOW)).toBe('used');
    expect(signupLinkState(signupLink({ cancelledAt: NOW }), { id: 'someone' }, NOW)).toBe('used');
  });

  it('says used, superseded or expired, in that order of preference', () => {
    expect(signupLinkState(signupLink({ usedAt: NOW, expiresAt: hours(-1) }), null, NOW)).toBe('used');
    expect(signupLinkState(signupLink({ cancelledAt: NOW, expiresAt: hours(-1) }), null, NOW)).toBe('superseded');
    expect(signupLinkState(signupLink({ expiresAt: NOW }), null, NOW)).toBe('expired');
  });

  it('is invalid for no link', () => {
    expect(signupLinkState(null, null, NOW)).toBe('invalid');
  });
});

describe('recoveryPurposeOf (MUT-366, D5)', () => {
  const person = { status: 'ACTIVE' as const, passwordHash: '$argon2id$x', lastSignInAt: NOW };

  it('mails nothing to a disabled account', () => {
    expect(recoveryPurposeOf({ ...person, status: 'DISABLED' })).toBeNull();
  });

  it('MUT-367 (D9): resets an account waiting for review (the person owns the mailbox)', () => {
    expect(recoveryPurposeOf({ ...person, status: 'PENDING_REVIEW', lastSignInAt: null })).toBe('RESET');
  });

  it('resets an account that has a password', () => {
    expect(recoveryPurposeOf(person)).toBe('RESET');
  });

  it('finishes setup for an operator-created account that never set a password', () => {
    expect(recoveryPurposeOf({ ...person, passwordHash: null, lastSignInAt: null })).toBe('SETUP');
  });

  it('resets an account an operator locked after it had signed in', () => {
    expect(recoveryPurposeOf({ ...person, passwordHash: null })).toBe('RESET');
  });
});

describe('signupAccountOutcome (MUT-366 D1, MUT-367)', () => {
  it('opens a BUSINESS address at once and starts the trial at the redeem', () => {
    expect(signupAccountOutcome(signupLink(), NOW)).toEqual({ status: 'ACTIVE', trialStartsAt: NOW, review: null });
  });

  it('sends webmail and unverified domains to review with no trial (it starts at approval)', () => {
    expect(signupAccountOutcome(signupLink({ domainClass: 'WEBMAIL', domainReasons: ['webmail'] }), NOW)).toEqual({
      status: 'PENDING_REVIEW',
      trialStartsAt: null,
      review: { domain: 'studio.example', classification: 'WEBMAIL', reasons: ['webmail'] },
    });
    expect(signupAccountOutcome(signupLink({ domainClass: 'BUSINESS_UNVERIFIED', domainReasons: ['rdap-age-12d'] }), NOW)).toMatchObject({
      status: 'PENDING_REVIEW',
      review: { classification: 'BUSINESS_UNVERIFIED', reasons: ['rdap-age-12d'] },
    });
  });

  it('D19: a link issued before the screen existed waits for review', () => {
    expect(signupAccountOutcome(signupLink({ domainClass: null, domainReasons: [] }), NOW)).toMatchObject({
      status: 'PENDING_REVIEW',
      trialStartsAt: null,
      review: { classification: 'BUSINESS_UNVERIFIED', reasons: ['unclassified'] },
    });
  });
});

describe('defaultDisplayName (MUT-366, D3)', () => {
  it('is the address’s local part', () => {
    expect(defaultDisplayName('rana.saleh@studio.example')).toBe('rana.saleh');
  });

  it('is capped at the display-name limit', () => {
    expect(defaultDisplayName(`${'a'.repeat(300)}@x.example`)).toHaveLength(200);
  });
});

describe('answerNoEarlierThan (MUT-366, D8)', () => {
  function fakeClock(start: number) {
    let t = start;
    const slept: number[] = [];
    return {
      clock: {
        now: () => t,
        sleep: async (ms: number) => {
          slept.push(ms);
          t += ms;
        },
      },
      advance: (ms: number) => {
        t += ms;
      },
      slept,
    };
  }

  it('waits out the rest of the floor', async () => {
    const c = fakeClock(1000);
    c.advance(400);
    expect(await answerNoEarlierThan(1000, 1500, c.clock)).toBe(0);
    expect(c.slept).toEqual([1100]);
  });

  it('does not wait, and reports the overshoot, when the work took longer than the floor', async () => {
    const c = fakeClock(1000);
    c.advance(1700);
    expect(await answerNoEarlierThan(1000, 1500, c.clock)).toBe(200);
    expect(c.slept).toEqual([]);
  });
});
