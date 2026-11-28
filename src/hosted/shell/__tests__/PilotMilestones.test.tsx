import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ORG_B, emptyProfileRoutes, me, ok, profile, renderPortal, stubApi } from '../../__tests__/harness';
import type { BillingEntitlement, BillingOverview } from '../../api/client';
import { BILLING_KEY } from '../../data/billingQueries';
import { firstsReached, hoursSinceStart, NO_FIRSTS_MEMORY, nextFirstsMemory, readFirstsMemory, writeFirstsMemory, type BillingPilot } from '../../data/pilot';
import { resetPilotWelcomeOffer } from '../../session/pilotWelcomeOffer';
import { usePilotMilestones } from '../PilotMilestones';

/** Pilot milestones: the first scan and the first invoice, celebrated once, when this browser saw them happen. */

const DAY = 24 * 60 * 60 * 1000;
const iso = (days: number) => new Date(Date.now() + days * DAY).toISOString();
const pilot = (over: Partial<BillingPilot> = {}): BillingPilot => ({ cohort: 'dec-2026', startedAt: '2026-12-01T08:00:00Z', endsAt: iso(50), welcomeSeenAt: iso(-1), firstScanAt: null, firstInvoiceAt: null, pricesExpected: true, plans: [], ...over });

afterEach(() => localStorage.clear());

describe('firsts (ADR-298 rule 2)', () => {
  it('a first is reached when it was null at an earlier read and is set now, once', () => {
    const before = nextFirstsMemory(pilot(), NO_FIRSTS_MEMORY);
    expect(before).toEqual({ nullSeen: ['scan', 'invoice'], celebrated: [] });
    const now = pilot({ firstScanAt: '2026-12-02T10:30:00Z' });
    expect(firstsReached(now, before)).toEqual(['scan']);
    const after = nextFirstsMemory(now, before);
    expect(after.celebrated).toEqual(['scan']);
    expect(firstsReached(now, after)).toEqual([]);
  });

  it('a first made before this browser ever looked is not celebrated', () => {
    expect(firstsReached(pilot({ firstScanAt: '2026-12-02T10:30:00Z' }), NO_FIRSTS_MEMORY)).toEqual([]);
    expect(firstsReached(null, { nullSeen: ['scan'], celebrated: [] })).toEqual([]);
  });

  it('hours since the start, rounded down, for MUT-758', () => {
    expect(hoursSinceStart(pilot({ firstScanAt: '2026-12-02T10:30:00Z' }), 'scan')).toBe(26);
    expect(hoursSinceStart(pilot(), 'invoice')).toBeNull();
    expect(hoursSinceStart(pilot({ startedAt: undefined, firstScanAt: '2026-12-02T10:30:00Z' }), 'scan')).toBeNull();
  });

  it('the memory is per person and survives a blocked or broken store', () => {
    writeFirstsMemory('u1', { nullSeen: ['scan'], celebrated: [] });
    expect(readFirstsMemory('u1')).toEqual({ nullSeen: ['scan'], celebrated: [] });
    expect(readFirstsMemory('u2')).toEqual(NO_FIRSTS_MEMORY);
    localStorage.setItem('mutaba3a-pilot-firsts', '{not json');
    expect(readFirstsMemory('u1')).toEqual(NO_FIRSTS_MEMORY);
  });
});

describe('the milestone card', () => {
  const grant: BillingEntitlement = { state: 'ACTIVE', source: 'OPERATOR', tier: 'BUSINESS', until: iso(50) };
  beforeEach(() => {
    resetPilotWelcomeOffer();
    usePilotMilestones.setState({ queue: [] });
  });

  function portal(locale: 'en' | 'ar' = 'en') {
    let current = pilot();
    const overview = () => ({ configured: false, subscription: null, canManage: false, trial: null, catalog: { ILS: null, USD: null }, countries: { consumer: [], consumerEverywhere: true, customTaxId: [] }, coveredProfileIds: [ORG_B], offer: null, pilot: current }) as BillingOverview;
    stubApi({
      'GET /v1/me': () => ok(me([profile({ id: ORG_B, name: 'Personal', isPersonalDefault: true, owned: true, type: 'PERSONAL', writerOfRecord: null, billing: grant })], locale)),
      'GET /v1/billing': () => ok(overview()),
      ...emptyProfileRoutes(),
    });
    const rendered = renderPortal(`/p/${ORG_B}`);
    return { ...rendered, set: (over: Partial<BillingPilot>) => (current = { ...current, ...over }) };
  }

  it('shows the first scan once with its scene when the next read has it, then leaves when closed', async () => {
    const { queryClient, set, user } = portal();
    await waitFor(() => expect(queryClient.getQueryData(BILLING_KEY)).toBeDefined());
    expect(screen.queryByTestId('milestone-scan')).not.toBeInTheDocument();

    set({ firstScanAt: new Date().toISOString() });
    await act(() => queryClient.invalidateQueries({ queryKey: BILLING_KEY }));
    const card = await screen.findByTestId('milestone-scan');
    expect(card).toHaveTextContent('First scan saved');
    expect(card.querySelector('[data-scene="milestone-first-scan"]')).not.toBeNull();

    await user.click(within(card).getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('milestone-scan')).not.toBeInTheDocument();
    await act(() => queryClient.invalidateQueries({ queryKey: BILLING_KEY }));
    expect(screen.queryByTestId('milestone-scan')).not.toBeInTheDocument();
  });

  it('the first invoice in Arabic uses the -rtl drawing', async () => {
    const { queryClient, set } = portal('ar');
    await waitFor(() => expect(queryClient.getQueryData(BILLING_KEY)).toBeDefined());
    set({ firstInvoiceAt: new Date().toISOString() });
    await act(() => queryClient.invalidateQueries({ queryKey: BILLING_KEY }));
    const card = await screen.findByTestId('milestone-invoice');
    expect(card).toHaveTextContent('صدرت أول فاتورة');
    expect(card.querySelector('[data-scene-art="milestone-first-invoice-rtl"]')).not.toBeNull();
  });
});
