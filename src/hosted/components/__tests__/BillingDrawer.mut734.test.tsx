import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { ORG_A, ORG_B, emptyProfileRoutes, fail, locationOf, me, ok, profile, renderPortal, stubApi, type Handler } from '../../__tests__/harness';
import type { BillingEntitlement, BillingOverview, Me, PlanChangePreview } from '../../api/client';
import { PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';

/**
 * MUT-734 (wireframe mut-734 A on every screen): Change plan in Billing (list + preview, up now, down at the period end
 * with the businesses kept), the scheduled line with Undo, the upgrade's done pane, and the cancel flow's Move to Starter.
 */

const DAY = 24 * 60 * 60 * 1000;
const END = new Date(Date.now() + 20 * DAY).toISOString();
const PLANS: NonNullable<BillingOverview['plans']> = [
  { plan: 'solo', catalog: { ILS: { month: 3900, year: 39000 }, USD: { month: 1200, year: 12000 } }, limits: { businesses: 1, partners: 0, documentsPerMonth: 50, scansPerMonth: 100 } },
  { plan: 'business', catalog: { ILS: { month: 8900, year: 89000 }, USD: { month: 2700, year: 27000 } }, limits: { businesses: 3, partners: 2, documentsPerMonth: 250, scansPerMonth: 500 } },
  { plan: 'firm', catalog: { ILS: { month: 24900, year: 249000 }, USD: { month: 7500, year: 75000 } }, limits: { businesses: 6, partners: 2, documentsPerMonth: 1000, scansPerMonth: 2000 } },
];
const LIMITS = Object.fromEntries(PLANS.map((p) => [p.plan, p.limits])) as Record<string, (typeof PLANS)[number]['limits']>;

function billingOn(plan: 'solo' | 'business', over: Partial<BillingOverview> = {}): BillingOverview {
  return {
    configured: true,
    subscription: { tier: plan.toUpperCase() as 'SOLO', status: 'active', interval: 'month', currency: 'ILS', currentPeriodEnd: END, cancelAtPeriodEnd: false, renewsAtListPrice: true, offer: null, pause: null },
    canManage: true,
    trial: null,
    catalog: { ILS: { month: 3900, year: 39000 }, USD: null },
    countries: { consumer: [], consumerEverywhere: true, customTaxId: ['IL'] },
    coveredProfileIds: [ORG_B],
    offer: null,
    yearlySwitch: null,
    currentPlan: plan,
    plans: PLANS,
    scheduledChange: null,
    pendingChange: null,
    planChange: plan === 'solo' ? { canUpgradeTo: ['business', 'firm'], canDowngradeTo: ['starter'] } : { canUpgradeTo: ['firm'], canDowngradeTo: ['solo', 'starter'] },
    ...over,
  } as BillingOverview;
}

const upgrade = (plan: 'business' | 'firm'): PlanChangePreview => ({ kind: 'upgrade', plan, amountDue: 3140, currency: 'ils', prorationAt: '2026-11-27T10:00:00.000Z', limits: LIMITS[plan]! });
const change = (kind: 'UPGRADE' | 'DOWNGRADE' | 'TO_STARTER', fromPlan: string, toPlan: string) => ({ id: '77777777-7777-4777-8777-777777777777', kind, state: kind === 'UPGRADE' ? 'APPLIED' : 'SCHEDULED', fromPlan, toPlan, effectiveAt: END, amountMinor: null, currency: null, createdAt: '2026-11-27T10:00:00.000Z' });

const STRIPE = (tier: string): BillingEntitlement => ({ state: 'ACTIVE', source: 'STRIPE', tier, until: END }) as BillingEntitlement;
const personal = (billing: BillingEntitlement) => profile({ id: ORG_B, name: 'Personal', isPersonalDefault: true, owned: true, type: 'PERSONAL', writerOfRecord: null, billing });

function portal(path: string, billing: () => BillingOverview, routes: Record<string, Handler> = {}, plan: 'solo' | 'business' = 'solo') {
  const base = me([personal(STRIPE(plan.toUpperCase())), profile({ id: ORG_A, name: 'Studio', owned: true, type: 'BUSINESS', writerOfRecord: null, billing: STRIPE(plan.toUpperCase()) })], 'en');
  const body: Me = { ...base, billingStanding: 'open', plan: { current: plan, businesses: null, soloTrialOffer: false } };
  const api = stubApi({ 'GET /v1/me': () => ok(body), 'GET /v1/billing': () => ok(billing()), ...emptyProfileRoutes(), ...routes });
  return { ...renderPortal(path), api };
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
});

