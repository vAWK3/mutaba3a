import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { ORG_B, emptyProfileRoutes, locationOf, me, ok, profile, renderPortal, stubApi, type Handler } from '../../__tests__/harness';
import type { BillingEntitlement, BillingOverview, Me, TrialPrompt } from '../../api/client';
import { resetTrialWelcomeOffer } from '../../session/trialWelcomeOffer';

const { trackPortal } = vi.hoisted(() => ({ trackPortal: vi.fn(async () => {}) }));
vi.mock('../../analytics/portalAnalytics', async (original) => ({ ...(await original<typeof import('../../analytics/portalAnalytics')>()), trackPortal }));

/**
 * MUT-418: the free trial's card prompt through the real portal (router, account drawers, query client), /v1 stubbed.
 * The first-run step (`?billing=true&step=welcome`), the shell opener for first sign-ins outside /setup, and the Home
 * trial banner.
 */

const DAY = 24 * 60 * 60 * 1000;
const iso = (days: number) => new Date(Date.now() + days * DAY).toISOString();
const UNANSWERED: TrialPrompt = { welcomedAt: null, welcomeAnswer: null, bannerSnoozedUntil: null };
const trial = (days: number): BillingEntitlement => ({ state: 'ACTIVE', source: 'TRIAL', tier: 'FREELANCER', until: iso(days) });

const overview = (over: Partial<BillingOverview> = {}): BillingOverview => ({
  configured: true,
  subscription: null,
  canManage: false,
  trial: { startedAt: iso(-0.01), endsAt: iso(14), lockAt: iso(30) },
  catalog: { ILS: { month: 4900, year: 49000 }, USD: { month: 1600, year: 16000 } },
  countries: { consumer: [], consumerEverywhere: true, customTaxId: ['IL', 'JO'] },
  coveredProfileIds: [ORG_B],
  ...over,
});

function portal(path: string, opts: { prompt?: TrialPrompt; billing?: BillingEntitlement; overview?: BillingOverview; locale?: 'en' | 'ar' } = {}) {
  const personal = profile({ id: ORG_B, name: 'Personal', isPersonalDefault: true, owned: true, type: 'PERSONAL', writerOfRecord: null, billing: opts.billing ?? trial(14) });
  let stored: TrialPrompt = opts.prompt ?? UNANSWERED;
  const meNow = (): Me => {
    const base = me([personal], opts.locale ?? 'en');
    return { ...base, user: { ...base.user, trialPrompt: stored } };
  };
  const patch: Handler = (request) => {
    const action = (request.body as { action: string }).action;
    if (action === 'banner-snoozed') stored = { ...stored, bannerSnoozedUntil: iso(3) };
    else if (!stored.welcomedAt) stored = { ...stored, welcomedAt: new Date().toISOString(), welcomeAnswer: action === 'welcome-accepted' ? 'accepted' : 'skipped' };
    return ok(stored);
  };
  const api = stubApi({
    'GET /v1/me': () => ok(meNow()),
    'GET /v1/billing': () => ok(opts.overview ?? overview()),
    'PATCH /v1/me/trial-prompt': patch,
    ...emptyProfileRoutes(),
  });
  return { ...renderPortal(path), api, actions: () => api.calls.filter((c) => c.url.pathname === '/v1/me/trial-prompt').map((c) => (c.body as { action: string }).action) };
}

beforeEach(() => {
  trackPortal.mockClear();
  resetTrialWelcomeOffer();
});
afterEach(() => vi.useRealTimers());

