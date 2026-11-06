import { describe, expect, it } from 'vitest';
import { ApiError, type AccountantGrant } from '../../../api/client';
import { grantRow, inviteErrorOf, relativeDay, revokeErrorOf, sharingOpen, shortDay } from '../sharingRules';

/**
 * MUT-561: the Sharing page's pure rules. Each accountant row's chip, meta and one action at a fixed clock; who gets
 * the page; every invite refusal mapped to its slot (field or banner) in one table.
 */

const TZ = 'Asia/Jerusalem';
const NOW = new Date('2026-11-06T10:00:00.000Z');

function grant(overrides: Partial<AccountantGrant> = {}): AccountantGrant {
  return {
    id: 'g1',
    email: 'sami@khoury-cpa.com',
    name: 'Sami Khoury',
    status: 'active',
    invitedAt: '2026-10-10T09:00:00.000Z',
    expiresAt: '2026-10-24T09:00:00.000Z',
    acceptedAt: '2026-10-12T09:00:00.000Z',
    lastViewedAt: '2026-11-04T08:00:00.000Z',
    ...overrides,
  };
}

const owner = { owned: true };
const meOn = { clients: [] };

describe('sharingOpen (D8)', () => {
  it('opens for an owner, signed in, on a server with accountant access', () => {
    expect(sharingOpen(meOn, owner, false)).toBe(true);
  });

  it.each([
    ['a member of a firm profile', meOn, { owned: false }, false],
    ['accountant access off (no clients on /v1/me)', {}, owner, false],
    ['signed out on this device', meOn, owner, true],
  ])('stays shut for %s', (_label, me, profile, local) => {
    expect(sharingOpen(me, profile, local)).toBe(false);
  });
});

describe('dates on the rows', () => {
  it('shows a day as day and short month in the profile zone, Western digits in Arabic', () => {
    expect(shortDay('2026-10-12T09:00:00.000Z', 'en', TZ)).toBe('Oct 12');
    expect(shortDay('2026-10-12T09:00:00.000Z', 'ar', TZ)).toMatch(/^12 /);
    // 23:30 UTC on the 11th is already the 12th in Jerusalem
    expect(shortDay('2026-10-11T23:30:00.000Z', 'en', TZ)).toBe('Oct 12');
  });

  it('says how long ago in calendar days of the profile zone', () => {
    expect(relativeDay('2026-11-06T06:00:00.000Z', NOW, 'en', TZ)).toBe('today');
    expect(relativeDay('2026-11-05T06:00:00.000Z', NOW, 'en', TZ)).toBe('yesterday');
    expect(relativeDay('2026-11-04T06:00:00.000Z', NOW, 'en', TZ)).toBe('2 days ago');
    expect(relativeDay('2026-10-20T06:00:00.000Z', NOW, 'en', TZ)).toBe('2 weeks ago');
    expect(relativeDay('2026-11-04T06:00:00.000Z', NOW, 'ar', TZ)).toBe('أول أمس');
    expect(relativeDay('2026-11-02T06:00:00.000Z', NOW, 'ar', TZ)).toMatch(/^قبل 4 /);
  });
});

