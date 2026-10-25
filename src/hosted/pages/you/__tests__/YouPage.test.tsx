import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import type { BillingEntitlement, Me } from '../../../api/client';
import { ORG_A, ORG_B, emptyProfileRoutes, locationOf, me, ok, profile, renderPortal, stubApi } from '../../../__tests__/harness';

/**
 * MUT-425: the You page replaces the profile switcher and the account menu. Every item from both is here (the
 * wireframe's "Nothing lost" table), each row opens today's drawer by its URL key, and switching keeps the section
 * the person came from (`?from=`, eng review D3/D4).
 */

const TERMS_URL = 'https://mutaba3a.example/terms';
const DAY = 24 * 60 * 60 * 1000;
const ent = (state: BillingEntitlement['state'], source: BillingEntitlement['source'], until: string | null = null): BillingEntitlement => ({ state, source, tier: 'FREELANCER', until });

const personal = profile({ id: ORG_A, name: 'Personal', owned: true, type: 'PERSONAL', isPersonalDefault: true, writerOfRecord: null });
const studio = profile({ id: ORG_B, name: 'Nour Studio', owned: true, type: 'BUSINESS', isPersonalDefault: false, writerOfRecord: null });

function portal(path: string, account: Me = me([personal, studio])) {
  stubApi({ ...emptyProfileRoutes(), 'GET /v1/me': () => ok(account) });
  return renderPortal(path);
}

const part = (name: string) => screen.getByRole('navigation', { name: 'You' }).querySelector(`[aria-current="page"]`)?.textContent === name;

afterEach(() => vi.unstubAllGlobals());

