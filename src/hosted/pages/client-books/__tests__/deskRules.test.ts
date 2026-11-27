import { describe, expect, it } from 'vitest';
import type { AccountantClientWithStats, DeskCustomer } from '../deskRules';
import { buildDeskRows, filterCounts, matchesDeskFilter, matchesDeskRow, nextActionOf } from '../deskRules';

/**
 * MUT-768 (accountant channel, wireframe states): one row per client book, joined with the accountant's customers by
 * profile. The state is the word the badge shows; the next action is the ONE button on the row.
 */
const client = (over: Partial<AccountantClientWithStats> = {}): AccountantClientWithStats => ({
  profileId: 'p1',
  name: 'Café Nour',
  ownerName: 'Samer Haddad',
  sharedSince: '2026-11-01T09:00:00Z',
  profileType: 'BUSINESS',
  status: 'active',
  endedReason: null,
  endedAt: null,
  entriesThisMonth: 3,
  lastActivityAt: null,
  ...over,
});
const customer = (over: Partial<DeskCustomer> = {}): DeskCustomer => ({
  userId: 'u1',
  email: 'samer@cafenour.ps',
  displayName: 'Samer Haddad',
  profile: { id: 'p1', name: 'Café Nour' },
  provisionedAt: '2026-11-01T09:00:00Z',
  state: 'awaiting_claim',
  link: { expiresAt: '2026-11-15T09:00:00Z', mailStatus: 'SENT' },
  paid: false,
  ...over,
});
const stateOf = (c: DeskCustomer | null, activating: string[] = [], over: Partial<AccountantClientWithStats> = {}) =>
  buildDeskRows([client(over)], c ? [c] : [], new Set(activating))[0]!.state;

describe('desk row state', () => {
  it('is Active for a client book nobody provisioned, and Ended for one no longer shared', () => {
    expect(stateOf(null)).toBe('active');
    expect(stateOf(null, [], { status: 'ended', endedReason: 'revoked' })).toBe('ended');
  });

  it('follows the customer: awaiting claim, link expired, and a locked code needs a new code like an unclaimed one', () => {
    expect(stateOf(customer({ state: 'awaiting_claim' }))).toBe('await');
    expect(stateOf(customer({ state: 'code_locked' }))).toBe('await');
    expect(stateOf(customer({ state: 'link_expired' }))).toBe('expired');
  });

  it('is Needs card once claimed and not paid, Activating while we wait for Stripe, Active once paid', () => {
    expect(stateOf(customer({ state: 'claimed', paid: false }))).toBe('card');
    expect(stateOf(customer({ state: 'claimed', paid: false }), ['u1'])).toBe('activating');
    expect(stateOf(customer({ state: 'claimed', paid: true }), ['u1'])).toBe('active');
  });

  it('lets Ended win over everything, so a removed share never offers setup actions', () => {
    expect(stateOf(customer({ state: 'awaiting_claim' }), [], { status: 'ended' })).toBe('ended');
  });
});

describe('desk rows', () => {
  it('lists a customer whose profile is not among the client books, by the customer’s own name', () => {
    const rows = buildDeskRows([], [customer({ profile: null })], new Set());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ state: 'await', name: 'Samer Haddad', email: 'samer@cafenour.ps', client: null });
  });

  it('joins on the profile, carrying the client book’s name and owner and the customer’s email', () => {
    const [row] = buildDeskRows([client()], [customer()], new Set());
    expect(row).toMatchObject({ key: 'p1', name: 'Café Nour', ownerName: 'Samer Haddad', email: 'samer@cafenour.ps' });
    expect(row!.client).not.toBeNull();
    expect(row!.customer?.userId).toBe('u1');
  });

  it('keeps the client books in their order and puts customers without a book after them', () => {
    const rows = buildDeskRows([client({ profileId: 'b' }), client({ profileId: 'a' })], [customer({ userId: 'x', profile: { id: 'zz', name: 'Z' } })], new Set());
    expect(rows.map((r) => r.key)).toEqual(['b', 'a', 'x']);
  });
});

describe('the one next action', () => {
  it('is New code, Resend link or Take card, and nothing for a row that needs none', () => {
    expect(nextActionOf('await')).toBe('newCode');
    expect(nextActionOf('expired')).toBe('resend');
    expect(nextActionOf('card')).toBe('takeCard');
    expect(nextActionOf('activating')).toBeNull();
    expect(nextActionOf('active')).toBeNull();
    expect(nextActionOf('ended')).toBeNull();
  });
});

describe('filters and counts', () => {
  const rows = buildDeskRows(
    [client({ profileId: 'a' }), client({ profileId: 'b' }), client({ profileId: 'c' }), client({ profileId: 'd' }), client({ profileId: 'e', status: 'ended' })],
    [
      customer({ userId: 'ua', profile: { id: 'a', name: 'A' }, state: 'awaiting_claim' }),
      customer({ userId: 'ub', profile: { id: 'b', name: 'B' }, state: 'link_expired' }),
      customer({ userId: 'uc', profile: { id: 'c', name: 'C' }, state: 'claimed', paid: false }),
    ],
    new Set(),
  );

  it('counts All, Awaiting claim (unclaimed and expired), Needs card and Active', () => {
    expect(filterCounts(rows)).toEqual({ all: 5, awaiting: 2, needcard: 1, active: 1 });
  });

  it('shows the rows of one filter', () => {
    const keys = (f: Parameters<typeof matchesDeskFilter>[1]) => rows.filter((r) => matchesDeskFilter(r, f)).map((r) => r.key);
    expect(keys('all')).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(keys('awaiting')).toEqual(['a', 'b']);
    expect(keys('needcard')).toEqual(['c']);
    expect(keys('active')).toEqual(['d']);
  });

  it('keeps Activating under Active, so it does not vanish while Stripe settles', () => {
    const activating = buildDeskRows([client()], [customer({ state: 'claimed' })], new Set(['u1']));
    expect(matchesDeskFilter(activating[0]!, 'active')).toBe(true);
    expect(matchesDeskFilter(activating[0]!, 'needcard')).toBe(false);
  });
});

describe('search', () => {
  const [row] = buildDeskRows([client()], [customer()], new Set());
  it('matches the business, the owner and the email, ignoring case, and everything on an empty query', () => {
    for (const q of ['café', 'SAMER', 'cafenour.ps', '']) expect(matchesDeskRow(row!, q), q).toBe(true);
    expect(matchesDeskRow(row!, 'jaber')).toBe(false);
  });
});
