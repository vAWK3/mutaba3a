import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { ORG_B, emptyProfileRoutes, me, ok, profile, renderPortal, stubApi } from '../../__tests__/harness';
import type { BillingEntitlement, BillingOverview } from '../../api/client';
import type { BillingPilot } from '../../data/pilot';

const { trackPilotEvent } = vi.hoisted(() => ({ trackPilotEvent: vi.fn() }));
vi.mock('../../analytics/portalAnalytics', async (original) => ({ ...(await original<typeof import('../../analytics/portalAnalytics')>()), trackPilotEvent }));

/**
 * MUT-753 (plan T2, design review 1A, 2A, 2B, interaction states): the Pilot panel in Billing through the real
 * portal, with /v1 stubbed: status, limits, the plans with their Expected prices, one Write to us; the last 14 days;
 * and the end state with its scene.
 */

const DAY = 24 * 60 * 60 * 1000;
const iso = (days: number) => new Date(Date.now() + days * DAY).toISOString();
const ent = (state: BillingEntitlement['state'], source: BillingEntitlement['source'], until: string | null = null): BillingEntitlement => ({ state, source, tier: 'BUSINESS', until });

const PLANS: BillingPilot['plans'] = [
  { plan: 'solo', expectedMonthly: { ILS: 3900, USD: 1200 }, limits: { businesses: 1, partners: 0, documentsPerMonth: 50, scansPerMonth: 100 } },
  { plan: 'business', expectedMonthly: { ILS: 8900, USD: 2700 }, limits: { businesses: 3, partners: 2, documentsPerMonth: 250, scansPerMonth: 500 } },
  { plan: 'firm', expectedMonthly: { ILS: 24900, USD: 7500 }, limits: { businesses: 6, partners: 2, documentsPerMonth: 1000, scansPerMonth: 2000 } },
];
const pilot = (over: Partial<BillingPilot> = {}): BillingPilot => ({ cohort: 'dec-2026', startedAt: iso(-10), endsAt: iso(50), welcomeSeenAt: iso(-9), firstScanAt: null, firstInvoiceAt: null, pricesExpected: true, plans: PLANS, ...over });
const businessUsage = (documents: number, scans: number) => ({
  month: '2026-12',
  resetsOn: '2027-01-01',
  plan: 'business' as const,
  meters: [
    { meter: 'documents' as const, used: documents, limit: 250, level: 'ok' as const },
    { meter: 'scans' as const, used: scans, limit: 500, level: 'ok' as const },
  ],
  businesses: { used: 1, limit: 3 },
  partners: { limit: 2 },
});

const overview = (over: Partial<BillingOverview> = {}): BillingOverview =>
  ({
    configured: false,
    subscription: null,
    canManage: false,
    trial: null,
    catalog: { ILS: null, USD: null },
    countries: { consumer: [], consumerEverywhere: true, customTaxId: [] },
    coveredProfileIds: [ORG_B],
    offer: null,
    yearlySwitch: null,
    starter: { chosenAt: null, canContinueFree: false },
    ...over,
  }) as BillingOverview;

function portal(billing: BillingOverview, entitlement: BillingEntitlement, locale: 'en' | 'ar' = 'en') {
  const profiles = [profile({ id: ORG_B, name: 'Personal', isPersonalDefault: true, owned: true, type: 'PERSONAL', writerOfRecord: null, billing: entitlement })];
  stubApi({ 'GET /v1/me': () => ok(me(profiles, locale)), 'GET /v1/billing': () => ok(billing), ...emptyProfileRoutes() });
  return renderPortal(`/p/${ORG_B}?billing=true`);
}

beforeEach(() => trackPilotEvent.mockClear());

/** MUT-758 (ADR-298, contract 2.13.0): the panel's pilot events, through portalAnalytics (release-only, opt-in). */
describe('Billing: the pilot events (MUT-758)', () => {
  const sent = (event: string) => trackPilotEvent.mock.calls.filter((c) => (c as unknown[])[0] === event).map((c) => (c as unknown[])[1] ?? {});

  it('opening Billing counts once with the days left (rounded down), the plans viewed, and a line at 90%', async () => {
    const endsAt = new Date(Date.now() + 20.6 * DAY).toISOString();
    portal(overview({ pilot: pilot({ endsAt }), usage: businessUsage(225, 31) }), ent('ACTIVE', 'OPERATOR', endsAt));
    await screen.findByTestId('pilot-plans');
    expect(sent('pilot_billing_opened')).toEqual([{ days_left: 20 }]);
    expect(sent('pilot_plans_viewed')).toEqual([{}]);
    expect(sent('pilot_usage_near_cap')).toEqual([{ limit: 'documents' }]);
    expect(trackPilotEvent.mock.calls.every((c) => !JSON.stringify(c).includes('dec-2026'))).toBe(true);
  });

  it('Write to us counts a tap', async () => {
    const { user } = portal(overview({ pilot: pilot(), usage: businessUsage(1, 1) }), ent('ACTIVE', 'OPERATOR', iso(50)));
    const link = await screen.findByRole('link', { name: 'Write to us' });
    link.addEventListener('click', (e) => e.preventDefault());
    await user.click(link);
    expect(sent('pilot_contact_tapped')).toEqual([{}]);
  });

  it('nothing is counted for someone not on a pilot', async () => {
    portal(overview({ usage: businessUsage(225, 31) }), ent('ACTIVE', 'STARTER'));
    await screen.findByRole('dialog', { name: 'Billing' });
    expect(trackPilotEvent.mock.calls.filter((c) => String((c as unknown[])[0]).startsWith('pilot_'))).toEqual([]);
  });
});

