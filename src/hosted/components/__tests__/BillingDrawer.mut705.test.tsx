import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { ORG_A, ORG_B, emptyProfileRoutes, me, ok, profile, renderPortal, stubApi, type Handler } from '../../__tests__/harness';
import type { BillingEntitlement, BillingOverview, Me } from '../../api/client';
import { PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';

/**
 * MUT-705: the portal's three-plan picker, plan-aware billing, cap prompts and usage, through the real router, shell
 * and query client with /v1 stubbed.
 */

const DAY = 24 * 60 * 60 * 1000;
const iso = (days: number) => new Date(Date.now() + days * DAY).toISOString();
const PLANS: NonNullable<BillingOverview['plans']> = [
  { plan: 'solo', catalog: { ILS: { month: 3900, year: 39000 }, USD: { month: 1200, year: 12000 } }, limits: { businesses: 1, partners: 0, documentsPerMonth: 50, scansPerMonth: 100 } },
  { plan: 'business', catalog: { ILS: { month: 8900, year: 89000 }, USD: { month: 2700, year: 27000 } }, limits: { businesses: 3, partners: 2, documentsPerMonth: 250, scansPerMonth: 500 } },
  { plan: 'firm', catalog: { ILS: { month: 24900, year: 249000 }, USD: { month: 7500, year: 75000 } }, limits: { businesses: 6, partners: 2, documentsPerMonth: 1000, scansPerMonth: 2000 } },
];
type Level = 'ok' | 'near' | 'nudge' | 'at_cap';
type Plan = 'starter' | 'solo' | 'business' | 'firm';
const CAPS: Record<Plan, [number, number, number]> = { starter: [3, 12, 1], solo: [50, 100, 1], business: [250, 500, 3], firm: [1000, 2000, 6] };

function usage(plan: Plan, documents: [number, Level], scans: [number, Level] = [0, 'ok'], businesses = 1, graceUntil: string | null = null): BillingOverview['usage'] {
  const [d, s, b] = CAPS[plan];
  return {
    month: '2026-11',
    resetsOn: '2026-12-01',
    plan,
    meters: [
      { meter: 'documents', used: documents[0], limit: d, level: documents[1], graceUntil },
      { meter: 'scans', used: scans[0], limit: s, level: scans[1] },
    ],
    businesses: { used: businesses, limit: b },
    partners: { limit: 0 },
    gift: { available: true },
  };
}

const overview = (over: Partial<BillingOverview> = {}): BillingOverview =>
  ({
    configured: true,
    subscription: null,
    canManage: false,
    trial: null,
    catalog: { ILS: { month: 3900, year: 39000 }, USD: { month: 1200, year: 12000 } },
    countries: { consumer: [], consumerEverywhere: true, customTaxId: ['IL', 'JO'] },
    coveredProfileIds: [ORG_B, ORG_A],
    offer: null,
    yearlySwitch: null,
    currentPlan: 'starter',
    plans: PLANS,
    billingAddress: null,
    usage: usage('starter', [0, 'ok']),
    ...over,
  }) as BillingOverview;

const subscribed = (plan: Plan, over: Partial<BillingOverview> = {}): BillingOverview =>
  overview({
    currentPlan: plan,
    canManage: true,
    subscription: { tier: plan.toUpperCase() as 'SOLO', status: 'active', interval: 'month', currency: 'ILS', currentPeriodEnd: iso(20), cancelAtPeriodEnd: false, renewsAtListPrice: true, offer: null, pause: null },
    usage: usage(plan, [0, 'ok']),
    ...over,
  });

const STARTER: BillingEntitlement = { state: 'ACTIVE', source: 'STARTER', tier: 'STARTER', until: null } as BillingEntitlement;
const STRIPE = (tier: string): BillingEntitlement => ({ state: 'ACTIVE', source: 'STRIPE', tier, until: iso(20) }) as BillingEntitlement;
const personal = (billing: BillingEntitlement) => profile({ id: ORG_B, name: 'Personal', isPersonalDefault: true, owned: true, type: 'PERSONAL', writerOfRecord: null, billing });
const business = (id: string, name: string, billing: BillingEntitlement) => profile({ id, name, owned: true, type: 'BUSINESS', writerOfRecord: null, billing });

function portal(path: string, opts: { billing: BillingOverview; plan?: Me['plan']; profiles?: ReturnType<typeof profile>[]; maxOwned?: number; routes?: Record<string, Handler> }) {
  const base = me(opts.profiles ?? [personal(STARTER)], 'en');
  const body: Me = {
    ...base,
    limits: { ...base.limits, maxOwnedProfiles: opts.maxOwned ?? base.limits.maxOwnedProfiles },
    billingStanding: 'open',
    plan: opts.plan ?? { current: 'starter', businesses: null, soloTrialOffer: false },
  };
  const api = stubApi({ 'GET /v1/me': () => ok(body), 'GET /v1/billing': () => ok(opts.billing), ...emptyProfileRoutes(), ...opts.routes });
  return { ...renderPortal(path), api };
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
});

