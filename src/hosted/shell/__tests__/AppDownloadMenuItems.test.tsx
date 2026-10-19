import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { ORG_A, emptyProfileRoutes, me, ok, profile, renderPortal, stubApi } from '../../__tests__/harness';

const business = profile({ id: ORG_A, name: 'Nour Studio', writerOfRecord: null, owned: true, type: 'BUSINESS', isPersonalDefault: false });

/**
 * MUT-261: the account menu's last item is "get the app", reading the same
 * MOBILE_APP_LINKS config as the landing page (MUT-173) — both phone
 * apps link out to their store listings.
 */
describe('Account menu, app download (MUT-261)', () => {
  it('links the iPhone and Android apps, after Sign out', async () => {
    stubApi({ ...emptyProfileRoutes(), 'GET /v1/me': () => ok(me([business])) });
    const { user } = renderPortal(`/p/${ORG_A}`);
    await user.click(await screen.findByRole('button', { name: /Account/ }));
    const menu = screen.getByRole('menu', { name: 'Account' });

    const iosLink = within(menu).getByRole('menuitem', { name: /Get the iPhone app/ });
    expect(iosLink.tagName).toBe('A');
    // MUT-155: the portal's store links name their source, as the landing's do (A6)
    const href = new URL(iosLink.getAttribute('href')!);
    expect(decodeURI(`${href.origin}${href.pathname}`)).toBe('https://apps.apple.com/us/app/متابعة-مالية/id6821813829');
    expect(href.searchParams.get('ct')).toBe('mutaba3a-portal');
    expect(iosLink).toHaveAttribute('target', '_blank');
    expect(iosLink.getAttribute('rel')).toContain('noopener');

    const androidLink = within(menu).getByRole('menuitem', { name: /Get the Android app/ });
    expect(androidLink.tagName).toBe('A');
    const androidHref = new URL(androidLink.getAttribute('href')!);
    expect(`${androidHref.origin}${androidHref.pathname}`).toBe('https://play.google.com/store/apps/details');
    expect(androidHref.searchParams.get('id')).toBe('com.barmajiyat.mutaba3a');
    expect(androidHref.searchParams.get('referrer')).toContain('utm_campaign=mutaba3a-portal');
    expect(androidLink).toHaveAttribute('target', '_blank');
    expect(androidLink.getAttribute('rel')).toContain('noopener');
    expect(within(menu).queryByText(/coming soon/)).toBeNull();

    const items = menu.querySelectorAll('[role^="menuitem"]');
    expect(items[0]).toHaveTextContent('Sign out');
    expect(items[items.length - 2]).toBe(iosLink);
    expect(items[items.length - 1]).toBe(androidLink);
  });
});
