import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { ORG_A, ORG_B, emptyProfileRoutes, fail, locationOf, me, ok, profile, renderPortal, stubApi, type Handler, type StubRequest } from '../../__tests__/harness';
import { closeAccountImpactOf, closingDayLabel } from '../../data/closeAccount';

/**
 * MUT-333 (ADR-188): Close my account, a drawer from the account menu (`?closeAccount=true`), and the closing page
 * AuthGate shows while the account is closing.
 */
const ME_ID = '99999999-9999-4999-8999-999999999999';
const DELETE_AFTER = '2026-12-01T09:00:00.000Z';
const closing = { requestedAt: '2026-11-01T09:00:00.000Z', deleteAfter: DELETE_AFTER };

const personal = profile({ id: ORG_A, name: 'Personal', writerOfRecord: null, isPersonalDefault: true, owned: true, type: 'PERSONAL', owners: [{ userId: ME_ID, name: 'Nour Haddad', email: 'nour@firm.ps', creator: true }] });
const shared = profile({
  id: ORG_B,
  name: 'Haddad Studio',
  writerOfRecord: null,
  owned: true,
  type: 'BUSINESS',
  owners: [
    { userId: ME_ID, name: 'Nour Haddad', email: 'nour@firm.ps', creator: true },
    { userId: '11111111-1111-4111-8111-111111111111', name: 'Lina Saleh', email: 'lina@studio.ps', creator: false },
  ],
});
const firm = profile({ id: '33333333-3333-4333-8333-333333333333', name: 'Haddad & Partners' });

function portal(path: string, routes: Record<string, Handler> = {}, profiles = [personal, shared, firm]) {
  const api = stubApi({ 'GET /v1/me': () => ok(me(profiles)), ...emptyProfileRoutes(), ...routes });
  return { ...renderPortal(path), api };
}
const closeCalls = (calls: StubRequest[]) => calls.filter((c) => c.method === 'POST' && c.url.pathname === '/v1/me/closure');

describe('closeAccountImpactOf (MUT-333)', () => {
  it('deletes what only the person owns, passes a shared profile they created to its co-owners, keeps the rest', () => {
    const coOwnedNotMine = profile({ id: 'c', name: 'Their studio', owned: true, type: 'BUSINESS', owners: [{ userId: 'x', name: 'Omar', email: 'o@x.ps', creator: true }, { userId: ME_ID, name: 'Nour', email: 'nour@firm.ps', creator: false }] });
    expect(closeAccountImpactOf(me([personal, shared, firm, coOwnedNotMine]))).toEqual({
      deletes: ['Personal'],
      passesOn: [{ profile: 'Haddad Studio', people: ['Lina Saleh'] }],
      leaves: ['Haddad & Partners', 'Their studio'],
    });
  });

  it('names the deletion day in the language, allowing for the hourly job', () => {
    expect(closingDayLabel(DELETE_AFTER, 'en', 'Asia/Jerusalem')).toBe('December 1, 2026');
    expect(closingDayLabel('2026-12-01T22:30:00.000Z', 'en', 'Asia/Jerusalem')).toBe('December 2, 2026');
    expect(closingDayLabel(DELETE_AFTER, 'en', 'Not/AZone')).toMatch(/2026/);
  });
});

