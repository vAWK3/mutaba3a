import { describe, expect, it } from 'vitest';
import type { BillingEntitlement, BillingOverview } from '../../api/client';
import { billingViewOf, type BillingProfile } from '../billingView';
import { billingPilotEndedOf, billingPilotOf, pilotCurrencyOf, type BillingPilot } from '../pilot';
import { usageLineOf, usageLinesOf } from '../usageLines';

/** MUT-753: the Pilot panel's state, the plans' currency and the shared usage lines (butter from 90%). */

const NOW = new Date('2026-12-01T09:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const iso = (days: number) => new Date(NOW.getTime() + days * DAY).toISOString();

const PLANS: BillingPilot['plans'] = [
  { plan: 'solo', expectedMonthly: { ILS: 3900, USD: 1200 }, limits: { businesses: 1, partners: 0, documentsPerMonth: 50, scansPerMonth: 100 } },
  { plan: 'business', expectedMonthly: { ILS: 8900, USD: 2700 }, limits: { businesses: 3, partners: 2, documentsPerMonth: 250, scansPerMonth: 500 } },
  { plan: 'firm', expectedMonthly: { ILS: 24900, USD: 7500 }, limits: { businesses: 6, partners: 2, documentsPerMonth: 1000, scansPerMonth: 2000 } },
];
const pilot = (over: Partial<BillingPilot> = {}): BillingPilot => ({ cohort: 'dec-2026', startedAt: iso(-10), endsAt: iso(50), welcomeSeenAt: null, firstScanAt: null, firstInvoiceAt: null, pricesExpected: true, plans: PLANS, ...over });
const address = (country: string) => ({ country, line1: '', city: '', postalCode: '' });

const overview = (over: Partial<BillingOverview> = {}): BillingOverview =>
  ({
    configured: true,
    subscription: null,
    canManage: false,
    trial: null,
    catalog: { ILS: null, USD: null },
    countries: { consumer: [], consumerEverywhere: true, customTaxId: [] },
    coveredProfileIds: [],
    offer: null,
    yearlySwitch: null,
    ...over,
  }) as BillingOverview;
const ent = (state: BillingEntitlement['state'], source: BillingEntitlement['source'], until: string | null = null): BillingEntitlement => ({ state, source, tier: 'BUSINESS', until });
const mine = (billing: BillingEntitlement): BillingProfile[] => [{ id: 'p', name: 'Personal', owned: true, billing }];

describe('billingViewOf: the pilot', () => {
  it('day 1 to 46: the pilot panel with its end, no action', () => {
    const view = billingViewOf(overview({ pilot: pilot(), starter: { chosenAt: null, canContinueFree: false } }), mine(ent('ACTIVE', 'OPERATOR', iso(50))), NOW);
    expect(view).toEqual({ panel: { kind: 'pilot', endsAt: iso(50), daysLeft: 50, lastDays: false, thenStarter: true }, action: null, openSoon: false });
  });

  it('the last 14 days, and Starter off (the end lands on read-only)', () => {
    const view = billingViewOf(overview({ pilot: pilot({ endsAt: iso(14) }), starter: null }), mine(ent('ACTIVE', 'OPERATOR', iso(14))), NOW);
    expect(view.panel).toEqual({ kind: 'pilot', endsAt: iso(14), daysLeft: 14, lastDays: true, thenStarter: false });
    expect(billingViewOf(overview({ pilot: pilot({ endsAt: iso(15) }) }), mine(ent('ACTIVE', 'OPERATOR')), NOW).panel).toMatchObject({ lastDays: false });
  });

  it('a subscription still decides (a payment pending during the pilot)', () => {
    const subscription = { tier: 'BUSINESS', status: 'incomplete', interval: 'month', currency: 'ILS', currentPeriodEnd: iso(30), cancelAtPeriodEnd: false, renewsAtListPrice: true, offer: null } as BillingOverview['subscription'];
    expect(billingViewOf(overview({ pilot: pilot(), subscription }), mine(ent('ACTIVE', 'OPERATOR')), NOW).panel.kind).toBe('pending');
  });

  it('ended onto Starter: "Pilot ended", no action', () => {
    const view = billingViewOf(overview({ pilotEnded: { cohort: 'dec-2026', endedAt: iso(-2) } }), mine(ent('ACTIVE', 'STARTER')), NOW);
    expect(view).toEqual({ panel: { kind: 'pilotEnded', endedAt: iso(-2), onStarter: true }, action: null, openSoon: false });
  });

  it('ended onto read-only: "Pilot ended", keeping Subscribe', () => {
    const view = billingViewOf(overview({ pilotEnded: { cohort: 'dec-2026', endedAt: iso(-2) } }), mine(ent('READ_ONLY', 'STRIPE')), NOW);
    expect(view.panel).toEqual({ kind: 'pilotEnded', endedAt: iso(-2), onStarter: false });
    expect(view.action).toBe('subscribe');
  });

  it('an ended pilot never hides a plan the person is on (a new grant)', () => {
    const ended = { pilotEnded: { cohort: 'dec-2026', endedAt: iso(-2) } };
    expect(billingViewOf(overview(ended), mine(ent('ACTIVE', 'OPERATOR', iso(30))), NOW).panel.kind).toBe('coveredByGrant');
  });

  it('no pilot fields (an older server): nothing changes', () => {
    expect(billingPilotOf(undefined)).toBeNull();
    expect(billingPilotEndedOf(overview())).toBeNull();
    expect(billingViewOf(overview(), mine(ent('ACTIVE', 'STARTER')), NOW).panel.kind).toBe('starter');
  });
});

describe('pilotCurrencyOf', () => {
  it('ILS with no address or an Israeli one, USD elsewhere', () => {
    expect(pilotCurrencyOf(overview(), PLANS)).toBe('ILS');
    expect(pilotCurrencyOf(overview({ billingAddress: address('IL') }), PLANS)).toBe('ILS');
    expect(pilotCurrencyOf(overview({ billingAddress: address('JO') }), PLANS)).toBe('USD');
  });

  it('the other currency when the wanted one has no price', () => {
    const ilsOnly = PLANS.map((p) => ({ ...p, expectedMonthly: { ILS: p.expectedMonthly.ILS, USD: null } }));
    expect(pilotCurrencyOf(overview({ billingAddress: address('JO') }), ilsOnly)).toBe('ILS');
  });
});

describe('usage lines (design review 2B)', () => {
  it('butter from 90%, not at 89%, and stays so over the cap', () => {
    expect(usageLineOf('documents', 225, 250)).toMatchObject({ attention: true, percent: 90 });
    expect(usageLineOf('documents', 222, 250).attention).toBe(false);
    expect(usageLineOf('scans', 600, 500)).toMatchObject({ attention: true, percent: 100 });
    expect(usageLineOf('businesses', 0, 0)).toMatchObject({ attention: false, percent: 0 });
  });

  it('reads Business: documents, scans, businesses and the partners per business', () => {
    const billing = {
      usage: {
        month: '2026-12',
        resetsOn: '2027-01-01',
        plan: 'business',
        meters: [
          { meter: 'documents', used: 12, limit: 250, level: 'ok' },
          { meter: 'scans', used: 460, limit: 500, level: 'nudge' },
        ],
        businesses: { used: 1, limit: 3 },
        partners: { limit: 2 },
      },
    } as unknown as Pick<BillingOverview, 'usage'>;
    expect(usageLinesOf(billing)).toEqual({
      resetsOn: '2027-01-01',
      lines: [
        { key: 'documents', used: 12, cap: 250, attention: false, percent: 5 },
        { key: 'scans', used: 460, cap: 500, attention: true, percent: 92 },
        { key: 'businesses', used: 1, cap: 3, attention: false, percent: 33 },
      ],
      partnersPerBusiness: 2,
    });
  });

  it('a plan with no caps gives no lines; no usage gives null', () => {
    const billing = {
      usage: { month: '2026-12', resetsOn: '2027-01-01', plan: 'malafat', meters: [{ meter: 'documents', used: 3, limit: null, level: 'ok' }], businesses: { used: 1, limit: null }, partners: { limit: null } },
    } as unknown as Pick<BillingOverview, 'usage'>;
    expect(usageLinesOf(billing)).toEqual({ resetsOn: '2027-01-01', lines: [], partnersPerBusiness: null });
    expect(usageLinesOf(undefined)).toBeNull();
  });
});
