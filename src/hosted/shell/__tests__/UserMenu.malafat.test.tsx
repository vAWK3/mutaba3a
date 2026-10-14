import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { ORG_A, emptyProfileRoutes, me, ok, profile, renderPortal, stubApi } from '../../__tests__/harness';

/**
 * MUT-191 S1 through the real shell: the account menu carries Malafat after
 * Sign out on an owned business profile, and toggles the switch in place.
 */
const business = profile({ id: ORG_A, name: 'Nour Studio', writerOfRecord: null, owned: true, type: 'BUSINESS', isPersonalDefault: false });

describe('Account menu, Malafat (MUT-191)', () => {
  it('lists the link and the switch after Sign out, and the switch PATCHes without closing the menu', async () => {
    const api = stubApi({
      ...emptyProfileRoutes(),
      'GET /v1/me': () => ok(me([business])),
      'PATCH /v1/me/malafat-suggestions': () => ok({ off: true, dismissed: [] }),
    });
    const { user } = renderPortal(`/p/${ORG_A}`);
    await user.click(await screen.findByRole('button', { name: /Account/ }));
    const menu = screen.getByRole('menu', { name: 'Account' });
    const items = menu.querySelectorAll('[role^="menuitem"]');
    expect(items[0]).toHaveTextContent('Sign out');
    const link = within(menu).getByRole('menuitem', { name: /Malafat, for law firms and accounting offices/ });
    expect(link.getAttribute('href')).toContain('utm_medium=portal&utm_campaign=malafat-upsell&utm_content=settings');
    const toggle = within(menu).getByRole('menuitemcheckbox', { name: 'Show Malafat suggestions' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await user.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'));
    expect(screen.getByRole('menu', { name: 'Account' })).toBeInTheDocument();
    expect(api.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ off: true });
  });

  it('carries nothing on a Malafat-fed firm', async () => {
    stubApi({ ...emptyProfileRoutes(), 'GET /v1/me': () => ok(me([profile({ id: ORG_A, writerOfRecord: 'MALAFAT' })])) });
    const { user } = renderPortal(`/p/${ORG_A}`);
    await user.click(await screen.findByRole('button', { name: /Account/ }));
    expect(within(screen.getByRole('menu', { name: 'Account' })).queryByText(/Malafat/)).toBeNull();
  });
});