describe('the first-run trial step (AC1, AC2, AC4)', () => {
  it('a new trial opens on it: the headline, the end date, Add a card now (recommended) and Not now', async () => {
    const { router } = portal(`/p/${ORG_B}`);
    const dialog = await screen.findByRole('dialog', { name: 'Your free trial' });
    expect(locationOf(router)).toBe(`/p/${ORG_B}?billing=true&step=welcome`);
    expect(await within(dialog).findByRole('heading', { name: 'Your 14-day free trial has started' })).toHaveFocus();
    expect(within(dialog).getByText(/^It ends on /)).toBeInTheDocument();
    expect(within(dialog).getByText(/You won't be charged until .+\. Cancel any time before then\./)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Add a card now (recommended)' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Not now' })).toBeInTheDocument();
    expect(trackPortal).toHaveBeenCalledWith('trial_card_prompt_shown', { prompt: 'first_run' });
  });

  it('Not now goes to Home, records the answer, and the step does not come back', async () => {
    const { user, router, actions } = portal(`/p/${ORG_B}`);
    const dialog = await screen.findByRole('dialog', { name: 'Your free trial' });
    await user.click(await within(dialog).findByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(locationOf(router)).toBe(`/p/${ORG_B}`);
    expect(actions()).toEqual(['welcome-skipped']);
    expect(trackPortal).toHaveBeenCalledWith('trial_card_prompt_skipped', { prompt: 'first_run' });
    resetTrialWelcomeOffer();
    await router.navigate({ to: `/p/${ORG_B}/clients` } as never);
    await router.navigate({ to: `/p/${ORG_B}` } as never);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closing it counts as Not now (D13)', async () => {
    const { user, actions } = portal(`/p/${ORG_B}?billing=true&step=welcome`);
    const dialog = await screen.findByRole('dialog', { name: 'Your free trial' });
    await within(dialog).findByRole('heading', { name: 'Your 14-day free trial has started' });
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(actions()).toEqual(['welcome-skipped']));
  });

  it('Add a card now records the answer and replaces the step with Subscribe (Back never returns to it)', async () => {
    const { user, router, actions, history } = portal(`/p/${ORG_B}`);
    const dialog = await screen.findByRole('dialog', { name: 'Your free trial' });
    await user.click(await within(dialog).findByRole('button', { name: 'Add a card now (recommended)' }));
    expect(await screen.findByRole('dialog', { name: 'Subscribe to Freelancer' })).toBeInTheDocument();
    expect(locationOf(router)).toBe(`/p/${ORG_B}?billing=true&step=subscribe`);
    expect(actions()).toEqual(['welcome-accepted']);
    expect(trackPortal).toHaveBeenCalledWith('trial_card_prompt_accepted', { prompt: 'first_run' });
    expect(history.length).toBe(1);
  });

  it('with no price pair it says the trial started and subscriptions open soon, with Continue only (D5)', async () => {
    const { user, actions } = portal(`/p/${ORG_B}`, { overview: overview({ configured: false, catalog: { ILS: null, USD: null } }) });
    const dialog = await screen.findByRole('dialog', { name: 'Your free trial' });
    expect(await within(dialog).findByText(/Subscriptions open soon/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /Add a card/ })).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/won't be charged/)).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(actions()).toEqual(['welcome-skipped']));
  });

  it('never opens for a person who answered, one with a card (Stripe pays), or inside the last 48 hours (D3)', async () => {
    for (const opts of [{ prompt: { ...UNANSWERED, welcomedAt: iso(-1), welcomeAnswer: 'skipped' as const } }, { billing: { ...trial(14), source: 'STRIPE' as const } }, { billing: trial(1.5) }]) {
      resetTrialWelcomeOffer();
      const { unmount } = portal(`/p/${ORG_B}`, opts);
      await screen.findByRole('heading', { level: 1, name: 'Overview' });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      unmount();
    }
  });

  it('opens in Arabic', async () => {
    portal(`/p/${ORG_B}`, { locale: 'ar' });
    const dialog = await screen.findByRole('dialog', { name: 'تجربتك المجانية' });
    expect(await within(dialog).findByRole('heading', { name: 'بدأت تجربتك المجانية لمدة 14 يومًا' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'أضف بطاقة الآن (موصى به)' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'ليس الآن' })).toBeInTheDocument();
  });
});

describe('the Home trial banner (AC3)', () => {
  const answered: TrialPrompt = { welcomedAt: iso(-1), welcomeAnswer: 'skipped', bannerSnoozedUntil: null };

  it('shows the days left with Add a card, which opens Subscribe', async () => {
    const { user, router } = portal(`/p/${ORG_B}`, { prompt: answered, billing: trial(9.5) });
    const banner = await screen.findByRole('region', { name: 'Your free trial' });
    expect(within(banner).getByText(/10 days left in your free trial/)).toBeInTheDocument();
    await user.click(await within(banner).findByRole('button', { name: 'Add a card' }));
    expect(locationOf(router)).toBe(`/p/${ORG_B}?billing=true&step=subscribe`);
    expect(trackPortal).toHaveBeenCalledWith('trial_card_prompt_accepted', { prompt: 'banner' });
  });

  it('Hide for 3 days hides it and stores the snooze', async () => {
    const { user, actions } = portal(`/p/${ORG_B}`, { prompt: answered });
    const banner = await screen.findByRole('region', { name: 'Your free trial' });
    await user.click(within(banner).getByRole('button', { name: 'Hide for 3 days' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Your free trial' })).not.toBeInTheDocument());
    expect(actions()).toEqual(['banner-snoozed']);
  });

  it('can’t be hidden in the last 3 days, even while snoozed', async () => {
    portal(`/p/${ORG_B}`, { prompt: { ...answered, bannerSnoozedUntil: iso(2) }, billing: trial(2.5) });
    const banner = await screen.findByRole('region', { name: 'Your free trial' });
    expect(within(banner).getByText(/3 days left/)).toBeInTheDocument();
    expect(within(banner).queryByRole('button', { name: 'Hide for 3 days' })).not.toBeInTheDocument();
  });

  it('is gone once a card is on file, and offers no card while nothing can be sold', async () => {
    const paid = portal(`/p/${ORG_B}`, { prompt: answered, billing: { ...trial(14), source: 'STRIPE' } });
    await screen.findByRole('heading', { level: 1, name: 'Overview' });
    expect(screen.queryByRole('region', { name: 'Your free trial' })).not.toBeInTheDocument();
    paid.unmount();
    portal(`/p/${ORG_B}`, { prompt: answered, overview: overview({ configured: false, catalog: { ILS: null, USD: null } }) });
    const banner = await screen.findByRole('region', { name: 'Your free trial' });
    await waitFor(() => expect(within(banner).queryByRole('button', { name: 'Add a card' })).not.toBeInTheDocument());
  });
});

describe('a link to / keeps the drawer keys (D14: mails and the lapse gate link to Billing)', () => {
  it('/?billing=true&step=subscribe lands on the first profile with Subscribe open', async () => {
    const { router } = portal('/?billing=true&step=subscribe', { prompt: { welcomedAt: iso(-1), welcomeAnswer: 'skipped', bannerSnoozedUntil: null } });
    expect(await screen.findByRole('dialog', { name: 'Subscribe to Freelancer' })).toBeInTheDocument();
    expect(locationOf(router)).toBe(`/p/${ORG_B}?billing=true&step=subscribe`);
  });
});
