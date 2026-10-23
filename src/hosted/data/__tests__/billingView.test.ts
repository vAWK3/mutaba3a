import { describe, expect, it } from 'vitest';
import type { BillingEntitlement, BillingOverview } from '../../api/client';
import { billingViewOf, checkoutRouteOf, currencyOfCountry, daysLeft, firstChargeOf, isConfirmed, profilesListOf, yearlySavingOf, type BillingProfile } from '../billingView';

/**
 * MUT-362 (plan §2.7, design review DR1–DR12): which panel the Billing drawer shows, its one action, and the small
 * rules beside it. Pure: the drawer only renders what these return.
 */

const NOW = new Date('2026-11-01T09:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const iso = (days: number) => new Date(NOW.getTime() + days * DAY).toISOString();

const overview = (over: Partial<BillingOverview> = {}): BillingOverview => ({
  configured: true,
  subscription: null,
  canManage: false,
  trial: null,
  catalog: { ILS: { month: 3900, year: 39000 }, USD: { month: 1000, year: 10000 } },
  countries: { consumer: ['IL', 'GB'], customTaxId: ['IL', 'JO'] },
  coveredProfileIds: [],
  ...over,
});
const sub = (over: Partial<NonNullable<BillingOverview['subscription']>> = {}): NonNullable<BillingOverview['subscription']> => ({
  tier: 'FREELANCER',
  status: 'active',
  interval: 'month',
  currency: 'ILS',
  currentPeriodEnd: iso(20),
  cancelAtPeriodEnd: false,
  ...over,
});
const ent = (state: BillingEntitlement['state'], source: BillingEntitlement['source'], until: string | null = null): BillingEntitlement => ({ state, source, tier: 'FREELANCER', until });
const profile = (billing: BillingEntitlement | null, owned = true, name = 'Personal'): BillingProfile => ({ id: name, name, owned, billing });

describe('billingViewOf: a subscription decides first', () => {
  it('active → renews, Manage billing', () => {
    expect(billingViewOf(overview({ subscription: sub(), canManage: true }), [profile(ent('ACTIVE', 'STRIPE', iso(20)))], NOW)).toMatchObject({
      panel: { kind: 'active', renewsAt: iso(20), interval: 'month' },
      action: 'manage',
    });
  });

  it('cancelled at period end → ending, Manage billing', () => {
    expect(billingViewOf(overview({ subscription: sub({ cancelAtPeriodEnd: true }), canManage: true }), [profile(ent('ACTIVE', 'STRIPE'))], NOW)).toMatchObject({
      panel: { kind: 'ending', endsAt: iso(20) },
      action: 'manage',
    });
  });

  it('past_due → grace, Manage billing', () => {
    expect(billingViewOf(overview({ subscription: sub({ status: 'past_due' }), canManage: true }), [profile(ent('GRACE', 'STRIPE'))], NOW)).toMatchObject({ panel: { kind: 'grace' }, action: 'manage' });
  });

  it('unpaid → pay the open invoice in Manage billing (eng review D6)', () => {
    expect(billingViewOf(overview({ subscription: sub({ status: 'unpaid' }), canManage: true }), [profile(ent('READ_ONLY', 'STRIPE'))], NOW)).toMatchObject({
      panel: { kind: 'unpaid' },
      action: 'payInPortal',
    });
  });

  it('paused → contact us', () => {
    expect(billingViewOf(overview({ subscription: sub({ status: 'paused' }), canManage: true }), [profile(ent('READ_ONLY', 'STRIPE'))], NOW)).toMatchObject({ panel: { kind: 'needsHelp' }, action: 'contactUs' });
  });

  it('incomplete (first payment pending, SCA) is its own pending panel, never “Active” (review)', () => {
    expect(billingViewOf(overview({ subscription: sub({ status: 'incomplete' }), canManage: true }), [profile(ent('READ_ONLY', 'TRIAL'))], NOW)).toMatchObject({
      panel: { kind: 'pending' },
      action: 'manage',
    });
  });

  it('only a paid status ends the return-from-Checkout poll', () => {
    expect(['active', 'trialing', 'past_due'].every((s) => isConfirmed(sub({ status: s })))).toBe(true);
    expect(['incomplete', 'unpaid', 'canceled'].some((s) => isConfirmed(sub({ status: s })))).toBe(false);
    expect(isConfirmed(null)).toBe(false);
  });

  it('a cancelled subscription falls through to the profiles: lapsed, Subscribe again', () => {
    expect(billingViewOf(overview({ subscription: sub({ status: 'canceled' }), canManage: true }), [profile(ent('READ_ONLY', 'STRIPE'))], NOW)).toMatchObject({ panel: { kind: 'lapsed' }, action: 'subscribe' });
  });
});

describe('billingViewOf: otherwise the owned profiles decide', () => {
  it('a trial shows days left and its end; Subscribe', () => {
    const view = billingViewOf(overview({ trial: { startedAt: iso(-5), endsAt: iso(9), lockAt: iso(25) } }), [profile(ent('ACTIVE', 'TRIAL', iso(9)))], NOW);
    expect(view).toMatchObject({ panel: { kind: 'trial', endsAt: iso(9), daysLeft: 9 }, action: 'subscribe', openSoon: false });
  });

  it('a trial that ended is read-only until the lock date; then locked', () => {
    expect(billingViewOf(overview(), [profile(ent('READ_ONLY', 'TRIAL', iso(10)))], NOW)).toMatchObject({ panel: { kind: 'trialEnded', lockAt: iso(10) }, action: 'subscribe' });
    expect(billingViewOf(overview(), [profile(ent('LOCKED', 'TRIAL'))], NOW)).toMatchObject({ panel: { kind: 'locked' }, action: 'subscribe' });
  });

  it('a no-expiry grant is covered, with nothing to do (eng review D5); an expiring one may subscribe', () => {
    expect(billingViewOf(overview(), [profile(ent('ACTIVE', 'OPERATOR'))], NOW)).toMatchObject({ panel: { kind: 'coveredByGrant', until: null }, action: null });
    expect(billingViewOf(overview(), [profile(ent('ACTIVE', 'OPERATOR', iso(30)))], NOW)).toMatchObject({ panel: { kind: 'coveredByGrant', until: iso(30) }, action: 'subscribe' });
  });

  it('only Malafat-covered profiles are never priced', () => {
    expect(billingViewOf(overview(), [profile(ent('ACTIVE', 'MALAFAT'))], NOW)).toMatchObject({ panel: { kind: 'coveredByMalafat' }, action: null });
  });

  it('a person who owns no profile sees whose plan covers them', () => {
    expect(billingViewOf(overview(), [profile(ent('ACTIVE', 'STRIPE'), false)], NOW)).toMatchObject({ panel: { kind: 'ownedByOthers' }, action: null });
  });

  it('a profile paid through Stripe with no subscription row shown still offers Manage billing, never Subscribe (review)', () => {
    expect(billingViewOf(overview({ canManage: true }), [profile(ent('ACTIVE', 'STRIPE', iso(12)))], NOW)).toMatchObject({
      panel: { kind: 'active', renewsAt: iso(12), interval: null },
      action: 'manage',
    });
    expect(billingViewOf(overview({ canManage: true }), [profile(ent('GRACE', 'STRIPE', iso(2)))], NOW)).toMatchObject({ panel: { kind: 'grace' }, action: 'manage' });
  });

  it('nothing at all → Subscribe', () => {
    expect(billingViewOf(overview(), [profile(ent('READ_ONLY', 'NONE'))], NOW)).toMatchObject({ panel: { kind: 'none' }, action: 'subscribe' });
  });
});

describe('open soon (design review DR4/DR5)', () => {
  it('no Stripe on the server, or no prices: Subscribe becomes "open soon"', () => {
    const trialing = [profile(ent('ACTIVE', 'TRIAL', iso(9)))];
    expect(billingViewOf(overview({ configured: false, catalog: { ILS: null, USD: null } }), trialing, NOW)).toMatchObject({ action: 'subscribe', openSoon: true });
    expect(billingViewOf(overview({ catalog: { ILS: null, USD: null } }), trialing, NOW)).toMatchObject({ action: 'subscribe', openSoon: true });
    expect(billingViewOf(overview({ catalog: { ILS: null, USD: { month: 1000, year: 10000 } } }), trialing, NOW)).toMatchObject({ openSoon: false });
  });

  it('Manage billing never waits on prices', () => {
    expect(billingViewOf(overview({ subscription: sub(), canManage: true, catalog: { ILS: null, USD: null } }), [profile(ent('ACTIVE', 'STRIPE'))], NOW)).toMatchObject({ action: 'manage', openSoon: false });
  });
});

describe('profilesListOf (design review DR3)', () => {
  it('shows only when the profiles’ states differ', () => {
    expect(profilesListOf([profile(ent('ACTIVE', 'TRIAL')), profile(ent('ACTIVE', 'TRIAL'), true, 'Studio')])).toEqual([]);
    const mixed = [profile(ent('ACTIVE', 'TRIAL')), profile(ent('ACTIVE', 'MALAFAT'), true, 'Firm')];
    expect(profilesListOf(mixed).map((p) => p.name)).toEqual(['Personal', 'Firm']);
    expect(profilesListOf([profile(ent('ACTIVE', 'TRIAL'))])).toEqual([]);
  });
});

describe('the Subscribe step’s rules', () => {
  const countries = overview().countries;

  it('checkoutRouteOf: nothing before a country is chosen (DR11), contact us for a person outside the list', () => {
    expect(checkoutRouteOf(null, 'person', countries)).toBeNull();
    expect(checkoutRouteOf('IL', 'person', countries)).toBe('card');
    expect(checkoutRouteOf('JO', 'person', countries)).toBe('contact-us');
    expect(checkoutRouteOf('JO', 'business', countries)).toBe('card-tax-number');
    expect(checkoutRouteOf('AE', 'business', countries)).toBe('card-tax-id');
    expect(checkoutRouteOf('GB', 'business', countries)).toBe('card');
  });

  it('currency follows the country: shekels in Israel, dollars elsewhere', () => {
    expect(currencyOfCountry('IL')).toBe('ILS');
    expect(currencyOfCountry('PS')).toBe('USD');
  });

  it('the yearly note is computed, never hard-coded (DR7)', () => {
    expect(yearlySavingOf({ month: 3900, year: 39000 })).toEqual({ kind: 'monthsFree', months: 2 });
    expect(yearlySavingOf({ month: 3900, year: 42000 })).toEqual({ kind: 'save', amount: 4800 });
    expect(yearlySavingOf({ month: 3900, year: 46800 })).toBeNull();
  });

  it('firstChargeOf: subscribing in the trial is charged on its end, when that is 48 h or more away (review D2)', () => {
    expect(firstChargeOf(overview({ trial: { startedAt: iso(-4), endsAt: iso(10), lockAt: iso(26) } }), NOW)).toBe(iso(10));
    expect(firstChargeOf(overview({ trial: { startedAt: iso(-13), endsAt: iso(1), lockAt: iso(17) } }), NOW)).toBeNull();
    expect(firstChargeOf(overview({ trial: { startedAt: iso(-20), endsAt: iso(-6), lockAt: iso(10) } }), NOW)).toBeNull();
    expect(firstChargeOf(overview(), NOW)).toBeNull();
  });

  it('days left round up, never below zero', () => {
    expect(daysLeft(iso(9), NOW)).toBe(9);
    expect(daysLeft(new Date(NOW.getTime() + 2 * 60 * 60 * 1000).toISOString(), NOW)).toBe(1);
    expect(daysLeft(iso(-1), NOW)).toBe(0);
  });
});