describe('Billing: the Pilot panel (MUT-753)', () => {
  it('status, limits, the plans with Expected prices, and one Write to us, in that order (1A)', async () => {
    portal(overview({ pilot: pilot(), usage: businessUsage(12, 31) }), ent('ACTIVE', 'OPERATOR', iso(50)));
    const dialog = await screen.findByRole('dialog', { name: 'Billing' });
    expect(await within(dialog).findByText('Pilot', { selector: '.hp-billing-status .hp-billing-chip' })).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: /^Free until / })).toBeInTheDocument();
    expect(within(dialog).getByText('Business · 100% off')).toBeInTheDocument();

    expect(within(dialog).getByText('12 of 250 documents')).toBeInTheDocument();
    expect(within(dialog).getByText('31 of 500 scans')).toBeInTheDocument();
    expect(within(dialog).getByText('1 of 3 businesses')).toBeInTheDocument();
    expect(within(dialog).getByText('2 partners per business')).toBeInTheDocument();

    const plans = within(dialog).getByTestId('pilot-plans');
    expect(within(within(plans).getByTestId('pilot-plan-business')).getByText('₪89.00')).toBeInTheDocument();
    expect(within(within(plans).getByTestId('pilot-plan-solo')).getByText('₪39.00')).toBeInTheDocument();
    expect(within(within(plans).getByTestId('pilot-plan-firm')).getByText('₪249.00')).toBeInTheDocument();
    expect(within(plans).getAllByText('Expected')).toHaveLength(3);

    const write = within(dialog).getByRole('link', { name: 'Write to us' });
    expect(write.getAttribute('href')).toMatch(/^mailto:/);
    // Nothing to buy inside the pilot (NOT in scope).
    expect(within(dialog).queryByRole('button', { name: 'Subscribe' })).not.toBeInTheDocument();
    const order = ['plan-usage-lines', 'pilot-plans', 'pilot-write-to-us'].map((id) => within(dialog).getByTestId(id));
    expect(order[0]!.compareDocumentPosition(order[1]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(order[1]!.compareDocumentPosition(order[2]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a line turns butter from 90% and not at 89% (2B); nothing is refused', async () => {
    portal(overview({ pilot: pilot(), usage: businessUsage(225, 444) }), ent('ACTIVE', 'OPERATOR', iso(50)));
    const dialog = await screen.findByRole('dialog', { name: 'Billing' });
    expect(await within(dialog).findByTestId('usage-line-documents')).toHaveAttribute('data-attention', 'true');
    expect(within(dialog).getByTestId('usage-line-scans')).not.toHaveAttribute('data-attention');
  });

  it('the last 14 days: "N days left", "Ends <date>", then free Starter', async () => {
    portal(overview({ pilot: pilot({ endsAt: iso(9) }), usage: businessUsage(12, 31) }), ent('ACTIVE', 'OPERATOR', iso(9)));
    const dialog = await screen.findByRole('dialog', { name: 'Billing' });
    expect(await within(dialog).findByText('9 days left')).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: /^Ends / })).toBeInTheDocument();
    expect(within(dialog).getByText('Then free Starter')).toBeInTheDocument();
  });

  it('ended onto Starter: the pilot-ended scene, "Pilot ended", and Starter’s lines', async () => {
    const usage = { ...businessUsage(1, 0), plan: 'starter' as const, meters: [{ meter: 'documents' as const, used: 1, limit: 3, level: 'ok' as const }, { meter: 'scans' as const, used: 0, limit: 12, level: 'ok' as const }] };
    portal(overview({ pilotEnded: { cohort: 'dec-2026', endedAt: iso(-1) }, currentPlan: null, usage } as Partial<BillingOverview>), ent('ACTIVE', 'STARTER'));
    const dialog = await screen.findByRole('dialog', { name: 'Billing' });
    expect(await within(dialog).findByRole('heading', { name: 'Pilot ended' })).toBeInTheDocument();
    expect(dialog.querySelector('[data-scene="pilot-ended"]')).not.toBeNull();
    expect(within(dialog).getByText('Starter', { selector: '.hp-billing-chip' })).toBeInTheDocument();
    expect(within(dialog).getByTestId('usage-documents')).toHaveTextContent('1 of 3 documents');
    expect(within(dialog).queryByRole('link', { name: 'Write to us' })).not.toBeInTheDocument();
  });

  it('Arabic: the status reads right to left with Levantine months', async () => {
    portal(overview({ pilot: pilot({ endsAt: '2027-01-27T10:00:00Z' }), usage: businessUsage(12, 31) }), ent('ACTIVE', 'OPERATOR', iso(50)), 'ar');
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByRole('heading', { name: /مجاني حتى .*كانون الثاني/ })).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'راسلنا' })).toBeInTheDocument();
  });
});