describe('the plan picker (AC1)', () => {
  it('opens on the smallest plan that covers the businesses the person owns', async () => {
    portal(`/p/${ORG_B}?billing=true&step=subscribe`, { billing: overview({ usage: usage('starter', [0, 'ok'], [0, 'ok'], 2) }) });
    const step = await screen.findByRole('dialog', { name: 'Subscribe' });
    expect(within(step).getByRole('radio', { name: /^Business/ })).toBeChecked();
  });

  it('opens on the plan an Upgrade asked for, and Firm says staff is coming', async () => {
    portal(`/p/${ORG_B}?billing=true&step=subscribe&billingPlan=firm`, { billing: overview() });
    const step = await screen.findByRole('dialog', { name: 'Subscribe' });
    expect(within(step).getByRole('radio', { name: /^Firm/ })).toBeChecked();
    expect(within(step).getByText('6 businesses · 1000 documents · 2000 scans a month · Staff: coming soon')).toBeInTheDocument();
  });
});

describe('Billing names the plan and shows its month (AC4)', () => {
  it('the headline names the plan; the meters show this month, and from 90% Upgrade to the next plan', async () => {
    portal(`/p/${ORG_B}?billing=true`, {
      billing: subscribed('business', { usage: usage('business', [230, 'nudge'], [41, 'ok'], 1) }),
      profiles: [personal(STRIPE('BUSINESS'))],
      plan: { current: 'business', businesses: null, soloTrialOffer: false },
    });
    const drawer = await screen.findByRole('dialog', { name: 'Billing' });
    expect(await within(drawer).findByRole('heading', { name: /^Business, renews/ })).toBeInTheDocument();
    const documents = within(drawer).getByTestId('meter-documents');
    expect(documents).toHaveTextContent('Documents this month');
    expect(documents).toHaveTextContent('230 of 250');
    expect(documents).toHaveAttribute('data-tone', 'butter');
    expect(within(documents).getByRole('button', { name: 'Upgrade to Firm' })).toBeInTheDocument();
    const scans = within(drawer).getByTestId('meter-scans');
    expect(scans).toHaveTextContent('41 of 500');
    expect(scans).not.toHaveAttribute('data-tone');
    expect(within(scans).queryByRole('button', { name: /^Upgrade/ })).toBeNull();
  });

  it('Firm never offers an upgrade, and the gift says until when', async () => {
    portal(`/p/${ORG_B}?billing=true`, {
      billing: subscribed('firm', { usage: usage('firm', [1000, 'at_cap'], [0, 'ok'], 1, '2026-11-30T22:00:00.000Z') }),
      profiles: [personal(STRIPE('FIRM'))],
      plan: { current: 'firm', businesses: null, soloTrialOffer: false },
    });
    const drawer = await screen.findByRole('dialog', { name: 'Billing' });
    const documents = await within(drawer).findByTestId('meter-documents');
    expect(documents).toHaveTextContent('No limit until Dec 1, 2026');
    expect(within(drawer).queryByRole('button', { name: /^Upgrade/ })).toBeNull();
  });
});

