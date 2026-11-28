import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { ORG_A, ORG_B, emptyProfileRoutes, locationOf, me, ok, profile, renderPortal, stubApi, type Handler } from '../../__tests__/harness';
import type { BillingEntitlement, BillingOverview, Me } from '../../api/client';
import { PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';

/**
 * MUT-731 (ADR-284, wireframes 1, 3, 4, 7): the free Starter plan in the portal, through the real router, shell and
 * query client with /v1 stubbed: Billing's month, Continue free after a cancel, the business kept read-only, the
 * blocking pick-your-business dialog, Home's 80/90% notices and the new-business limit.
 */

const STARTER: BillingEntitlement = { state: 'ACTIVE', source: 'STARTER', tier: 'STARTER', until: null };
type Level = 'ok' | 'near' | 'nudge' | 'at_cap';

const personal = (billing: BillingEntitlement = STARTER) =>
  profile({ id: ORG_B, name: 'Personal', isPersonalDefault: true, owned: true, type: 'PERSONAL', writerOfRecord: null, access: { payments: 'read-write', expenses: 'read-write', capture: 'read-write' }, income: { received: true, owed: true, customer: 'optional' }, billing });
const business = (id: string, name: string, billing: BillingEntitlement = STARTER) => profile({ id, name, owned: true, type: 'BUSINESS', writerOfRecord: null, billing });

function overview(documents: [number, Level], scans: [number, Level], over: Partial<BillingOverview> = {}): BillingOverview {
  return {
    configured: true,
    subscription: null,
    canManage: false,
    trial: null,
    catalog: { ILS: { month: 2900, year: 29000 }, USD: null },
    countries: { consumer: [], consumerEverywhere: true, customTaxId: ['IL'] },
    coveredProfileIds: [ORG_B, ORG_A],
    offer: null,
    yearlySwitch: null,
    comeback: null,
    accountantPlan: null,
    currentPlan: 'starter',
    usage: {
      month: '2026-11',
      resetsOn: '2026-12-01',
      plan: 'starter',
      meters: [
        { meter: 'documents', used: documents[0], limit: 3, level: documents[1] },
        { meter: 'scans', used: scans[0], limit: 12, level: scans[1] },
      ],
      businesses: { used: 1, limit: 1 },
      partners: { limit: 0 },
    },
    starter: { chosenAt: null, canContinueFree: false },
    activeBusinesses: null,
    ...over,
  } as BillingOverview;
}

function portal(path: string, opts: { profiles?: ReturnType<typeof profile>[]; billing?: BillingOverview; plan?: Me['plan']; locale?: 'en' | 'ar'; routes?: Record<string, Handler> } = {}) {
  const body: Me = { ...me(opts.profiles ?? [personal()], opts.locale ?? 'en'), billingStanding: 'open', plan: opts.plan ?? { current: 'starter', businesses: null, soloTrialOffer: false } };
  const api = stubApi({
    'GET /v1/me': () => ok(body),
    'GET /v1/billing': () => ok(opts.billing ?? overview([0, 'ok'], [0, 'ok'])),
    ...emptyProfileRoutes(),
    ...opts.routes,
  });
  return { ...renderPortal(path), api, body };
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
});
afterEach(() => vi.unstubAllGlobals());

