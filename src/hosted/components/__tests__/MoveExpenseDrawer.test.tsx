import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { ORG_A, ORG_B, emptyProfileRoutes, fail, locationOf, me, ok, profile, renderPortal, stubApi, type Handler } from '../../__tests__/harness';
import type { BillingEntitlement, HostedProfile } from '../../api/client';

/**
 * MUT-589 (ADR-252): moving a saved expense, with its receipts, to another profile from the portal: Move in the
 * expense drawer (hidden with one profile or read-only), the drawer's changes list from the preview, the move with
 * the preview's version, the refusals, and both profiles refreshing.
 */

const E1 = 'e0000000-0000-4000-8000-000000000001';
const open: BillingEntitlement = { state: 'ACTIVE', source: 'TRIAL', tier: 'FREELANCER', until: null };
const readOnly: BillingEntitlement = { state: 'READ_ONLY', source: 'TRIAL', tier: 'FREELANCER', until: null };
const own = { writerOfRecord: null, owned: true, access: { payments: 'read-write', expenses: 'read-write', capture: 'read-write' } } as const;
const personal = (billing: BillingEntitlement | null = null) => profile({ id: ORG_B, name: 'Personal', isPersonalDefault: true, type: 'PERSONAL', ...own, billing });
const studio = (billing: BillingEntitlement | null = null) => profile({ id: ORG_A, name: 'Noor Design Studio', type: 'BUSINESS', ...own, billing });

const EXPENSE = { id: E1, organizationId: ORG_B, amount: '117.00', currency: 'ILS', occurredOn: '2026-11-02', title: 'Laptop stand', vendor: 'Office Depot', categoryId: null, customerId: null, projectId: null, notes: null, version: 3, captureSource: null, receipts: [] };
const PREVIEW = { changes: [{ field: 'category', from: 'Hobby', to: 'Other' }, { field: 'client', from: 'Nour Legal', to: null }], receiptCount: 2, expenseVersion: 3 };

function portal(path: string, opts: { profiles?: HostedProfile[]; standing?: 'open' | 'read-only' | null; routes?: Record<string, Handler> } = {}) {
  const body = { ...me(opts.profiles ?? [personal(), studio()]), billingStanding: opts.standing ?? null };
  const api = stubApi({
    'GET /v1/me': () => ok(body),
    ...emptyProfileRoutes(),
    'GET /v1/expense-categories': () => ok([]),
    'GET /v1/expense-groups': () => ok([]),
    'GET /v1/expenses': () => ok({ items: [], nextCursor: null }),
    [`GET /v1/expenses/${E1}`]: () => ok(EXPENSE),
    [`GET /v1/expenses/${E1}/move-preview`]: () => ok(PREVIEW),
    ...opts.routes,
  });
  return { ...renderPortal(path), api };
}

const expenses = `/p/${ORG_B}/expenses`;
const moves = (calls: { method: string; url: URL }[]) => calls.filter((c) => c.method === 'POST' && c.url.pathname === `/v1/expenses/${E1}/move`);

afterEach(() => vi.unstubAllGlobals());

describe('Move in the expense drawer (MUT-589)', () => {
  it('shows Move beside Delete; it opens the move drawer from the URL', async () => {
    const { user, router } = portal(`${expenses}?expense=${E1}`);
    const drawer = await screen.findByRole('dialog', { name: /Edit expense/ });
    await user.click(await within(drawer).findByRole('button', { name: 'Move' }));
    expect(locationOf(router)).toBe(`${expenses}?moveExpense=${E1}`);
    expect(await screen.findByRole('dialog', { name: 'Move expense' })).toBeInTheDocument();
  });

  it('with one profile there is no Move, and ?moveExpense opens nothing', async () => {
    portal(`${expenses}?expense=${E1}`, { profiles: [personal()] });
    const drawer = await screen.findByRole('dialog', { name: /Edit expense/ });
    await within(drawer).findByRole('button', { name: 'Delete' });
    expect(within(drawer).queryByRole('button', { name: 'Move' })).toBeNull();
  });

  it('a read-only profile offers no Move', async () => {
    portal(`${expenses}?expense=${E1}`, { profiles: [personal(readOnly), studio(open)], standing: 'read-only' });
    const drawer = await screen.findByRole('dialog', { name: /expense/i });
    expect(within(drawer).queryByRole('button', { name: 'Move' })).toBeNull();
  });
});

