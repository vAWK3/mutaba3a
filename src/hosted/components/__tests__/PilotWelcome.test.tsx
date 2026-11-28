import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { ORG_B, emptyProfileRoutes, locationOf, me, ok, profile, renderPortal, stubApi } from '../../__tests__/harness';
import type { BillingEntitlement, BillingOverview } from '../../api/client';
import type { BillingPilot } from '../../data/pilot';
import { mayBeOnPilot, pilotWelcomeDue } from '../../data/pilot';
import { resetPilotWelcomeOffer } from '../../session/pilotWelcomeOffer';
import { resetTrialWelcomeOffer } from '../../session/trialWelcomeOffer';

/**
 * MUT-755 (plan T4, design review 3B): the pilot Welcome through the real portal (shell opener, account drawers, query
 * client), /v1 stubbed. Once per account: it opens while `pilot.welcomeSeenAt` is null, and Later, ✕ or the main
 * action close it and call POST /v1/billing/pilot-welcome.
 */

const DAY = 24 * 60 * 60 * 1000;
const iso = (days: number) => new Date(Date.now() + days * DAY).toISOString();
const grant = (until: string | null = iso(50)): BillingEntitlement => ({ state: 'ACTIVE', source: 'OPERATOR', tier: 'BUSINESS', until });
const pilot = (over: Partial<BillingPilot> = {}): BillingPilot => ({ cohort: 'dec-2026', startedAt: iso(-1), endsAt: iso(50), welcomeSeenAt: null, firstScanAt: null, firstInvoiceAt: null, pricesExpected: true, plans: [], ...over });
const overview = (p: BillingPilot | null): BillingOverview =>
  ({ configured: false, subscription: null, canManage: false, trial: null, catalog: { ILS: null, USD: null }, countries: { consumer: [], consumerEverywhere: true, customTaxId: [] }, coveredProfileIds: [ORG_B], offer: null, pilot: p }) as BillingOverview;

function portal(path: string, opts: { pilot?: BillingPilot | null; entitlement?: BillingEntitlement; locale?: 'en' | 'ar' } = {}) {
  const personal = profile({ id: ORG_B, name: 'Personal', isPersonalDefault: true, owned: true, type: 'PERSONAL', writerOfRecord: null, billing: opts.entitlement ?? grant() });
  let current = opts.pilot === undefined ? pilot() : opts.pilot;
  const api = stubApi({
    'GET /v1/me': () => ok(me([personal], opts.locale ?? 'en')),
    'GET /v1/billing': () => ok(overview(current)),
    'POST /v1/billing/pilot-welcome': () => {
      const at = current?.welcomeSeenAt ?? new Date().toISOString();
      if (current) current = { ...current, welcomeSeenAt: at };
      return ok({ welcomeSeenAt: at });
    },
    ...emptyProfileRoutes(),
  });
  return { ...renderPortal(path), api };
}

beforeEach(() => {
  resetPilotWelcomeOffer();
  resetTrialWelcomeOffer();
});

describe('the pilot Welcome (MUT-755)', () => {
  it('opens once on a pilot: the plan and its end, three steps on their scenes, Later and Start with a receipt', async () => {
    const { router } = portal(`/p/${ORG_B}`);
    const dialog = await screen.findByRole('dialog', { name: 'Welcome' });
    expect(locationOf(router)).toBe(`/p/${ORG_B}?pilotWelcome=true`);
    expect(within(dialog).getByText(/^Business, free until /)).toBeInTheDocument();
    const steps = within(dialog).getAllByRole('listitem');
    expect(steps.map((s) => s.textContent)).toEqual(['Scan a receipt', 'Issue an invoice', 'Tell us what is unclear']);
    expect(steps.map((s) => s.querySelector('[data-scene]')?.getAttribute('data-scene'))).toEqual(['pilot-welcome-1', 'pilot-welcome-2', 'pilot-welcome-3']);
    expect(within(dialog).getByRole('button', { name: 'Later' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Start with a receipt' })).toBeInTheDocument();
  });

  it('Later closes it and tells the server once; it does not open again', async () => {
    const { user, router, api } = portal(`/p/${ORG_B}`);
    const dialog = await screen.findByRole('dialog', { name: 'Welcome' });
    await user.click(within(dialog).getByRole('button', { name: 'Later' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Welcome' })).not.toBeInTheDocument());
    expect(locationOf(router)).toBe(`/p/${ORG_B}`);
    await waitFor(() => expect(api.count('POST /v1/billing/pilot-welcome')).toBe(1));
  });

  it('✕ counts as closing it', async () => {
    const { user, api } = portal(`/p/${ORG_B}`);
    const dialog = await screen.findByRole('dialog', { name: 'Welcome' });
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(api.count('POST /v1/billing/pilot-welcome')).toBe(1));
  });

  it('Start with a receipt goes to Receipts and closes it', async () => {
    const { user, router, api } = portal(`/p/${ORG_B}`);
    const dialog = await screen.findByRole('dialog', { name: 'Welcome' });
    await user.click(within(dialog).getByRole('button', { name: 'Start with a receipt' }));
    await waitFor(() => expect(locationOf(router)).toBe(`/p/${ORG_B}/expenses/receipts`));
    expect(api.count('POST /v1/billing/pilot-welcome')).toBe(1);
    expect(screen.queryByRole('dialog', { name: 'Welcome' })).not.toBeInTheDocument();
  });

  it('never opens once closed (another device), nor without a pilot; a deep link closes itself', async () => {
    portal(`/p/${ORG_B}?pilotWelcome=true`, { pilot: pilot({ welcomeSeenAt: iso(-1) }) });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('Arabic: right to left, Levantine month', async () => {
    portal(`/p/${ORG_B}`, { pilot: pilot({ endsAt: '2027-01-27T10:00:00Z' }), locale: 'ar' });
    const dialog = await screen.findByRole('dialog', { name: 'أهلًا بك' });
    expect(within(dialog).getByText(/مجانًا حتى .*كانون الثاني/)).toBeInTheDocument();
    expect(dialog.querySelector('[data-scene-art="pilot-welcome-1-rtl"]')).not.toBeNull();
  });
});

describe('who is read for the Welcome', () => {
  it('only someone an ending operator grant covers; the Welcome is due while never closed', () => {
    const base = me([profile({ id: ORG_B, owned: true, billing: grant() })], 'en');
    expect(mayBeOnPilot(base)).toBe(true);
    expect(mayBeOnPilot(me([profile({ id: ORG_B, owned: true, billing: grant(null) })], 'en'))).toBe(false);
    expect(mayBeOnPilot(me([profile({ id: ORG_B, owned: false, billing: grant() })], 'en'))).toBe(false);
    expect(mayBeOnPilot(me([profile({ id: ORG_B, owned: true, billing: { state: 'ACTIVE', source: 'TRIAL', tier: 'BUSINESS', until: iso(5) } })], 'en'))).toBe(false);
    expect(pilotWelcomeDue(overview(pilot()))).toBe(true);
    expect(pilotWelcomeDue(overview(pilot({ welcomeSeenAt: iso(-1) })))).toBe(false);
    expect(pilotWelcomeDue(overview(null))).toBe(false);
  });
});