describe('read-only businesses (AC5)', () => {
  it('say why, and Choose which businesses stay active opens a checklist that counts to the plan’s number', async () => {
    const ids = ['44444444-4444-4444-8444-444444444441', '44444444-4444-4444-8444-444444444442', '44444444-4444-4444-8444-444444444443', '44444444-4444-4444-8444-444444444444'];
    const sub = STRIPE('BUSINESS');
    const { user, api } = portal(`/p/${ORG_B}?billing=true`, {
      billing: subscribed('business', { activeBusinesses: { cap: 3, active: ids.slice(0, 3), readOnly: [ids[3]], mustChoose: false } }),
      profiles: [personal(sub), ...ids.map((id, i) => business(id, `Studio ${i + 1}`, i === 3 ? ({ ...sub, state: 'READ_ONLY', planLimit: true } as BillingEntitlement) : sub))],
      plan: { current: 'business', businesses: { cap: 3, active: ids.slice(0, 3), readOnly: [ids[3]], mustChoose: false }, soloTrialOffer: false },
      routes: { 'PUT /v1/billing/active-businesses': () => ok({ active: [ids[0], ids[1], ids[3]], readOnly: [ids[2]] }) },
    });
    const drawer = await screen.findByRole('dialog', { name: 'Billing' });
    const section = await within(drawer).findByTestId('read-only-businesses');
    expect(section).toHaveTextContent('Business includes 3 businesses');
    expect(section).toHaveTextContent('Studio 4');
    await user.click(within(section).getByRole('button', { name: 'Choose which businesses stay active' }));
    const list = await within(drawer).findByTestId('business-checklist');
    expect(list).toHaveTextContent('3 of 3');
    expect(within(list).getByRole('checkbox', { name: /Studio 4/ })).toBeDisabled();
    await user.click(within(list).getByRole('checkbox', { name: /Studio 3/ }));
    expect(list).toHaveTextContent('2 of 3');
    await user.click(within(list).getByRole('checkbox', { name: /Studio 4/ }));
    await user.click(within(drawer).getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(api.calls.find((c) => c.url.pathname === '/v1/billing/active-businesses')).toBeTruthy());
  });
});

describe('cap prompts (AC3)', () => {
  it('a new business past Solo’s one names the next plan and its price, with one step up', async () => {
    const sub = STRIPE('SOLO');
    const { router } = portal(`/p/${ORG_B}?newProfile=true`, {
      billing: subscribed('solo'),
      profiles: [personal(sub), business(ORG_A, 'Studio', sub)],
      maxOwned: 2,
      plan: { current: 'solo', businesses: null, soloTrialOffer: false },
    });
    const notice = await screen.findByTestId('plan-limit-notice');
    expect(notice).toHaveTextContent('Solo includes 1 business');
    expect(await within(notice).findByTestId('next-plan-line')).toHaveTextContent('Business · ₪89.00 or $27.00 a month');
    expect(within(notice).getByRole('button', { name: 'Upgrade to Business' })).toBeInTheDocument();
    expect(router).toBeTruthy();
  });
});

describe('Home’s quiet line on a paid plan', () => {
  it('from 80% one line; from 90% it adds Upgrade to the next plan', async () => {
    const sub = STRIPE('SOLO');
    portal(`/p/${ORG_B}`, {
      billing: subscribed('solo', { usage: usage('solo', [46, 'nudge']) }),
      profiles: [personal(sub)],
      plan: { current: 'solo', businesses: null, soloTrialOffer: false },
    });
    const line = await screen.findByTestId('usage-nudge');
    expect(line).toHaveTextContent('46 of 50 documents this month');
    expect(within(line).getByRole('button', { name: 'Upgrade to Business' })).toBeInTheDocument();
  });
});