describe('Close my account drawer (MUT-333)', () => {
  it('opens from the account menu over the current page, through the URL', async () => {
    const { user, router } = portal(`/p/${ORG_A}`);
    await user.click(await screen.findByRole('button', { name: /Account/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Close my account' }));
    const dialog = await screen.findByRole('dialog', { name: 'Close my account' });
    expect(locationOf(router)).toBe(`/p/${ORG_A}?closeAccount=true`);
    expect(within(dialog).getByLabelText('Your password')).toHaveAttribute('autocomplete', 'current-password');
  });

  it('says what goes and what stays for each profile, and whose account it is', async () => {
    portal(`/p/${ORG_A}?closeAccount=true`);
    const dialog = await screen.findByRole('dialog', { name: 'Close my account' });
    expect(within(dialog).getByText('These profiles, with every record and receipt in them: Personal.')).toBeInTheDocument();
    expect(within(dialog).getByText('Haddad Studio passes to Lina Saleh, with everything in it.')).toBeInTheDocument();
    expect(within(dialog).getByText('Haddad & Partners keeps the records you added, without your name. Only your access ends.')).toBeInTheDocument();
    expect(within(dialog).getByText('nour@firm.ps')).toBeInTheDocument();
  });

  it('Download my records opens Your data in its place', async () => {
    const { user, router } = portal(`/p/${ORG_A}?closeAccount=true`, { 'GET /v1/records-export': () => ok({}) });
    const dialog = await screen.findByRole('dialog', { name: 'Close my account' });
    await user.click(within(dialog).getByRole('button', { name: 'Download my records' }));
    expect(await screen.findByRole('dialog', { name: 'Your data' })).toBeInTheDocument();
    expect(locationOf(router)).toBe(`/p/${ORG_A}?yourData=true`);
  });

  it('sends nothing without a password', async () => {
    const { user, api } = portal(`/p/${ORG_A}?closeAccount=true`);
    const dialog = await screen.findByRole('dialog', { name: 'Close my account' });
    await user.click(within(dialog).getByRole('button', { name: 'Close my account' }));
    expect(closeCalls(api.calls)).toHaveLength(0);
  });

  it('a wrong password is a banner; the drawer stays with what was typed', async () => {
    const { user } = portal(`/p/${ORG_A}?closeAccount=true`, { 'POST /v1/me/closure': () => fail(403, 'CURRENT_PASSWORD_WRONG') });
    const dialog = await screen.findByRole('dialog', { name: 'Close my account' });
    await user.type(within(dialog).getByLabelText('Your password'), 'not it at all');
    await user.click(within(dialog).getByRole('button', { name: 'Close my account' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('That password is wrong.');
    expect(within(dialog).getByLabelText('Your password')).toHaveValue('not it at all');
  });

  it('when Stripe can’t be reached, says nothing changed', async () => {
    const { user } = portal(`/p/${ORG_A}?closeAccount=true`, { 'POST /v1/me/closure': () => fail(502, 'STRIPE_UNAVAILABLE') });
    const dialog = await screen.findByRole('dialog', { name: 'Close my account' });
    await user.type(within(dialog).getByLabelText('Your password'), 'the password');
    await user.click(within(dialog).getByRole('button', { name: 'Close my account' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent("We couldn't reach our payment provider, so nothing changed.");
  });

  it('closes with the password, and the closing page takes over', async () => {
    let closed = false;
    const { user, api } = portal(`/p/${ORG_A}?closeAccount=true`, {
      'GET /v1/me': () => ok({ ...me([personal, shared, firm]), user: { ...me().user, closure: closed ? closing : null } }),
      'POST /v1/me/closure': () => {
        closed = true;
        return ok({ closure: closing, subscriptionsEnded: 0, subscriptionsCancelled: 0 });
      },
    });
    const dialog = await screen.findByRole('dialog', { name: 'Close my account' });
    await user.type(within(dialog).getByLabelText('Your password'), 'the password');
    await user.click(within(dialog).getByRole('button', { name: 'Close my account' }));
    expect(await screen.findByRole('heading', { name: 'Your account is closing' })).toBeInTheDocument();
    expect(closeCalls(api.calls)[0]?.body).toEqual({ password: 'the password' });
  });
});

describe('The closing page (MUT-333)', () => {
  const closingMe = (locale: 'en' | 'ar' = 'en') => ({ ...me([personal], locale), user: { ...me([personal], locale).user, closure: closing } });

  it('stands in place of the portal and names the day', async () => {
    portal(`/p/${ORG_A}`, { 'GET /v1/me': () => ok(closingMe()) });
    expect(await screen.findByRole('heading', { name: 'Your account is closing' })).toBeInTheDocument();
    expect(screen.getByText("We'll delete your account and its records on December 1, 2026.")).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Sections' })).toBeNull();
  });

  it('Keep my account keeps it and returns to the portal with a note', async () => {
    let kept = false;
    const { user } = portal(`/p/${ORG_A}`, {
      'GET /v1/me': () => ok(kept ? me([personal]) : closingMe()),
      'DELETE /v1/me/closure': () => {
        kept = true;
        return ok({ billingNeedsAttention: false });
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Keep my account' }));
    expect(await screen.findByText('Your account stays open.')).toBeInTheDocument();
    expect(await screen.findByRole('navigation', { name: 'Sections' })).toBeInTheDocument();
  });

  it('says when a subscription still needs turning back on', async () => {
    let kept = false;
    const { user } = portal(`/p/${ORG_A}`, {
      'GET /v1/me': () => ok(kept ? me([personal]) : closingMe()),
      'DELETE /v1/me/closure': () => {
        kept = true;
        return ok({ billingNeedsAttention: true });
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Keep my account' }));
    expect(await screen.findByText('Your account stays open. Your subscription is still set to end: open Billing to keep it.')).toBeInTheDocument();
  });

  it('in Arabic, names the day in Arabic', async () => {
    portal(`/p/${ORG_A}`, { 'GET /v1/me': () => ok(closingMe('ar')) });
    expect(await screen.findByRole('heading', { name: 'حسابك قيد الإغلاق' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'الإبقاء على حسابي' })).toBeInTheDocument();
  });

  it('comes before the terms step: a closing person needn’t accept new terms', async () => {
    portal(`/p/${ORG_A}`, { 'GET /v1/me': () => ok({ ...closingMe(), terms: { version: '2099-01-01', accepted: false } }) });
    expect(await screen.findByRole('heading', { name: 'Your account is closing' })).toBeInTheDocument();
  });
});