describe('grantRow', () => {
  it('active: Since, viewed when, chip Active, action Stop', () => {
    const row = grantRow(grant(), NOW, 'en', TZ);
    expect(row).toMatchObject({ label: 'Sami Khoury', email: 'sami@khoury-cpa.com', initial: 'SK', chip: 'active', action: 'stop' });
    expect(row.meta).toEqual([
      { key: 'hosted.sharing.accountants.since', vars: { date: 'Oct 12' } },
      { key: 'hosted.sharing.accountants.viewed', vars: { when: '2 days ago' } },
    ]);
  });

  it('active, never opened: not viewed yet', () => {
    expect(grantRow(grant({ lastViewedAt: null }), NOW, 'en', TZ).meta[1]).toEqual({ key: 'hosted.sharing.accountants.notViewed' });
  });

  it('pending: Sent and ends, chip Pending, action Cancel; with no name the email is the label, shown once', () => {
    const row = grantRow(grant({ status: 'pending', name: null, email: 'maya@ledger.co', invitedAt: '2026-11-03T09:00:00.000Z', expiresAt: '2026-11-17T09:00:00.000Z', acceptedAt: null, lastViewedAt: null }), NOW, 'en', TZ);
    expect(row).toMatchObject({ label: 'maya@ledger.co', email: null, initial: 'M', chip: 'pending', action: 'cancel' });
    expect(row.meta).toEqual([
      { key: 'hosted.sharing.accountants.sent', vars: { date: 'Nov 3' } },
      { key: 'hosted.sharing.accountants.ends', vars: { date: 'Nov 17' } },
    ]);
  });

  it('expired: not accepted within 14 days, chip Expired, action Invite again', () => {
    const row = grantRow(grant({ status: 'expired', acceptedAt: null, lastViewedAt: null }), NOW, 'en', TZ);
    expect(row).toMatchObject({ chip: 'expired', action: 'inviteAgain' });
    expect(row.meta).toEqual([{ key: 'hosted.sharing.accountants.expiredMeta' }]);
  });
});

const err = (status: number, code: ConstructorParameters<typeof ApiError>[1], details: unknown = null) => new ApiError(status, code, code, details);

describe('inviteErrorOf: every refusal in its slot', () => {
  it.each([
    ['SELF_INVITE', err(422, 'VALIDATION_FAILED', { reason: 'SELF_INVITE' }), { field: 'hosted.sharing.invite.errors.self' }],
    ['INVITE_ADDRESS_REFUSED', err(422, 'VALIDATION_FAILED', { reason: 'INVITE_ADDRESS_REFUSED' }), { field: 'hosted.sharing.invite.errors.refused' }],
    ['not an address', err(422, 'VALIDATION_FAILED', [{ path: ['email'] }]), { field: 'hosted.sharing.invite.errors.invalid' }],
    ['ALREADY_INVITED', err(409, 'CONFLICT', { reason: 'ALREADY_INVITED' }), { banner: { key: 'hosted.sharing.invite.errors.already', vars: { email: 'sami@khoury-cpa.com' } } }],
    ['ACCOUNTANT_LIMIT', err(409, 'CONFLICT', { reason: 'ACCOUNTANT_LIMIT', limit: 5 }), { banner: { key: 'hosted.sharing.invite.errors.limit', vars: { limit: '5' } }, refetch: true }],
    ['NOT_OWNER', err(403, 'READ_ONLY_PROFILE', { reason: 'NOT_OWNER' }), { banner: { key: 'hosted.sharing.invite.errors.notOwner' }, refetch: true }],
    ['a gone profile or access off', err(404, 'NOT_FOUND'), { banner: { key: 'hosted.sharing.invite.errors.gone' }, refetch: true }],
    ['the lapse gate', err(402, 'SUBSCRIPTION_LAPSED'), { banner: { key: 'hosted.billing.gate.drawerNote' } }],
    ['too many this hour', err(429, 'RATE_LIMITED'), { banner: { key: 'hosted.sharing.invite.errors.rate' } }],
    ['the network', err(0, 'NETWORK'), { banner: { key: 'hosted.sharing.invite.errors.unreachable' } }],
    ['anything else', new Error('boom'), { banner: { key: 'hosted.sharing.invite.errors.unreachable' } }],
  ])('%s', (_label, error, expected) => {
    expect(inviteErrorOf(error, 'sami@khoury-cpa.com')).toEqual(expected);
  });
});

describe('revokeErrorOf', () => {
  it('a grant already gone counts as done (someone stopped it elsewhere)', () => {
    expect(revokeErrorOf(err(404, 'NOT_FOUND'))).toEqual({ done: true });
  });

  it('anything else puts the row back and says so', () => {
    expect(revokeErrorOf(err(0, 'NETWORK'))).toEqual({ done: false, toast: 'hosted.sharing.accountants.revokeFailed' });
    expect(revokeErrorOf(err(403, 'READ_ONLY_PROFILE', { reason: 'NOT_OWNER' }))).toEqual({ done: false, toast: 'hosted.sharing.invite.errors.notOwner' });
  });
});
