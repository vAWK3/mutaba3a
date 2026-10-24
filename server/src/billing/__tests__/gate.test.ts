import { describe, expect, it } from 'vitest';
import type { Entitlement } from '../entitlement.js';
import {
  LOCKED_OPEN_ENDPOINTS,
  PERSON_LEVEL_GATE,
  lapsedError,
  personStanding,
  profileGateRefuses,
  standingOf,
  standingRefuses,
} from '../gate.js';

/** MUT-361 (ADR-181): the lapse gate's pure rules. */
const ACTIVE: Entitlement = { state: 'ACTIVE', source: 'TRIAL', tier: 'FREELANCER', until: new Date('2026-11-05T00:00:00Z') };
const GRACE: Entitlement = { state: 'GRACE', source: 'STRIPE', tier: 'FREELANCER', until: new Date('2026-11-05T00:00:00Z') };
const READ_ONLY: Entitlement = { state: 'READ_ONLY', source: 'TRIAL', tier: 'FREELANCER', until: new Date('2026-11-20T00:00:00Z') };
const LOCKED: Entitlement = { state: 'LOCKED', source: 'TRIAL', tier: 'FREELANCER', until: null };

describe('standingOf', () => {
  it('maps ACTIVE and GRACE to open, READ_ONLY to read-only, LOCKED to locked', () => {
    expect(standingOf('ACTIVE')).toBe('open');
    expect(standingOf('GRACE')).toBe('open');
    expect(standingOf('READ_ONLY')).toBe('read-only');
    expect(standingOf('LOCKED')).toBe('locked');
  });
});

describe('personStanding (the best across the person’s profiles)', () => {
  it('is open with no profiles at all, so a person can still create one', () => {
    expect(personStanding([])).toBe('open');
  });
  it('is open when any profile is writable', () => {
    expect(personStanding(['LOCKED', 'READ_ONLY', 'GRACE'])).toBe('open');
  });
  it('is read-only when nothing is writable and something is read-only', () => {
    expect(personStanding(['LOCKED', 'READ_ONLY'])).toBe('read-only');
  });
  it('is locked only when every profile is locked', () => {
    expect(personStanding(['LOCKED', 'LOCKED'])).toBe('locked');
  });
});

describe('profileGateRefuses', () => {
  it('never refuses on an open profile', () => {
    for (const method of ['GET', 'POST', 'PATCH', 'PUT', 'DELETE']) expect(profileGateRefuses('open', method, 'POST /v1/expenses')).toBe(false);
  });
  it('lets a read-only profile read and nothing else', () => {
    expect(profileGateRefuses('read-only', 'GET', 'GET /v1/expenses')).toBe(false);
    expect(profileGateRefuses('read-only', 'HEAD', 'GET /v1/expenses')).toBe(false);
    expect(profileGateRefuses('read-only', 'OPTIONS', 'GET /v1/expenses')).toBe(false);
    expect(profileGateRefuses('read-only', 'POST', 'POST /v1/expenses')).toBe(true);
    expect(profileGateRefuses('read-only', 'PATCH', 'PATCH /v1/expenses/:expenseId')).toBe(true);
    expect(profileGateRefuses('read-only', 'DELETE', 'DELETE /v1/expenses/:expenseId')).toBe(true);
  });
  it('lets a locked profile reach only the records export', () => {
    expect(profileGateRefuses('locked', 'GET', 'GET /v1/expenses')).toBe(true);
    expect(profileGateRefuses('locked', 'GET', 'GET /v1/records-export')).toBe(false);
    expect(profileGateRefuses('locked', 'GET', 'GET /v1/records-export/receipts/:receiptId')).toBe(false);
    expect(profileGateRefuses('locked', 'POST', 'POST /v1/expenses')).toBe(true);
    expect([...LOCKED_OPEN_ENDPOINTS].every((e) => e.startsWith('GET /v1/records-export'))).toBe(true);
  });
});

describe('standingRefuses (person-level and path-profile routes)', () => {
  it('follows the same method rule, and a locked standing refuses reads too', () => {
    expect(standingRefuses('open', 'POST')).toBe(false);
    expect(standingRefuses('read-only', 'GET')).toBe(false);
    expect(standingRefuses('read-only', 'POST')).toBe(true);
    expect(standingRefuses('locked', 'GET')).toBe(true);
  });
});

describe('PERSON_LEVEL_GATE', () => {
  it('keeps identity, sessions, billing and leaving a co-owned profile open', () => {
    for (const endpoint of ['GET /v1/me', 'POST /v1/me/password', 'PATCH /v1/me/trial-prompt', 'POST /v1/me/terms-acceptance', 'DELETE /v1/sessions/current', 'DELETE /v1/device-sessions/current', 'GET /v1/billing', 'POST /v1/billing/checkout-session', 'POST /v1/billing/portal-session', 'DELETE /v1/profiles/:profileId/owners/:userId']) {
      expect(PERSON_LEVEL_GATE[endpoint], endpoint).toBe('open');
    }
  });
  it('puts the inbox, the entries feed and New profile on the person’s standing', () => {
    for (const endpoint of ['POST /v1/inbox', 'GET /v1/inbox', 'GET /v1/inbox/count', 'PATCH /v1/inbox/:entryId', 'DELETE /v1/inbox/:entryId', 'GET /v1/entries', 'POST /v1/profiles']) {
      expect(PERSON_LEVEL_GATE[endpoint], endpoint).toBe('person');
    }
  });
  it('puts a profile named in the path on that profile', () => {
    for (const endpoint of ['PATCH /v1/profiles/:profileId', 'GET /v1/profiles/:profileId/type-change', 'POST /v1/profiles/:profileId/firm-request']) {
      expect(PERSON_LEVEL_GATE[endpoint], endpoint).toBe('pathProfile');
    }
  });
});

describe('lapsedError', () => {
  it('is SUBSCRIPTION_LAPSED (402) naming the profile, the state, the source and the lock date', () => {
    const error = lapsedError('org-1', READ_ONLY);
    expect(error.code).toBe('SUBSCRIPTION_LAPSED');
    expect(error.status).toBe(402);
    expect(error.details).toEqual({ profileId: 'org-1', state: 'READ_ONLY', source: 'TRIAL', until: '2026-11-20T00:00:00.000Z' });
  });
  it('says LOCKED with no date, and names no profile on a person-level refusal', () => {
    expect(lapsedError(null, LOCKED).details).toEqual({ profileId: null, state: 'LOCKED', source: 'TRIAL', until: null });
  });
  it('refuses to build an error for a state that is not gated', () => {
    expect(() => lapsedError('org-1', ACTIVE)).toThrow();
    expect(() => lapsedError('org-1', GRACE)).toThrow();
  });
});
