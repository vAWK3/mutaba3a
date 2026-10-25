import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import type { BillingEntitlement } from '../../api/client';
import { ORG_A, ORG_B, emptyProfileRoutes, locationOf, me, ok, profile, renderPortal, stubApi } from '../../__tests__/harness';
import { PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';
import type { Me } from '../../session/me';

/**
 * MUT-426: the floating shell. No sidebar and no header bar: the Reports corner icon, the pill (Owed · Paid · Spent ·
 * Clients) and the You island, in that order, over the page. The island carries MUT-425's contract (C3): `?from=` on
 * the way in, the profile-less `/you`, and the lit state on You; plus the exact page to return to (D7).
 */

const EMPTY = ok({ items: [], nextCursor: null });
const LOCKED: BillingEntitlement = { state: 'LOCKED', source: 'TRIAL', tier: 'FREELANCER', until: null };

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
});
afterEach(() => vi.unstubAllGlobals());

function portal(path: string, body: Me = me([profile(), profile({ id: ORG_B, name: 'Side Studio' })])) {
  stubApi({
    'GET /v1/me': () => ok(body),
    ...emptyProfileRoutes(),
    'GET /v1/customers': () => EMPTY,
    'GET /v1/expenses': () => EMPTY,
    'GET /v1/expense-groups': () => EMPTY,
    'GET /v1/conversions': () => EMPTY,
    'GET /v1/billing': () => ok({ configured: false }),
  });
  return renderPortal(path);
}

const island = () => screen.findByRole('link', { name: /^You/ });
const hrefOf = (link: HTMLElement) => link.getAttribute('href');

