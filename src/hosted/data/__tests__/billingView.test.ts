import { describe, expect, it } from 'vitest';
import type { BillingEntitlement, BillingOffer, BillingOverview } from '../../api/client';
import {
  billingViewOf,
  canCancelOf,
  canKeepOf,
  checkoutRouteOf,
  currencyOfCountry,
  daysLeft,
  eligibleOfferOf,
  firstChargeOf,
  isConfirmed,
  isSellable,
  monthPriceOf,
  offerAnalyticsName,
  offerFor,
  profilesListOf,
  renewalPriceOf,
  yearlySavingOf,
  yearlySwitchLineOf,
  type BillingProfile,
} from '../billingView';

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
  countries: { consumer: ['IL', 'GB'], consumerEverywhere: false, customTaxId: ['IL', 'JO'] },
  coveredProfileIds: [],
  offer: null,
  yearlySwitch: null,
  ...over,
});
const sub = (over: Partial<NonNullable<BillingOverview['subscription']>> = {}): NonNullable<BillingOverview['subscription']> => ({
  tier: 'FREELANCER',
  status: 'active',
  interval: 'month',
  currency: 'ILS',
  currentPeriodEnd: iso(20),
  cancelAtPeriodEnd: false,
  renewsAtListPrice: false,
  offer: null,
  ...over,
});
const ent = (state: BillingEntitlement['state'], source: BillingEntitlement['source'], until: string | null = null): BillingEntitlement => ({ state, source, tier: 'FREELANCER', until });
const profile = (billing: BillingEntitlement | null, owned = true, name = 'Personal'): BillingProfile => ({ id: name, name, owned, billing });