describe('Change plan: up now (AC1, AC2)', () => {
  it('Billing offers Change plan; picking Business previews the amount charged now and Pay charges it; the done pane names the plan', async () => {
    let upgraded = false;
    const { user, api, router } = portal(`/p/${ORG_B}?billing=true`, () => (upgraded ? billingOn('business') : billingOn('solo')), {
      'POST /v1/billing/plan-change/preview': () => ok(upgrade('business')),
      'POST /v1/billing/plan-change': () => ((upgraded = true), ok({ state: 'applied', change: change('UPGRADE', 'SOLO', 'BUSINESS'), hostedInvoiceUrl: null })),
    });
    const billing = await screen.findByRole('dialog', { name: 'Billing' });
    await user.click(await within(billing).findByRole('button', { name: 'Change plan' }));
    const pane = await screen.findByRole('dialog', { name: 'Change plan' });
    expect(locationOf(router)).toBe(`/p/${ORG_B}?billing=true&step=change`);
    expect(within(pane).getByTestId('change-row-solo')).toHaveTextContent('Current');
    expect(within(pane).getByRole('radio', { name: /^Solo/ })).toBeDisabled();
    await user.click(within(pane).getByRole('radio', { name: /^Business/ }));
    const preview = await within(pane).findByTestId('change-preview');
    expect(preview).toHaveTextContent('Charged now');
    expect(preview).toHaveTextContent('₪31.40');
    await user.click(within(pane).getByRole('button', { name: 'Pay ₪31.40' }));
    expect(api.calls.find((c) => c.url.pathname === '/v1/billing/plan-change')?.body).toEqual({ plan: 'business', prorationAt: '2026-11-27T10:00:00.000Z', expectedAmountDue: 3140 });
    const done = await within(pane).findByTestId('plan-upgraded');
    expect(within(done).getByRole('heading', { name: "You're on Business" })).toBeInTheDocument();
    expect(done.querySelector('[data-scene="plan-upgraded"]')).toHaveClass('hp-scene--plan-upgraded');
  });

  it('a declined card leaves the plan and offers another card', async () => {
    const { user } = portal(`/p/${ORG_B}?billing=true&step=change&billingPlan=business`, () => billingOn('solo'), {
      'POST /v1/billing/plan-change/preview': () => ok(upgrade('business')),
      'POST /v1/billing/plan-change': () => fail(409, 'CONFLICT', { reason: 'PAYMENT_FAILED' }),
    });
    const pane = await screen.findByRole('dialog', { name: 'Change plan' });
    expect(await within(pane).findByRole('radio', { name: /^Business/ })).toBeChecked();
    await user.click(await within(pane).findByRole('button', { name: 'Pay ₪31.40' }));
    expect(await within(pane).findByText('Card declined')).toBeInTheDocument();
    expect(within(pane).getByRole('button', { name: 'Pay with another card' })).toBeInTheDocument();
  });

  it('a payment the bank holds waits, with Stripe’s page', async () => {
    const { user } = portal(`/p/${ORG_B}?billing=true&step=change&billingPlan=business`, () => billingOn('solo'), {
      'POST /v1/billing/plan-change/preview': () => ok(upgrade('business')),
      'POST /v1/billing/plan-change': () => ok({ state: 'pending', change: { ...change('UPGRADE', 'SOLO', 'BUSINESS'), state: 'PENDING' }, hostedInvoiceUrl: 'https://invoice.stripe.com/i/acct/x' }, 202),
    });
    const pane = await screen.findByRole('dialog', { name: 'Change plan' });
    await user.click(await within(pane).findByRole('button', { name: 'Pay ₪31.40' }));
    expect(await within(pane).findByText('Waiting for the payment · Business')).toBeInTheDocument();
    expect(within(pane).getByRole('button', { name: 'Complete payment' })).toBeInTheDocument();
  });
});

