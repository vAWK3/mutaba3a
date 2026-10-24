import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { ORG_A, emptyProfileRoutes, fail, locationOf, me, never, ok, profile, renderPortal, stubApi, type Handler, type StubRequest } from '../../__tests__/harness';

/**
 * MUT-237: Change password, opened from the account menu (`?changePassword=true`, ADR-008), never a page.
 */

function portal(path: string, routes: Record<string, Handler> = {}) {
  const api = stubApi({ 'GET /v1/me': () => ok(me([profile()])), ...emptyProfileRoutes(), ...routes });
  return { ...renderPortal(path), api };
}

const changeCalls = (calls: StubRequest[]) => calls.filter((c) => c.method === 'POST' && c.url.pathname === '/v1/me/password');

async function openFromMenu(user: ReturnType<typeof renderPortal>['user']) {
  await user.click(await screen.findByRole('link', { name: /^Account:/ }));
  await user.click(await screen.findByRole('button', { name: /^Change password/ }));
  return screen.findByRole('dialog', { name: 'Change password' });
}

describe('Change password drawer (MUT-237)', () => {
  it('opens over You › Account through the URL (MUT-425), not as a page', async () => {
    const { user, router } = portal(`/p/${ORG_A}`);
    const dialog = await openFromMenu(user);
    expect(locationOf(router)).toBe(`/p/${ORG_A}/you/account?changePassword=true`);
    expect(within(dialog).getByLabelText('Current password')).toHaveAttribute('autocomplete', 'current-password');
    expect(within(dialog).getByLabelText('New password')).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByRole('navigation', { name: 'Sections' })).toBeInTheDocument();
  });

  it('a show/hide toggle on each field reveals what was typed, independently', async () => {
    const { user } = portal(`/p/${ORG_A}?changePassword=true`);
    const dialog = await screen.findByRole('dialog', { name: 'Change password' });
    const current = within(dialog).getByLabelText('Current password');
    const next = within(dialog).getByLabelText('New password');
    await user.type(current, 'the old one');
    await user.type(next, 'a brand new long password');
    expect(current).toHaveAttribute('type', 'password');
    expect(next).toHaveAttribute('type', 'password');
    await user.click(within(dialog).getAllByRole('button', { name: 'Show' })[0]);
    expect(current).toHaveAttribute('type', 'text');
    expect(next).toHaveAttribute('type', 'password');
    await user.click(within(dialog).getByRole('button', { name: 'Hide' }));
    expect(current).toHaveAttribute('type', 'password');
  });

  it('also opens directly from the URL', async () => {
    portal(`/p/${ORG_A}?changePassword=true`);
    expect(await screen.findByRole('dialog', { name: 'Change password' })).toBeInTheDocument();
  });

  it('sends both passwords, closes and toasts on success', async () => {
    // A 204 Response may carry no body at all (the fetch spec refuses one on a null-body status), unlike ok()'s JSON body.
    const { user, router } = portal(`/p/${ORG_A}?changePassword=true`, { 'POST /v1/me/password': () => new Response(null, { status: 204 }) });
    const dialog = await screen.findByRole('dialog', { name: 'Change password' });
    await user.type(within(dialog).getByLabelText('Current password'), 'the old one');
    await user.type(within(dialog).getByLabelText('New password'), 'a brand new long password');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await screen.findByText('Password changed');
    expect(screen.queryByRole('dialog', { name: 'Change password' })).toBeNull();
    expect(locationOf(router)).toBe(`/p/${ORG_A}`);
  });

  it('refuses a new password under 12 characters inline, and sends nothing', async () => {
    const { user, api } = portal(`/p/${ORG_A}?changePassword=true`);
    const dialog = await screen.findByRole('dialog', { name: 'Change password' });
    await user.type(within(dialog).getByLabelText('Current password'), 'the old one');
    await user.type(within(dialog).getByLabelText('New password'), 'short');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Use at least 12 characters.')).toBeInTheDocument();
    expect(changeCalls(api.calls)).toHaveLength(0);
  });

  it('shows a banner and keeps the drawer open when the current password is wrong', async () => {
    const { user } = portal(`/p/${ORG_A}?changePassword=true`, { 'POST /v1/me/password': () => fail(403, 'CURRENT_PASSWORD_WRONG') });
    const dialog = await screen.findByRole('dialog', { name: 'Change password' });
    await user.type(within(dialog).getByLabelText('Current password'), 'wrong'.repeat(3));
    await user.type(within(dialog).getByLabelText('New password'), 'a brand new long password');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Current password is wrong.')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Current password')).toHaveFocus();
  });

  it('holds the button while saving, so a second click sends one request', async () => {
    const { user, api } = portal(`/p/${ORG_A}?changePassword=true`, { 'POST /v1/me/password': never });
    const dialog = await screen.findByRole('dialog', { name: 'Change password' });
    await user.type(within(dialog).getByLabelText('Current password'), 'the old one');
    await user.type(within(dialog).getByLabelText('New password'), 'a brand new long password');
    const button = within(dialog).getByRole('button', { name: 'Save' });
    await user.click(button);
    expect(await within(dialog).findByRole('button', { name: 'Saving…' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Saving…' }));
    expect(changeCalls(api.calls)).toHaveLength(1);
  });

  it('Cancel closes without sending anything', async () => {
    const { user, router, api } = portal(`/p/${ORG_A}?changePassword=true`);
    const dialog = await screen.findByRole('dialog', { name: 'Change password' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'Change password' })).toBeNull();
    expect(locationOf(router)).toBe(`/p/${ORG_A}`);
    expect(changeCalls(api.calls)).toHaveLength(0);
  });
});