describe('the Move expense drawer (MUT-589, D1)', () => {
  it('choosing a profile lists what changes there and how many receipts go with it; Move is held until then', async () => {
    const { user, api } = portal(`${expenses}?moveExpense=${E1}`);
    const dialog = await screen.findByRole('dialog', { name: 'Move expense' });
    expect(within(dialog).getByRole('button', { name: 'Move' })).toBeDisabled();
    await user.click(within(dialog).getByRole('radio', { name: /Noor Design Studio/ }));
    expect(await within(dialog).findByText('What changes on Noor Design Studio')).toBeInTheDocument();
    const rows = within(dialog).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual(['CategoryOther was Hobby', 'ClientRemoved was Nour Legal']);
    expect(within(dialog).getByText('Its 2 receipts move with it.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Move to Noor Design Studio' })).toBeEnabled();
    const previewCall = api.calls.find((c) => c.url.pathname.endsWith('/move-preview'))!;
    expect(previewCall.url.searchParams.get('profileId')).toBe(ORG_A);
    expect(previewCall.headers.get('X-Mutaba3a-Profile')).toBe(ORG_B);
  });

  it('says nothing else changes when the list is empty', async () => {
    const { user } = portal(`${expenses}?moveExpense=${E1}`, { routes: { [`GET /v1/expenses/${E1}/move-preview`]: () => ok({ changes: [], receiptCount: 0, expenseVersion: 3 }) } });
    const dialog = await screen.findByRole('dialog', { name: 'Move expense' });
    await user.click(within(dialog).getByRole('radio', { name: /Noor Design Studio/ }));
    expect(await within(dialog).findByText(/Nothing else changes/)).toBeInTheDocument();
  });

  it('moves with the preview\'s version and an Idempotency-Key; the drawer closes and the toast names the profile', async () => {
    const { user, api, router } = portal(`${expenses}?moveExpense=${E1}`, { routes: { [`POST /v1/expenses/${E1}/move`]: () => ok({ expense: { ...EXPENSE, organizationId: ORG_A, version: 4 }, fromProfileId: ORG_B, changes: PREVIEW.changes }) } });
    const dialog = await screen.findByRole('dialog', { name: 'Move expense' });
    await user.click(within(dialog).getByRole('radio', { name: /Noor Design Studio/ }));
    await user.click(await within(dialog).findByRole('button', { name: 'Move to Noor Design Studio' }));
    await waitFor(() => expect(moves(api.calls)).toHaveLength(1));
    const call = moves(api.calls)[0]!;
    expect(call.body).toEqual({ profileId: ORG_A, expectedVersion: 3 });
    expect(call.headers.get('Idempotency-Key')).toBeTruthy();
    expect(await screen.findByText('Moved to Noor Design Studio')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Move expense' })).toBeNull());
    expect(locationOf(router)).toBe(expenses);
    // This profile's list refreshes (the target's refreshes when it is next shown: its queries are invalidated too).
    await waitFor(() => expect(api.calls.filter((c) => c.method === 'GET' && c.url.pathname === '/v1/expenses' && c.headers.get('X-Mutaba3a-Profile') === ORG_B).length).toBeGreaterThan(1));
  });

  it('a refused preview shows its reason in the banner and Move stays held', async () => {
    const { user } = portal(`${expenses}?moveExpense=${E1}`, { routes: { [`GET /v1/expenses/${E1}/move-preview`]: () => fail(403, 'READ_ONLY_PROFILE', { reason: 'NOT_OWNER' }) } });
    const dialog = await screen.findByRole('dialog', { name: 'Move expense' });
    await user.click(within(dialog).getByRole('radio', { name: /Noor Design Studio/ }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Only an owner of this profile can move its expenses.');
    expect(within(dialog).getByRole('button', { name: 'Move to Noor Design Studio' })).toBeDisabled();
  });

  it('a stale move says what happened and reads the changes again', async () => {
    const { user, api } = portal(`${expenses}?moveExpense=${E1}`, { routes: { [`POST /v1/expenses/${E1}/move`]: () => fail(409, 'CONFLICT', { reason: 'VERSION_MISMATCH', currentVersion: 4 }) } });
    const dialog = await screen.findByRole('dialog', { name: 'Move expense' });
    await user.click(within(dialog).getByRole('radio', { name: /Noor Design Studio/ }));
    await user.click(await within(dialog).findByRole('button', { name: 'Move to Noor Design Studio' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('This expense or Noor Design Studio changed meanwhile.');
    await waitFor(() => expect(api.calls.filter((c) => c.url.pathname.endsWith('/move-preview'))).toHaveLength(2));
  });

  it('a read-only profile is listed but can\'t be chosen', async () => {
    const { user, api } = portal(`${expenses}?moveExpense=${E1}`, { standing: 'open', profiles: [personal(open), studio(readOnly)] });
    const dialog = await screen.findByRole('dialog', { name: 'Move expense' });
    const row = within(dialog).getByRole('radio', { name: /Noor Design Studio/ });
    expect(row).toHaveAttribute('aria-disabled', 'true');
    await user.click(row);
    expect(api.calls.some((c) => c.url.pathname.endsWith('/move-preview'))).toBe(false);
  });
});