describe('the You page (MUT-425)', () => {
  it('opens on Profiles, with the person in the header and the three parts as links', async () => {
    portal(`/p/${ORG_A}/you`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Nour Haddad' })).toBeInTheDocument();
    expect(within(screen.getByRole('main')).getByText('nour@firm.ps')).toHaveAttribute('dir', 'ltr');
    const tabs = within(screen.getByRole('navigation', { name: 'You' })).getAllByRole('link');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Profiles', 'Account', 'App']);
    expect(part('Profiles')).toBe(true);
  });

  it('Profiles lists each profile with its kind and Hosted, marks the open one, and keeps the local note', async () => {
    portal(`/p/${ORG_B}/you`);
    const open = await screen.findByRole('button', { name: /Nour Studio/ });
    expect(open).toHaveAttribute('aria-current', 'true');
    expect(open).toHaveTextContent('Hosted');
    expect(open).toHaveTextContent('Business');
    expect(screen.getByRole('button', { name: /^Personal/ })).not.toHaveAttribute('aria-current');
    expect(screen.getByText(/Your local profiles stay in the MTB3A app/)).toBeInTheDocument();
  });

  it.each([
    ['+ New profile', 'newProfile=true'],
    ['Manage profiles', 'manageProfiles=true'],
  ])('Profiles › %s opens its drawer by URL', async (name, key) => {
    const { user, router } = portal(`/p/${ORG_A}/you`);
    await user.click(await screen.findByRole('button', { name: new RegExp(name.replace('+', '\\+')) }));
    expect(locationOf(router)).toContain(key);
  });

  it('at the cap, New profile says so and opens nothing', async () => {
    const full = { ...me([personal, studio]), limits: { ownedProfiles: 6, maxOwnedProfiles: 6 } };
    const { user, router } = portal(`/p/${ORG_A}/you`, full);
    const row = await screen.findByRole('button', { name: /New profile/ });
    expect(row).toHaveAttribute('aria-disabled', 'true');
    expect(row).toHaveTextContent('6 of 6');
    await user.click(row);
    expect(locationOf(router)).not.toContain('newProfile');
  });

  it('under the lapse gate, New profile says why it is off', async () => {
    const lapsed = { ...me([{ ...personal, billing: ent('READ_ONLY', 'TRIAL') }]), billingStanding: 'read-only' as const };
    portal(`/p/${ORG_A}/you`, lapsed);
    expect(await screen.findByRole('button', { name: /New profile/ })).toHaveTextContent('Subscribe to add a profile: your plan has ended.');
  });

  describe('switching keeps the section (eng review D3, D4)', () => {
    it('goes to the section the person came from, in the picked profile', async () => {
      const { user, router } = portal(`/p/${ORG_A}/you?from=payments`);
      await user.click(await screen.findByRole('button', { name: /Nour Studio/ }));
      await waitFor(() => expect(locationOf(router)).toBe(`/p/${ORG_B}/payments`));
    });

    it('goes to the profile home without a from, or with one it does not know', async () => {
      const { user, router } = portal(`/p/${ORG_A}/you?from=bogus`);
      await user.click(await screen.findByRole('button', { name: /Nour Studio/ }));
      await waitFor(() => expect(locationOf(router)).toMatch(new RegExp(`^/p/${ORG_B}/?$`)));
    });

    it('the open profile goes back to its section the same way, never through history', async () => {
      const { user, router } = portal(`/p/${ORG_B}/you?from=clients`);
      const back = vi.spyOn(router.history, 'back');
      await user.click(await screen.findByRole('button', { name: /Nour Studio/ }));
      await waitFor(() => expect(locationOf(router)).toBe(`/p/${ORG_B}/clients`));
      expect(back).not.toHaveBeenCalled();
    });

    it('keeps from across the part tabs and a drawer opening and closing', async () => {
      const { user, router } = portal(`/p/${ORG_A}/you?from=expenses`);
      await user.click(await screen.findByRole('link', { name: 'Account' }));
      await waitFor(() => expect(locationOf(router)).toBe(`/p/${ORG_A}/you/account?from=expenses`));
      await user.click(screen.getByRole('button', { name: /Change password/ }));
      expect(locationOf(router)).toContain('changePassword=true');
      await user.click(await screen.findByRole('button', { name: 'Close' }));
      await waitFor(() => expect(locationOf(router)).toBe(`/p/${ORG_A}/you/account?from=expenses`));
      await user.click(screen.getByRole('link', { name: 'Profiles' }));
      await user.click(await screen.findByRole('button', { name: /Nour Studio/ }));
      await waitFor(() => expect(locationOf(router)).toBe(`/p/${ORG_B}/expenses`));
    });

    it('the island carries the section the person is in, and the part tabs pass it on (MUT-426, C3)', async () => {
      const { user, router } = portal(`/p/${ORG_B}/payments`);
      await user.click(await screen.findByRole('link', { name: 'You · Nour Studio' }));
      await waitFor(() => expect(locationOf(router)).toBe(`/p/${ORG_B}/you?from=payments`));
      // On the You page the part tabs pass the kept section on (outside voice O1)
      await user.click(screen.getByRole('link', { name: 'Account' }));
      await waitFor(() => expect(locationOf(router)).toBe(`/p/${ORG_B}/you/account?from=payments`));
      // One current part, and the island lit while on You
      expect(screen.getByRole('link', { name: 'Account' })).toHaveAttribute('aria-current', 'page');
      expect(screen.getByRole('link', { name: 'You · Nour Studio' })).toHaveAttribute('aria-current', 'page');
    });
  });

  describe('Account', () => {
    it.each([
      ['Billing', 'billing=true'],
      ['Your data', 'yourData=true'],
      ['Change password', 'changePassword=true'],
      // MUT-333
      ['Close my account', 'closeAccount=true'],
    ])('%s opens its drawer by URL', async (name, key) => {
      const { user, router } = portal(`/p/${ORG_A}/you/account`);
      await user.click(await screen.findByRole('button', { name: new RegExp(`^${name}`) }));
      expect(locationOf(router)).toContain(key);
    });

    it('shows the trial on Billing (eng review D6), Sign out set apart, and Close my account apart after it (MUT-333)', async () => {
      const trial = me([{ ...personal, billing: ent('ACTIVE', 'TRIAL', new Date(Date.now() + 9.5 * DAY).toISOString()) }]);
      portal(`/p/${ORG_A}/you/account`, trial);
      expect(await screen.findByRole('button', { name: /^Billing/ })).toHaveTextContent('10 days left in your free trial');
      const rows = screen.getAllByRole('button').filter((b) => b.classList.contains('hp-you-row'));
      expect(rows[rows.length - 2]).toHaveTextContent('Sign out');
      expect(rows[rows.length - 1]).toHaveTextContent('Close my account');
    });
  });

  describe('App', () => {
    it('heads App with the product wordmark, since the chrome has none (MUT-426 D3)', async () => {
      portal(`/p/${ORG_A}/you/app`);
      const main = await screen.findByRole('main');
      expect(await within(main).findByRole('img', { name: 'MTB3A' })).toBeInTheDocument();
    });

    it('has Language, then Terms in a new tab and the phone apps last', async () => {
      vi.stubGlobal('__TERMS_URL__', TERMS_URL);
      portal(`/p/${ORG_A}/you/app`);
      expect(await screen.findByRole('group', { name: 'Language' })).toBeInTheDocument();
      const terms = screen.getByRole('link', { name: /Terms of service/ });
      expect(terms).toHaveAttribute('href', `${TERMS_URL}?lang=en`);
      expect(terms).toHaveAttribute('target', '_blank');
      const links = screen.getAllByRole('link').filter((a) => a.classList.contains('hp-you-row'));
      expect(links.slice(-2).map((a) => a.textContent)).toEqual([expect.stringMatching(/Get the iPhone app/), expect.stringMatching(/Get the Android app/)]);
    });

    it('carries Malafat on an eligible business profile only', async () => {
      portal(`/p/${ORG_B}/you/app`);
      expect(await screen.findByRole('switch', { name: 'Show Malafat suggestions' })).toBeInTheDocument();
    });

    it('carries no Malafat on a personal profile', async () => {
      portal(`/p/${ORG_A}/you/app`);
      await screen.findByRole('group', { name: 'Language' });
      expect(screen.queryByText(/Malafat/)).toBeNull();
    });
  });

  it('a LOCKED profile still opens the You page, under the locked banner (eng E1, D7)', async () => {
    const locked = { ...me([{ ...personal, billing: ent('LOCKED', 'TRIAL') }]), billingStanding: 'locked' as const };
    stubApi({ ...emptyProfileRoutes(), 'GET /v1/me': () => ok(locked), 'GET /v1/billing': () => ok(null) });
    const { user, router } = renderPortal(`/p/${ORG_A}/you/account`);
    expect(await screen.findByRole('region', { name: 'Your plan' })).toHaveTextContent('Subscribe or download your records');
    const row = screen.getAllByRole('button', { name: /^Billing/ }).find((b) => b.classList.contains('hp-you-row'))!;
    expect(row).toHaveTextContent('Locked');
    await user.click(row);
    expect(locationOf(router)).toContain('billing=true');
  });

  it('works without a profile at /you (eng D3): someone with none still reaches their account', async () => {
    const { user, router } = portal('/you/account', me([]));
    await user.click(await screen.findByRole('button', { name: /Change password/ }));
    expect(locationOf(router)).toContain('/you/account?changePassword=true');
  });
});