describe('MUT-418: consumers everywhere and a card added in the trial', () => {
  it('checkoutRouteOf: with consumerEverywhere a person anywhere goes to the card; a business still proves it is one', () => {
    const everywhere = { consumer: [], consumerEverywhere: true, customTaxId: ['IL', 'JO'] };
    for (const country of ['JO', 'US', 'AE', 'IL']) expect(checkoutRouteOf(country, 'person', everywhere), country).toBe('card');
    expect(checkoutRouteOf('JO', 'business', everywhere)).toBe('card-tax-number');
    expect(checkoutRouteOf('AE', 'business', everywhere)).toBe('card-tax-id');
  });

  it('an older server with no consumerEverywhere reads as the list alone', () => {
    expect(checkoutRouteOf('JO', 'person', { consumer: ['IL'], customTaxId: [] } as unknown as BillingOverview['countries'])).toBe('contact-us');
  });

  it('trialing → "Card added", the first charge on the period end (= the trial end), Manage billing', () => {
    expect(billingViewOf(overview({ subscription: sub({ status: 'trialing', currentPeriodEnd: iso(13) }), canManage: true }), [profile(ent('ACTIVE', 'STRIPE', iso(13)))], NOW)).toMatchObject({
      panel: { kind: 'activeTrial', firstChargeAt: iso(13) },
      action: 'manage',
    });
    // Cancelling inside the trial still reads as ending on that date.
    expect(billingViewOf(overview({ subscription: sub({ status: 'trialing', cancelAtPeriodEnd: true, currentPeriodEnd: iso(13) }) }), [], NOW).panel).toEqual({ kind: 'ending', endsAt: iso(13) });
  });

  it('isSellable: Stripe configured and at least one price pair', () => {
    expect(isSellable(overview())).toBe(true);
    expect(isSellable(overview({ configured: false }))).toBe(false);
    expect(isSellable(overview({ catalog: { ILS: null, USD: null } }))).toBe(false);
  });
});

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

  it('past_due → grace, Update card (MUT-533 D5: straight to Stripe’s card form)', () => {
    expect(billingViewOf(overview({ subscription: sub({ status: 'past_due' }), canManage: true }), [profile(ent('GRACE', 'STRIPE'))], NOW)).toMatchObject({ panel: { kind: 'grace' }, action: 'updateCard' });
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
    expect(billingViewOf(overview({ canManage: true }), [profile(ent('GRACE', 'STRIPE', iso(2)))], NOW)).toMatchObject({ panel: { kind: 'grace' }, action: 'updateCard' });
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
    // MUT-418 D10: a business proves it is one even where a person needs nothing.
    expect(checkoutRouteOf('GB', 'business', countries)).toBe('card-tax-id');
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

describe('MUT-525: the launch offer (R5, DD3, DD10a, DD10d)', () => {
  // 23:59 Asia/Jerusalem on 31 January 2027 (UTC+2 in winter): the coupon's redeem_by − 1 h.
  const ENDS_AT = '2027-01-31T21:59:00.000Z';
  const offer = (over: Partial<BillingOffer> = {}): BillingOffer => ({
    id: 'launch-2026',
    percentOff: 50,
    endsAt: ENDS_AT,
    interval: 'year',
    eligible: true,
    firstYear: { ILS: 14500, USD: 4500 },
    ...over,
  });
  const priced = (over: Partial<BillingOverview> = {}) =>
    overview({ catalog: { ILS: { month: 2900, year: 29000 }, USD: { month: 900, year: 9000 } }, offer: offer(), ...over });

  it('an eligible yearly offer: the list and first-year amounts from the server, never computed here', () => {
    expect(offerFor(priced(), 'ILS', NOW)).toEqual({
      id: 'launch-2026',
      percentOff: 50,
      list: 29000,
      firstYear: 14500,
      endsAt: ENDS_AT,
      renewsOn: '2027-11-01T09:00:00.000Z',
      firstChargeAt: null,
      endsToday: false,
    });
    expect(offerFor(priced(), 'USD', NOW)).toMatchObject({ list: 9000, firstYear: 4500 });
  });

  it('no offer for someone not eligible, a monthly offer, no offer at all, or before a currency is known', () => {
    expect(offerFor(priced({ offer: offer({ eligible: false }) }), 'ILS', NOW)).toBeNull();
    expect(offerFor(priced({ offer: offer({ interval: 'month' }) }), 'ILS', NOW)).toBeNull();
    expect(offerFor(priced({ offer: null }), 'ILS', NOW)).toBeNull();
    expect(offerFor(priced(), null, NOW)).toBeNull();
  });

  it('no offer in a currency without its first-year amount or its list price', () => {
    expect(offerFor(priced({ offer: offer({ firstYear: { ILS: null, USD: 4500 } }) }), 'ILS', NOW)).toBeNull();
    expect(offerFor(priced({ catalog: { ILS: null, USD: { month: 900, year: 9000 } } }), 'ILS', NOW)).toBeNull();
    expect(offerFor(priced({ offer: offer({ firstYear: { ILS: null, USD: 4500 } }) }), 'USD', NOW)).not.toBeNull();
  });

  it('a carried trial (48 h or more left) is charged on its end, and the list price a year after it', () => {
    const view = offerFor(priced({ trial: { startedAt: iso(-4), endsAt: iso(10), lockAt: iso(26) } }), 'ILS', NOW);
    expect(view).toMatchObject({ firstChargeAt: iso(10), renewsOn: '2027-11-11T09:00:00.000Z' });
    // Under 48 h left: charged today, renewed a year from today.
    expect(offerFor(priced({ trial: { startedAt: iso(-13), endsAt: iso(1), lockAt: iso(17) } }), 'ILS', NOW)).toMatchObject({
      firstChargeAt: null,
      renewsOn: '2027-11-01T09:00:00.000Z',
    });
  });

  it('endsToday on the last calendar day in Jerusalem, whatever the UTC date', () => {
    // 31 Jan 00:30 Jerusalem is still 30 Jan in UTC.
    expect(offerFor(priced(), 'ILS', new Date('2027-01-30T22:30:00Z'))?.endsToday).toBe(true);
    expect(offerFor(priced(), 'ILS', new Date('2027-01-31T21:00:00Z'))?.endsToday).toBe(true);
    // 30 Jan 23:30 Jerusalem: the day before.
    expect(offerFor(priced(), 'ILS', new Date('2027-01-30T21:30:00Z'))?.endsToday).toBe(false);
  });

  it('eligibleOfferOf: the offer before a currency is chosen, only while one currency can take it', () => {
    expect(eligibleOfferOf(priced())?.id).toBe('launch-2026');
    expect(eligibleOfferOf(priced({ offer: offer({ eligible: false }) }))).toBeNull();
    expect(eligibleOfferOf(priced({ offer: offer({ firstYear: { ILS: null, USD: null } }) }))).toBeNull();
    expect(eligibleOfferOf(overview())).toBeNull();
    // A server older than MUT-525 sends no field.
    expect(eligibleOfferOf({ ...priced(), offer: undefined } as unknown as BillingOverview)).toBeNull();
  });

  it('offerAnalyticsName: the contract\'s snake_case enum value', () => {
    expect(offerAnalyticsName('launch-2026')).toBe('launch_2026');
  });

  it('renewalPriceOf (DD3): a list-price subscription renews at the catalog price of its interval and currency', () => {
    expect(renewalPriceOf(overview({ subscription: sub({ renewsAtListPrice: true, interval: 'year', currency: 'ILS' }) }))).toEqual({ minor: 39000, currency: 'ILS' });
    expect(renewalPriceOf(overview({ subscription: sub({ renewsAtListPrice: true, interval: 'month', currency: 'USD' }) }))).toEqual({ minor: 1000, currency: 'USD' });
    // A founder price keeps today's copy; so does an unknown interval or currency, or a plan that ends.
    expect(renewalPriceOf(overview({ subscription: sub({ renewsAtListPrice: false }) }))).toBeNull();
    expect(renewalPriceOf(overview({ subscription: sub({ renewsAtListPrice: true, interval: null }) }))).toBeNull();
    expect(renewalPriceOf(overview({ subscription: sub({ renewsAtListPrice: true, currency: 'EUR' }) }))).toBeNull();
    expect(renewalPriceOf(overview({ subscription: sub({ renewsAtListPrice: true, cancelAtPeriodEnd: true }) }))).toBeNull();
    expect(renewalPriceOf(overview())).toBeNull();
  });
});

describe('yearlySwitchLineOf (MUT-531 AC2)', () => {
  const line = { currency: 'ILS' as const, savings: 5800 };

  it('shows the server’s line on an active monthly plan', () => {
    expect(yearlySwitchLineOf(overview({ subscription: sub({ status: 'active', interval: 'month' }), yearlySwitch: line }))).toEqual(line);
  });

  it('hides it on a yearly, cancelling or unpaid plan, and when the server sends none', () => {
    expect(yearlySwitchLineOf(overview({ subscription: sub({ interval: 'year' }), yearlySwitch: line }))).toBeNull();
    expect(yearlySwitchLineOf(overview({ subscription: sub({ cancelAtPeriodEnd: true }), yearlySwitch: line }))).toBeNull();
    expect(yearlySwitchLineOf(overview({ subscription: sub({ status: 'past_due' }), yearlySwitch: line }))).toBeNull();
    expect(yearlySwitchLineOf(overview({ subscription: sub(), yearlySwitch: null }))).toBeNull();
    expect(yearlySwitchLineOf(overview({ subscription: null, yearlySwitch: line }))).toBeNull();
  });
});

describe('MUT-532: the pause panels and the plan’s own changes (D6–D8)', () => {
  const sub = (over: Partial<NonNullable<BillingOverview['subscription']>> = {}) => ({
    tier: 'FREELANCER' as const,
    status: 'active',
    interval: 'month' as const,
    currency: 'ILS',
    currentPeriodEnd: iso(12),
    cancelAtPeriodEnd: false,
    renewsAtListPrice: true,
    offer: null,
    pause: null,
    ...over,
  });
  const view = (over: Partial<NonNullable<BillingOverview['subscription']>>) => billingViewOf(overview({ subscription: sub(over) }), [], NOW);

  it('a pause still to come is booked; a running one is paused until it restarts; after it, active again', () => {
    expect(view({ pause: { from: iso(12), until: iso(72) } }).panel).toEqual({ kind: 'pauseScheduled', from: iso(12), until: iso(72) });
    expect(view({ pause: { from: iso(-1), until: iso(40) } }).panel).toEqual({ kind: 'paused', until: iso(40) });
    expect(view({ pause: { from: iso(-1), until: null } }).panel).toEqual({ kind: 'paused', until: null });
    expect(view({ pause: { from: iso(-40), until: iso(-1) } }).panel).toMatchObject({ kind: 'active' });
    expect(view({ pause: { from: iso(-1), until: iso(40) } }).action).toBe('manage');
  });

  it('a cancel wins over a pause: the plan ends', () => {
    expect(view({ cancelAtPeriodEnd: true, pause: { from: iso(-1), until: iso(40) } }).panel).toMatchObject({ kind: 'ending' });
  });

  it('Cancel plan: a list-price plan that renews and isn\'t pausing; never a founder price', () => {
    expect(canCancelOf({ subscription: sub() })).toBe(true);
    expect(canCancelOf({ subscription: sub({ status: 'trialing' }) })).toBe(true);
    expect(canCancelOf({ subscription: sub({ renewsAtListPrice: false }) })).toBe(false);
    expect(canCancelOf({ subscription: sub({ cancelAtPeriodEnd: true }) })).toBe(false);
    expect(canCancelOf({ subscription: sub({ pause: { from: iso(3), until: iso(40) } }) })).toBe(false);
    expect(canCancelOf({ subscription: sub({ status: 'past_due' }) })).toBe(false);
    expect(canCancelOf({ subscription: null })).toBe(false);
  });

  it('Keep my plan: a list-price plan that is cancelling', () => {
    expect(canKeepOf({ subscription: sub({ cancelAtPeriodEnd: true }) })).toBe(true);
    expect(canKeepOf({ subscription: sub() })).toBe(false);
    expect(canKeepOf({ subscription: sub({ cancelAtPeriodEnd: true, renewsAtListPrice: false }) })).toBe(false);
  });

  it('Resume now charges the catalog\'s month in the plan\'s currency', () => {
    expect(monthPriceOf(overview({ subscription: sub() }))).toEqual({ minor: 3900, currency: 'ILS' });
    expect(monthPriceOf(overview({ subscription: sub({ currency: 'USD' }) }))).toEqual({ minor: 1000, currency: 'USD' });
    expect(monthPriceOf(overview({ subscription: sub(), catalog: { ILS: null, USD: null } }))).toBeNull();
  });

  it('no switch-to-yearly line while a pause is set', () => {
    const line = { currency: 'ILS' as const, savings: 7800 };
    expect(yearlySwitchLineOf({ yearlySwitch: line, subscription: sub() })).toEqual(line);
    expect(yearlySwitchLineOf({ yearlySwitch: line, subscription: sub({ pause: { from: iso(3), until: iso(40) } }) })).toBeNull();
  });
});
