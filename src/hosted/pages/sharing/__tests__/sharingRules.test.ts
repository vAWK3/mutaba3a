import { describe, expect, it } from 'vitest';
import { ApiError, type AccountantGrant } from '../../../api/client';
import type { ShareLink } from '../../../api/client';
import { downloadErrorOf, monthName, monthOptions, monthSpan, foldDigits, grantRow, inviteErrorOf, isolate, linkErrorOf, linkRow, liveLinks, monthsLabel, periodRange, pinOf, relativeDay, revokeErrorOf, sharingOpen, shortDay } from '../sharingRules';

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
const meOn = { clients: [], user: { features: ['accountant_access'] } };

describe('sharingOpen (D8)', () => {
  it('opens for an owner, signed in, on a server with accountant access', () => {
    expect(sharingOpen(meOn, owner, false)).toBe(true);
  });

  it.each([
    ['a member of a firm profile', meOn, { owned: false }, false],
    ['accountant access off (no clients on /v1/me)', { user: { features: ['accountant_access'] } }, owner, false],
    ['MUT-577: the person without the accountant_access feature', { clients: [], user: { features: ['agent_access'] } }, owner, false],
    ['MUT-577: a server that names no features', { clients: [] }, owner, false],
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
    ['ALREADY_INVITED', err(409, 'CONFLICT', { reason: 'ALREADY_INVITED' }), { banner: { key: 'hosted.sharing.invite.errors.already', vars: { email: isolate('sami@khoury-cpa.com') } } }],
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

describe('review fixes', () => {
  it('(f) the limit falls back to the list when the refusal names none', () => {
    expect(inviteErrorOf(err(409, 'CONFLICT', { reason: 'ACCOUNTANT_LIMIT' }), 'x@y.co', 5).banner).toEqual({ key: 'hosted.sharing.invite.errors.limit', vars: { limit: '5' } });
    expect(inviteErrorOf(err(409, 'CONFLICT', { reason: 'ACCOUNTANT_LIMIT', limit: 4 }), 'x@y.co', 5).banner?.vars).toEqual({ limit: '4' });
  });

  it('(d) isolates a person\'s text with FSI … PDI', () => {
    expect(isolate('سامي')).toBe('\u2068سامي\u2069');
  });
});

describe('periodRange (D9, pinned to the server\'s documented examples)', () => {
  it.each([
    ['LAST_1_MONTH', '2026-11-06', { from: '2026-10-01', to: '2026-10-31' }],
    ['LAST_2_MONTHS', '2026-11-06', { from: '2026-09-01', to: '2026-10-31' }],
    ['LAST_3_MONTHS', '2026-11-06', { from: '2026-08-01', to: '2026-10-31' }],
    ['WHOLE_PROFILE', '2026-11-06', { from: null, to: '2026-11-06' }],
    ['LAST_2_MONTHS', '2027-01-01', { from: '2026-11-01', to: '2026-12-31' }],
    ['LAST_1_MONTH', '2026-03-15', { from: '2026-02-01', to: '2026-02-28' }],
  ] as const)('%s on %s', (period, today, range) => {
    expect(periodRange(period, today)).toEqual(range);
  });
});

describe('monthsLabel (OW3)', () => {
  it('names whole months, one year once, across a year both', () => {
    expect(monthsLabel('2026-10-01', '2026-10-31', 'en')).toBe('Oct 2026');
    expect(monthsLabel('2026-09-01', '2026-10-31', 'en')).toBe('Sep – Oct 2026');
    expect(monthsLabel('2026-08-01', '2026-10-31', 'en')).toBe('Aug – Oct 2026');
    expect(monthsLabel('2025-12-01', '2026-01-31', 'en')).toBe('Dec 2025 – Jan 2026');
    expect(monthsLabel(null, '2026-11-06', 'en')).toBeNull();
  });

  it('in Arabic, month names in Arabic with Western digits', () => {
    expect(monthsLabel('2026-08-01', '2026-10-31', 'ar')).toMatch(/^آب – تشرين الأول 2026$/);
  });
});

describe('the PIN', () => {
  it.each([
    ['4821', '4821'],
    ['12345678', '12345678'],
    ['٤٨٢١', '4821'],
    ['۴۸۲۱', '4821'],
    [' 4821 ', '4821'],
  ])('accepts %j as %j', (input, pin) => {
    expect(pinOf(input)).toBe(pin);
  });

  it.each(['123', '123456789', '12a4', '', '12 34'])('refuses %j', (input) => {
    expect(pinOf(input)).toBeNull();
  });

  it('folds both Arabic digit sets', () => {
    expect(foldDigits('٠١٢٣٤٥٦٧٨٩ ۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789 0123456789');
  });
});

const link = (overrides: Partial<ShareLink> = {}): ShareLink => ({
  id: 'l1',
  period: 'LAST_3_MONTHS',
  from: '2026-08-01',
  to: '2026-10-31',
  createdAt: '2026-11-05T09:00:00.000Z',
  expiresAt: '2026-11-13T09:00:00.000Z',
  lastOpenedAt: '2026-11-05T12:00:00.000Z',
  status: 'active',
  endedAt: null,
  viewers: 2,
  maxViewers: 3,
  createdByName: 'Nour Haddad',
  ...overrides,
});

describe('linkRow', () => {
  it('active: months, ends, last opened, viewers, Turn off', () => {
    expect(linkRow(link(), NOW, 'en', TZ)).toEqual({
      period: { key: 'hosted.sharing.links.months', vars: { months: 'Aug – Oct 2026' } },
      ends: 'Nov 13',
      ended: null,
      lastOpened: 'yesterday',
      viewers: '2 / 3',
      chip: 'active',
      canTurnOff: true,
    });
  });

  it('locked: chip Locked, still Turn off; never opened reads null', () => {
    expect(linkRow(link({ status: 'locked', endedAt: '2026-11-06T08:00:00.000Z', lastOpenedAt: null }), NOW, 'en', TZ)).toMatchObject({ chip: 'locked', canTurnOff: true, lastOpened: null });
  });

  it.each(['expired', 'revoked'] as const)('%s: Ended on its day, no action; whole profile worded', (status) => {
    const row = linkRow(link({ status, endedAt: '2026-11-01T10:00:00.000Z', period: 'WHOLE_PROFILE', from: null, to: '2026-10-25' }), NOW, 'en', TZ);
    expect(row).toMatchObject({ chip: 'ended', canTurnOff: false, ended: { key: 'hosted.sharing.links.ended', vars: { date: 'Nov 1' } }, period: { key: 'hosted.sharing.links.wholeProfile' } });
  });

  it('live links are the active and locked ones', () => {
    expect(liveLinks([link(), link({ status: 'locked' }), link({ status: 'revoked' }), link({ status: 'expired' })])).toBe(2);
  });
});

describe('linkErrorOf', () => {
  it.each([
    ['PIN_FORMAT', err(422, 'VALIDATION_FAILED', { reason: 'PIN_FORMAT', field: 'pin' }), { field: 'hosted.sharing.newLink.errors.pin' }],
    ['SHARE_LINK_LIMIT', err(409, 'CONFLICT', { reason: 'SHARE_LINK_LIMIT', limit: 3 }), { banner: { key: 'hosted.sharing.newLink.errors.limit', vars: { limit: '3' } }, refetch: true }],
    ['RATE_LIMITED', err(429, 'RATE_LIMITED'), { banner: { key: 'hosted.sharing.newLink.errors.rate' } }],
    ['the lapse gate', err(402, 'SUBSCRIPTION_LAPSED'), { banner: { key: 'hosted.billing.gate.drawerNote' } }],
    ['NOT_OWNER', err(403, 'READ_ONLY_PROFILE', { reason: 'NOT_OWNER' }), { banner: { key: 'hosted.sharing.invite.errors.notOwner' }, refetch: true }],
    ['the network', err(0, 'NETWORK'), { banner: { key: 'hosted.sharing.newLink.errors.unreachable' } }],
  ])('%s', (_label, error, expected) => {
    expect(linkErrorOf(error, 3)).toEqual(expected);
  });
});

describe('review 3: a link past its expiry while the page is open', () => {
  it('reads Ended on its expiry day, with no Turn off, though the list still says active', () => {
    const later = new Date('2026-11-13T09:00:01.000Z');
    expect(linkRow(link(), later, 'en', TZ)).toMatchObject({ chip: 'ended', canTurnOff: false, ended: { key: 'hosted.sharing.links.ended', vars: { date: 'Nov 13' } } });
    expect(liveLinks([link()], later)).toBe(0);
  });
});

describe('Download a period (MUT-314)', () => {
  it('offers this month and the 23 before it, newest first, across a year', () => {
    const months = monthOptions('2026-11-06');
    expect(months).toHaveLength(24);
    expect(months[0]).toBe('2026-11');
    expect(months[10]).toBe('2026-01');
    expect(months[11]).toBe('2025-12');
    expect(months[23]).toBe('2024-12');
  });

  it('counts whole months inclusively', () => {
    expect(monthSpan('2026-10', '2026-10')).toBe(1);
    expect(monthSpan('2025-12', '2026-02')).toBe(3);
    expect(monthSpan('2026-03', '2026-02')).toBe(0);
  });

  it('names a month', () => {
    expect(monthName('2026-10', 'en')).toBe('Oct 2026');
  });

  it.each([
    ['PERIOD_TOO_LARGE', err(422, 'VALIDATION_FAILED', { reason: 'PERIOD_TOO_LARGE', type: 'receipts', limit: 524288000, estimate: 600000000 }), 'hosted.sharing.download.errors.tooLarge'],
    ['PERIOD_RANGE', err(422, 'VALIDATION_FAILED', { reason: 'PERIOD_RANGE' }), 'hosted.sharing.download.errors.range'],
    ['RATE_LIMITED', err(429, 'RATE_LIMITED'), 'hosted.sharing.download.errors.rate'],
    ['gone', err(404, 'NOT_FOUND'), 'hosted.sharing.download.errors.gone'],
    ['the network', err(0, 'NETWORK'), 'hosted.sharing.download.errors.unreachable'],
  ])('%s', (_label, error, key) => {
    expect(downloadErrorOf(error)).toEqual({ key });
  });
});