describe('the floating shell (MUT-426)', () => {
  it('has no sidebar and no header bar, and puts Reports, the pill and the island in reading order', async () => {
    const { container } = portal(`/p/${ORG_A}`);
    const pill = await screen.findByRole('navigation', { name: 'Sections' });
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    // A page's own header sits inside <main>; only one outside it would be a header bar
    expect(screen.queryAllByRole('banner').filter((header) => !header.closest('main'))).toEqual([]);
    expect(container.querySelectorAll('.hp-chrome')).toHaveLength(1);
    // The chrome is one landmark named for the product, so Reports and the island sit in one (axe region)
    expect(screen.getByRole('navigation', { name: 'MTB3A' })).toBe(container.querySelector('.hp-chrome'));

    const chrome = container.querySelector('.hp-chrome') as HTMLElement;
    const order = within(chrome).getAllByRole('link').map((link) => link.getAttribute('aria-label') ?? link.textContent);
    expect(order).toEqual(['Reports', 'Owed', 'Paid', 'Spent', 'Clients', 'You · Haddad & Partners']);
    expect(within(pill).getAllByRole('link')).toHaveLength(4);
  });

  it('lights exactly one tab', async () => {
    portal(`/p/${ORG_A}/payments`);
    const pill = await screen.findByRole('navigation', { name: 'Sections' });
    const lit = within(pill)
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page')
      .map((link) => link.textContent);
    expect(lit).toEqual(['Paid']);
  });

  it('opens Reports from the corner icon, lit there and on no tab', async () => {
    const { user, router } = portal(`/p/${ORG_A}`);
    await user.click(await screen.findByRole('link', { name: 'Reports' }));
    expect(locationOf(router)).toBe(`/p/${ORG_A}/reports`);
    expect(screen.getByRole('link', { name: 'Reports' })).toHaveAttribute('aria-current', 'page');
    const pill = screen.getByRole('navigation', { name: 'Sections' });
    expect(within(pill).getAllByRole('link').filter((link) => link.hasAttribute('aria-current'))).toEqual([]);
  });

  describe('the You island', () => {
    it('shows the profile name and the avatar, ringed in the profile colour, with the name in its label for a phone', async () => {
      portal(`/p/${ORG_A}`);
      const link = await island();
      expect(link).toHaveAccessibleName('You · Haddad & Partners');
      expect(link.querySelector('.hp-island-name')).toHaveTextContent('Haddad & Partners');
      const avatar = link.querySelector('.hp-island-avatar') as HTMLElement;
      expect(avatar).toHaveTextContent('NH');
      expect(avatar.style.getPropertyValue('--hp-ring')).toMatch(/^var\(--profile-ring-[1-6]\)$/);
    });

    it('carries no back from a section’s own page, where the island returns anyway', async () => {
      portal(`/p/${ORG_A}/payments`);
      expect(hrefOf(await island())).toBe(`/p/${ORG_A}/you?from=payments`);
    });

    it('opens You › Profiles carrying the section and the exact page it was opened from', async () => {
      const { user, router } = portal(`/p/${ORG_A}/clients/c-1`);
      const link = await island();
      expect(link).not.toHaveAttribute('aria-current');
      const back = encodeURIComponent(`/p/${ORG_A}/clients/c-1`);
      expect(hrefOf(link)).toBe(`/p/${ORG_A}/you?from=clients&back=${back}`);
      await user.click(link);
      expect(router.state.location.pathname).toBe(`/p/${ORG_A}/you`);
    });

    it('is lit on You, and a second press returns to the exact page (D7)', async () => {
      const back = encodeURIComponent(`/p/${ORG_A}/clients/c-1`);
      const { user, router } = portal(`/p/${ORG_A}/you/account?from=clients&back=${back}`);
      const link = await island();
      expect(link).toHaveAttribute('aria-current', 'page');
      expect(hrefOf(link)).toBe(`/p/${ORG_A}/clients/c-1`);
      await user.click(link);
      expect(router.state.location.pathname).toBe(`/p/${ORG_A}/clients/c-1`);
    });

    it('returns to the kept section when back points at another profile', async () => {
      const back = encodeURIComponent(`/p/${ORG_B}/clients/c-1`);
      portal(`/p/${ORG_A}/you?from=clients&back=${back}`);
      expect(hrefOf(await island())).toBe(`/p/${ORG_A}/clients`);
    });

    it('returns to the profile home with nothing kept', async () => {
      portal(`/p/${ORG_A}/you`);
      expect(hrefOf(await island())).toBe(`/p/${ORG_A}`);
    });

    it('keeps from and back on every part tab of the You page', async () => {
      const back = encodeURIComponent(`/p/${ORG_A}/reports`);
      portal(`/p/${ORG_A}/you?from=reports&back=${back}`);
      const parts = await screen.findByRole('navigation', { name: 'You' });
      for (const tab of within(parts).getAllByRole('link')) {
        expect(hrefOf(tab)).toContain('from=reports');
        expect(hrefOf(tab)).toContain(`back=${back}`);
      }
    });

    it('leaves You from any tab', async () => {
      const { user, router } = portal(`/p/${ORG_A}/you`);
      const pill = await screen.findByRole('navigation', { name: 'Sections' });
      await user.click(within(pill).getByRole('link', { name: 'Paid' }));
      expect(router.state.location.pathname).toBe(`/p/${ORG_A}/payments`);
      expect(await island()).not.toHaveAttribute('aria-current');
    });
  });

  it('shows only the island on a locked profile', async () => {
    const body = { ...me([profile({ billing: LOCKED })]), billingStanding: 'locked' as const };
    portal(`/p/${ORG_A}`, body);
    expect(await island()).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Sections' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Reports' })).not.toBeInTheDocument();
  });

  describe('with no profile', () => {
    it('shows only the island, linking to the profile-less You page with a neutral ring', async () => {
      portal('/', me([]));
      const link = await island();
      expect(link).toHaveAccessibleName('You');
      expect(hrefOf(link)).toBe('/you');
      expect(link.querySelector('.hp-island-name')).not.toBeInTheDocument();
      expect((link.querySelector('.hp-island-avatar') as HTMLElement).style.getPropertyValue('--hp-ring')).toBe('');
      expect(screen.queryByRole('navigation', { name: 'Sections' })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Reports' })).not.toBeInTheDocument();
    });

    it('is lit on the profile-less You page and leaves it for home', async () => {
      portal('/you/account?from=payments', me([]));
      const link = await island();
      expect(link).toHaveAttribute('aria-current', 'page');
      expect(hrefOf(link)).toBe('/');
    });
  });

  it('names the island in Arabic', async () => {
    localStorage.setItem(PORTAL_LANGUAGE_KEY, 'ar');
    portal(`/p/${ORG_A}`);
    expect(await screen.findByRole('link', { name: 'أنت · Haddad & Partners' })).toBeInTheDocument();
  });
});