describe('Change plan: down at the period end (AC3, AC5)', () => {
  const down: PlanChangePreview = {
    kind: 'downgrade',
    plan: 'solo',
    effectiveAt: END,
    limits: LIMITS.solo!,
    cap: 1,
    businesses: [
      { id: ORG_A, name: 'Studio' },
      { id: '88888888-8888-4888-8888-888888888888', name: 'Print' },
    ],
    mustChoose: true,
  };

  it('the date is the main figure; Confirm waits for the business kept, then Billing shows the scheduled line and the undo toast', async () => {
    let scheduled = false;
    const { user, api } = portal(
      `/p/${ORG_B}?billing=true&step=change`,
      () => billingOn('business', scheduled ? { scheduledChange: { plan: 'solo', at: END, kind: 'DOWNGRADE' }, planChange: { canUpgradeTo: [], canDowngradeTo: [] } } : {}),
      {
        'POST /v1/billing/plan-change/preview': () => ok(down),
        'POST /v1/billing/plan-change': () => ((scheduled = true), ok({ state: 'scheduled', change: change('DOWNGRADE', 'BUSINESS', 'SOLO'), hostedInvoiceUrl: null })),
      },
      'business',
    );
    const pane = await screen.findByRole('dialog', { name: 'Change plan' });
    await user.click(await within(pane).findByRole('radio', { name: /^Solo/ }));
    expect(await within(pane).findByTestId('change-preview')).toHaveTextContent(/^Solo from /);
    const list = within(pane).getByTestId('business-checklist');
    expect(list).toHaveTextContent('0 of 1');
    expect(within(pane).getByRole('button', { name: 'Confirm' })).toBeDisabled();
    await user.click(within(list).getByRole('checkbox', { name: /Studio/ }));
    expect(within(list).getByRole('checkbox', { name: /Print/ })).toBeDisabled();
    expect(list).toHaveTextContent(/Read-only from /);
    await user.click(within(pane).getByRole('button', { name: 'Confirm' }));
    expect(api.calls.find((c) => c.url.pathname === '/v1/billing/plan-change')?.body).toEqual({ plan: 'solo', activeBusinessIds: [ORG_A] });
    const billing = await screen.findByRole('dialog', { name: 'Billing' });
    const line = await within(billing).findByTestId('scheduled-change');
    expect(line).toHaveTextContent('Scheduled');
    expect(line).toHaveTextContent(/Solo from /);
    expect(line.querySelector('[data-scene="change-scheduled"]')).not.toBeNull();
    const toast = await screen.findByTestId('toast-live');
    expect(toast).toHaveTextContent(/Solo from /);
    expect(toast).toHaveClass('hp-toast--rise');
    expect(within(toast).getByRole('button', { name: 'Undo' })).toBeInTheDocument();
  });

  it('Undo on the line takes the change back and says what renews', async () => {
    let undone = false;
    const { user, api } = portal(
      `/p/${ORG_B}?billing=true`,
      () => billingOn('business', undone ? {} : { scheduledChange: { plan: 'solo', at: END, kind: 'DOWNGRADE' }, planChange: { canUpgradeTo: [], canDowngradeTo: [] } }),
      { 'DELETE /v1/billing/plan-change': () => ((undone = true), ok({ change: { ...change('DOWNGRADE', 'BUSINESS', 'SOLO'), state: 'UNDONE' } })) },
      'business',
    );
    const billing = await screen.findByRole('dialog', { name: 'Billing' });
    const line = await within(billing).findByTestId('scheduled-change');
    expect(within(billing).queryByRole('button', { name: 'Change plan' })).toBeNull();
    await user.click(within(line).getByRole('button', { name: 'Undo' }));
    expect(api.calls.some((c) => c.method === 'DELETE' && c.url.pathname === '/v1/billing/plan-change')).toBe(true);
    await vi.waitFor(() => expect(line).toHaveAttribute('data-leaving'));
    expect(await screen.findByText(/^Business renews /)).toBeInTheDocument();
  });
});

describe('Cancel → Move to Starter (AC8)', () => {
  it('the confirm step offers Move to Starter, which opens Change plan on Starter', async () => {
    const { user, router } = portal(`/p/${ORG_B}?billing=true&step=cancel`, () => billingOn('solo'), {
      'GET /v1/billing/retention': () => ok({ endsOn: END, pause: null, stayOffer: null }),
      'POST /v1/billing/plan-change/preview': () => ok({ kind: 'to_starter', plan: 'starter', effectiveAt: END, limits: LIMITS.solo!, cap: 1, businesses: [], mustChoose: false }),
    });
    const step = await screen.findByRole('dialog', { name: 'Cancel plan' });
    await user.click(await within(step).findByRole('radio', { name: "I'm moving to another tool" }));
    await user.click(within(step).getByRole('button', { name: 'Continue' }));
    await user.click(await within(step).findByTestId('move-to-starter'));
    const pane = await screen.findByRole('dialog', { name: 'Change plan' });
    expect(locationOf(router)).toBe(`/p/${ORG_B}?billing=true&step=change&billingPlan=starter`);
    expect(await within(pane).findByRole('radio', { name: /^Starter/ })).toBeChecked();
    expect(await within(pane).findByTestId('change-preview')).toHaveTextContent(/^Starter from /);
    expect(within(pane).getByRole('button', { name: 'Confirm' })).toBeEnabled();
  });
});