describe('Billing on Starter (wireframe 1)', () => {
  it('is a normal state: Active, the headline, this month’s two meters, the reset day and the plan’s lines', async () => {
    portal(`/p/${ORG_B}?billing=true`, { billing: overview([1, 'near'], [7, 'ok']) });
    const drawer = await screen.findByRole('dialog', { name: 'Billing' });
    expect(await within(drawer).findByText("You're on Starter, free")).toBeInTheDocument();
    expect(within(drawer).getByText('1 of 3 documents')).toBeInTheDocument();
    expect(within(drawer).getByText('7 of 12 scans')).toBeInTheDocument();
    expect(within(drawer).getByText('2 documents left this month')).toBeInTheDocument();
    expect(within(drawer).getByText(/^Resets on /)).toBeInTheDocument();
    expect(within(drawer).getByText('3 documents and 12 scans a month')).toBeInTheDocument();
    expect(within(drawer).getByText('Tax Authority connection: Solo and above')).toBeInTheDocument();
    expect(within(drawer).queryByRole('button', { name: 'Upgrade to Solo' })).toBeNull();
    expect(within(drawer).getByRole('button', { name: 'See plans' })).toBeInTheDocument();
  });

  it('from 90% Upgrade to Solo shows under the meters and opens the plan step', async () => {
    const { user, router } = portal(`/p/${ORG_B}?billing=true`, { billing: overview([2, 'nudge'], [11, 'nudge']) });
    const drawer = await screen.findByRole('dialog', { name: 'Billing' });
    await user.click(await within(drawer).findByRole('button', { name: 'Upgrade to Solo' }));
    await waitFor(() => expect(locationOf(router)).toContain('step=subscribe'));
  });

  it('with more than one business: the active one with Change, the others read-only', async () => {
    const billing = overview([0, 'ok'], [0, 'ok'], { activeBusinesses: { cap: 1, active: [ORG_A], readOnly: ['33333333-3333-4333-8333-333333333333'], mustChoose: false } });
    portal(`/p/${ORG_B}?billing=true`, {
      billing,
      profiles: [personal(), business(ORG_A, 'Studio'), business('33333333-3333-4333-8333-333333333333', 'Carried', { ...STARTER, state: 'READ_ONLY', planLimit: true } as BillingEntitlement)],
    });
    const drawer = await screen.findByRole('dialog', { name: 'Billing' });
    expect(await within(drawer).findByText('Active business')).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: 'Change' })).toBeInTheDocument();
    expect(within(drawer).getByText('Carried')).toBeInTheDocument();
  });

  it('reads in Arabic: «أنت على خطة البداية المجانية»', async () => {
    localStorage.setItem(PORTAL_LANGUAGE_KEY, 'ar');
    portal(`/p/${ORG_B}?billing=true`, { locale: 'ar', billing: overview([1, 'near'], [7, 'ok']) });
    expect(await screen.findByText('أنت على خطة البداية المجانية')).toBeInTheDocument();
    expect(screen.getByText('1 من 3 مستندات')).toBeInTheDocument();
  });
});

describe('read-only after a cancel offers Starter (wireframe 4, 13540 Q3)', () => {
  const lapsed: BillingEntitlement = { state: 'READ_ONLY', source: 'STRIPE', tier: 'FREELANCER', until: null };

  it('the banner names Starter’s limits; Continue free sends POST /v1/billing/starter and says so', async () => {
    let chosen = false;
    const { user, api } = portal(`/p/${ORG_B}`, {
      profiles: [personal(lapsed)],
      billing: overview([0, 'ok'], [0, 'ok'], { currentPlan: null, starter: { chosenAt: null, canContinueFree: true } }),
      routes: {
        'POST /v1/billing/starter': () => {
          chosen = true;
          return ok({ starterChosenAt: new Date().toISOString(), changed: true });
        },
      },
    });
    const banner = await screen.findByTestId('lapse-cancelled');
    expect(within(banner).getByText('Your plan has ended')).toBeInTheDocument();
    expect(within(banner).getByText(/Starter: 1 business, 3 documents and 12 scans a month/)).toBeInTheDocument();
    expect(within(banner).getByRole('button', { name: 'Subscribe' })).toBeInTheDocument();
    await user.click(within(banner).getByRole('button', { name: 'Continue free on Starter' }));
    await waitFor(() => expect(chosen).toBe(true));
    expect(api.count('POST /v1/billing/starter')).toBe(1);
    // A confirmation, in the quiet info toast, never the error alert.
    expect(await screen.findByTestId('toast-live')).toHaveTextContent("You're on Starter now.");
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('a business read-only for Starter’s count says so and offers Change, not Subscribe', async () => {
    const kept: BillingEntitlement = { ...STARTER, state: 'READ_ONLY', planLimit: true } as BillingEntitlement;
    portal(`/p/${ORG_A}`, { profiles: [business(ORG_A, 'Carried', kept), personal()] });
    const banner = await screen.findByTestId('lapse-plan-limit');
    expect(within(banner).getByText('Starter includes one business. The others stay read-only.')).toBeInTheDocument();
    expect(within(banner).queryByRole('button', { name: 'Subscribe' })).toBeNull();
  });
});

describe('pick your active business (wireframe 3, Basel Q5)', () => {
  const C = '33333333-3333-4333-8333-333333333333';
  const readOnly = { ...STARTER, state: 'READ_ONLY', planLimit: true } as BillingEntitlement;

  it('blocks with nothing chosen; the button names the choice; PUT keeps it', async () => {
    let sent: unknown = null;
    const { user } = portal(`/p/${ORG_B}`, {
      profiles: [personal(), business(ORG_A, 'Studio', readOnly), business(C, 'Carried', readOnly)],
      plan: { current: 'starter', businesses: { cap: 1, active: [], readOnly: [ORG_A, C], mustChoose: true }, soloTrialOffer: false },
      routes: {
        'PUT /v1/billing/active-businesses': (request) => {
          sent = request.body;
          return ok({ cap: 1, active: [C], readOnly: [ORG_A], mustChoose: false });
        },
      },
    });
    const dialog = await screen.findByRole('dialog', { name: 'Choose your active business' });
    const confirm = within(dialog).getByTestId('pick-business-confirm');
    expect(confirm).toBeDisabled();
    expect(within(dialog).getByText('Choose a business')).toBeInTheDocument();
    expect(within(dialog).getAllByRole('radio').every((r) => !(r as HTMLInputElement).checked)).toBe(true);
    expect(within(dialog).getByRole('button', { name: 'See plans' })).toBeInTheDocument();
    await user.click(within(dialog).getByLabelText('Carried'));
    expect(within(dialog).getByRole('button', { name: 'Keep Carried active' })).toBeEnabled();
    await user.click(within(dialog).getByRole('button', { name: 'Keep Carried active' }));
    await waitFor(() => expect(sent).toEqual({ organizationIds: [C] }));
  });
});

describe('Home: the 80% heads-up and the 90% nudge (wireframe 7, 13554 #1 and #5)', () => {
  it('80%: one quiet line with the count and the reset day', async () => {
    portal(`/p/${ORG_B}`, { billing: overview([0, 'ok'], [10, 'near']) });
    const line = await screen.findByTestId('usage-near');
    expect(within(line).getByText(/10 of 12 scans this month · Resets on/)).toBeInTheDocument();
  });

  it('90%: a banner with Upgrade to Solo and Hide; Hide keeps it away', async () => {
    const { user } = portal(`/p/${ORG_B}`, { billing: overview([0, 'ok'], [11, 'nudge']) });
    const nudge = await screen.findByTestId('usage-nudge');
    expect(within(nudge).getByText('1 scan left this month')).toBeInTheDocument();
    expect(within(nudge).getByRole('button', { name: 'Upgrade to Solo' })).toBeInTheDocument();
    await user.click(within(nudge).getByRole('button', { name: 'Hide' }));
    await waitFor(() => expect(screen.queryByTestId('usage-nudge')).toBeNull());
  });

  it('at the limit: the line stays (no Hide) and says what is used up', async () => {
    portal(`/p/${ORG_B}`, { billing: overview([3, 'at_cap'], [4, 'ok']) });
    const line = await screen.findByTestId('usage-at_cap');
    expect(within(line).getByText(/No documents left this month · Resets on/)).toBeInTheDocument();
    expect(within(line).queryByRole('button', { name: 'Hide' })).toBeNull();
  });

  it('on a plan with no limits (legacy Freelancer): nothing, and Billing isn’t read for it (MUT-705 reads it for Solo and up)', async () => {
    const { api } = portal(`/p/${ORG_B}`, { plan: { current: 'freelancer', businesses: null, soloTrialOffer: false } });
    await screen.findByRole('heading', { level: 1, name: 'Home' });
    expect(screen.queryByTestId('usage-near')).toBeNull();
    expect(api.count('GET /v1/billing')).toBe(0);
  });
});
