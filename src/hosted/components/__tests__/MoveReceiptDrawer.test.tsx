import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { ORG_A, ORG_B, emptyProfileRoutes, fail, locationOf, me, ok, profile, renderPortal, stubApi, type Handler } from '../../__tests__/harness';
import type { BillingEntitlement, HostedProfile } from '../../api/client';

/**
 * MUT-503: moving a To-review receipt to another profile in the portal — the card's ⋯ menu (DR5), the drawer's
 * profile rows and named primary (DR3, DR6), who is offered (DR2, AC2), the outcome toast and focus (DR4), the
 * refusals (D7), and the review page's button (DR1).
 */

const ORG_C = 'c3333333-3333-4333-8333-333333333333';
const R1 = 'b0000000-0000-4000-8000-000000000001';
const R2 = 'b0000000-0000-4000-8000-000000000002';
const FILED = 'b0000000-0000-4000-8000-000000000003';

const open: BillingEntitlement = { state: 'ACTIVE', source: 'TRIAL', tier: 'FREELANCER', until: null };
const readOnly: BillingEntitlement = { state: 'READ_ONLY', source: 'TRIAL', tier: 'FREELANCER', until: null };
const locked: BillingEntitlement = { state: 'LOCKED', source: 'TRIAL', tier: 'FREELANCER', until: null };
const own = { writerOfRecord: null, owned: true, access: { payments: 'read-write', expenses: 'read-write', capture: 'read-write' } } as const;
const personal = (billing: BillingEntitlement | null = null) => profile({ id: ORG_B, name: 'Personal', isPersonalDefault: true, type: 'PERSONAL', ...own, billing });
const studio = (billing: BillingEntitlement | null = null) => profile({ id: ORG_A, name: 'Noor Design Studio', type: 'BUSINESS', ...own, billing });
const cedar = (billing: BillingEntitlement | null = null) => profile({ id: ORG_C, name: 'Cedar Consulting', type: 'BUSINESS', ...own, billing });

const item = (id: string, filingStatus: 'TO_REVIEW' | 'FILED' = 'TO_REVIEW', reading: 'pending' | null = null) => ({
  id, filename: `${id.slice(-1)}.pdf`, mimeType: 'application/pdf', sizeBytes: 10, status: 'READY', filingStatus, expenseId: filingStatus === 'FILED' ? 'e0000000-0000-4000-8000-000000000001' : null,
  receivedOn: '2026-10-27', reading, expense: filingStatus === 'FILED' ? { vendor: 'Cafe', title: null, amount: '15.00', currency: 'ILS', occurredOn: '2026-10-27', categoryId: null } : null,
});
const receipt = (id: string, filingStatus: 'TO_REVIEW' | 'FILED' = 'TO_REVIEW', reading: 'pending' | null = null) => ({
  ...item(id, filingStatus, reading), organizationId: ORG_B, suggested: null, approved: null, version: 1, createdAt: '2026-10-27T08:00:00Z', completedAt: '2026-10-27T08:00:00Z',
});

function portal(path: string, opts: { profiles?: HostedProfile[]; standing?: 'open' | 'read-only' | null; routes?: Record<string, Handler>; items?: ReturnType<typeof item>[] } = {}) {
  const items = opts.items ?? [item(R1), item(R2, 'TO_REVIEW', 'pending')];
  const body = { ...me(opts.profiles ?? [personal(), studio(), cedar()]), billingStanding: opts.standing ?? null };
  const api = stubApi({
    'GET /v1/me': () => ok(body),
    ...emptyProfileRoutes(),
    'GET /v1/expense-categories': () => ok([]),
    'GET /v1/expenses': () => ok({ items: [], nextCursor: null }),
    'GET /v1/receipts/counts': () => ok({ toReview: items.filter((i) => i.filingStatus === 'TO_REVIEW').length, filed: items.filter((i) => i.filingStatus === 'FILED').length }),
    'GET /v1/receipts': () => ok({ items, nextCursor: null }),
    [`GET /v1/receipts/${R1}`]: () => ok(receipt(R1)),
    [`GET /v1/receipts/${R2}`]: () => ok(receipt(R2, 'TO_REVIEW', 'pending')),
    [`GET /v1/receipts/${FILED}`]: () => ok(receipt(FILED, 'FILED')),
    ...opts.routes,
  });
  return { ...renderPortal(path), api };
}

const gallery = `/p/${ORG_B}/expenses/receipts`;
const moves = (calls: { method: string; url: URL }[]) => calls.filter((c) => c.method === 'POST' && c.url.pathname.endsWith('/move'));

afterEach(() => vi.unstubAllGlobals());

describe('the card ⋯ menu (MUT-503 DR5)', () => {
  it('a To-review card has ⋯ with Open and Move to profile…; Move opens the drawer from the URL', async () => {
    const { user, router } = portal(gallery);
    const card = (await screen.findAllByRole('listitem')).find((li) => li.getAttribute('data-receipt-id') === R1)!;
    await user.click(within(card).getByRole('button', { name: 'More actions for 1.pdf' }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Open', 'Move to profile…']);
    await user.click(within(menu).getByRole('menuitem', { name: 'Move to profile…' }));
    expect(locationOf(router)).toBe(`${gallery}?move=${R1}`);
    expect(await screen.findByRole('dialog', { name: 'Move receipt' })).toBeInTheDocument();
  });

  it('arrow keys move between items and Escape returns focus to ⋯', async () => {
    const { user } = portal(gallery);
    const card = (await screen.findAllByRole('listitem')).find((li) => li.getAttribute('data-receipt-id') === R1)!;
    const button = within(card).getByRole('button', { name: 'More actions for 1.pdf' });
    await user.click(button);
    expect(screen.getByRole('menuitem', { name: 'Open' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Move to profile…' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Open' })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('menuitem', { name: 'Move to profile…' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(button).toHaveFocus();
  });

  it('a Filed card has no ⋯ (AC3)', async () => {
    portal(`${gallery}?status=filed`, { items: [item(FILED, 'FILED')] });
    const card = (await screen.findAllByRole('listitem')).find((li) => li.getAttribute('data-receipt-id') === FILED)!;
    expect(within(card).queryByRole('button', { name: /More actions/ })).toBeNull();
  });

  it('with no other profile there is no ⋯ anywhere, and ?move opens nothing (DR2)', async () => {
    portal(`${gallery}?move=${R1}`, { profiles: [personal()] });
    await screen.findAllByRole('listitem');
    expect(screen.queryByRole('button', { name: /More actions/ })).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Move receipt' })).toBeNull();
  });
});

describe('the Move drawer (MUT-503 DR3, DR6, AC2)', () => {
  it('lists the other profiles; the primary names the one chosen; moving sends it with an Idempotency-Key', async () => {
    const { user, api } = portal(`${gallery}?move=${R1}`, { routes: { [`POST /v1/receipts/${R1}/move`]: () => ok({ receipt: { ...receipt(R1), organizationId: ORG_A }, fromProfileId: ORG_B }) } });
    const dialog = await screen.findByRole('dialog', { name: 'Move receipt' });
    const group = within(dialog).getByRole('radiogroup', { name: 'The profile to move it to' });
    expect(within(group).getAllByRole('radio').map((r) => r.querySelector('.hp-profile-row-name')?.textContent)).toEqual(['Noor Design Studio', 'Cedar Consulting']);
    const submit = within(dialog).getByRole('button', { name: 'Move' });
    expect(submit).toBeDisabled();
    await user.click(within(group).getByRole('radio', { name: /Noor Design Studio/ }));
    expect(within(group).getByRole('radio', { name: /Noor Design Studio/ })).toHaveAttribute('aria-checked', 'true');
    await user.click(within(dialog).getByRole('button', { name: 'Move to Noor Design Studio' }));
    await waitFor(() => expect(moves(api.calls)).toHaveLength(1));
    const call = moves(api.calls)[0]!;
    expect(call.body).toEqual({ profileId: ORG_A });
    expect(call.headers.get('Idempotency-Key')).toBeTruthy();
    expect(call.headers.get('X-Mutaba3a-Profile')).toBe(ORG_B);
  });

  it('after the move: the drawer closes, the toast names the profile with Open, and both profiles\' receipts refresh (DR4)', async () => {
    const { user, api, router } = portal(`${gallery}?move=${R1}`, { routes: { [`POST /v1/receipts/${R1}/move`]: () => ok({ receipt: { ...receipt(R1), organizationId: ORG_A }, fromProfileId: ORG_B }), [`GET /v1/receipts/${R1}`]: () => ok(receipt(R1)) } });
    const dialog = await screen.findByRole('dialog', { name: 'Move receipt' });
    await user.click(within(dialog).getByRole('radio', { name: /Noor Design Studio/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Move to Noor Design Studio' }));
    expect(await screen.findByText('Moved to Noor Design Studio')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Move receipt' })).toBeNull());
    expect(locationOf(router)).toBe(gallery);
    await waitFor(() => expect(api.calls.filter((c) => c.method === 'GET' && c.url.pathname === '/v1/receipts/counts' && c.headers.get('X-Mutaba3a-Profile') === ORG_B).length).toBeGreaterThan(1));
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(locationOf(router)).toBe(`/p/${ORG_A}/expenses/receipts/${R1}`));
  });

  it('DR4: the moved card leaves and focus goes to its neighbour\'s link', async () => {
    let moved = false;
    const { user } = portal(`${gallery}?move=${R1}`, {
      routes: {
        [`POST /v1/receipts/${R1}/move`]: () => {
          moved = true;
          return ok({ receipt: { ...receipt(R1), organizationId: ORG_A }, fromProfileId: ORG_B });
        },
        'GET /v1/receipts': () => ok({ items: moved ? [item(R2, 'TO_REVIEW', 'pending')] : [item(R1), item(R2, 'TO_REVIEW', 'pending')], nextCursor: null }),
      },
    });
    const dialog = await screen.findByRole('dialog', { name: 'Move receipt' });
    await user.click(within(dialog).getByRole('radio', { name: /Noor Design Studio/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Move to Noor Design Studio' }));
    const next = (await screen.findAllByRole('listitem')).find((li) => li.getAttribute('data-receipt-id') === R2)!;
    await waitFor(() => expect(next.querySelector('.hp-receipt-card-link')).toHaveFocus());
  });

  it('a read-only or locked profile is listed but can\'t be chosen, with its reason (AC2)', async () => {
    const { user } = portal(`${gallery}?move=${R1}`, { standing: 'open', profiles: [personal(open), studio(readOnly), cedar(locked)] });
    const dialog = await screen.findByRole('dialog', { name: 'Move receipt' });
    const studioRow = within(dialog).getByRole('radio', { name: /Noor Design Studio/ });
    expect(studioRow).toHaveAttribute('aria-disabled', 'true');
    expect(studioRow).toHaveTextContent("Read-only until it's paid");
    expect(within(dialog).getByRole('radio', { name: /Cedar Consulting/ })).toHaveTextContent('Locked · its trial has ended');
    await user.click(studioRow);
    expect(studioRow).toHaveAttribute('aria-checked', 'false');
    expect(within(dialog).getByRole('button', { name: 'Move' })).toBeDisabled();
    // Every other profile is lapsed: the note says so, with a way to Billing.
    expect(within(dialog).getByText('No other profile can take it.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Billing' })).toBeInTheDocument();
  });

  it('a receipt still being read says the reading finishes on the profile chosen (DR9)', async () => {
    portal(`${gallery}?move=${R2}`);
    const dialog = await screen.findByRole('dialog', { name: 'Move receipt' });
    expect(within(dialog).getByText('Still being read. The reading finishes on the profile you choose.')).toBeInTheDocument();
  });

  it('a refusal shows in the drawer and the receipt stays (402 lapsed meanwhile)', async () => {
    const { user } = portal(`${gallery}?move=${R1}`, { routes: { [`POST /v1/receipts/${R1}/move`]: () => fail(402, 'SUBSCRIPTION_LAPSED', { profileId: ORG_A, state: 'READ_ONLY' }) } });
    const dialog = await screen.findByRole('dialog', { name: 'Move receipt' });
    await user.click(within(dialog).getByRole('radio', { name: /Noor Design Studio/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Move to Noor Design Studio' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent("Noor Design Studio can't take receipts right now: it's read-only until it's paid. The receipt stays here.");
  });

  it('D8: a retry answered 409 in progress, with the receipt already on the other profile, is a success', async () => {
    const { user } = portal(`${gallery}?move=${R1}`, {
      routes: { [`POST /v1/receipts/${R1}/move`]: () => fail(409, 'OPERATION_IN_PROGRESS'), [`GET /v1/receipts/${R1}`]: (req) => ok({ ...receipt(R1), organizationId: req.headers.get('X-Mutaba3a-Profile') }) },
    });
    const dialog = await screen.findByRole('dialog', { name: 'Move receipt' });
    await user.click(within(dialog).getByRole('radio', { name: /Noor Design Studio/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Move to Noor Design Studio' }));
    expect(await screen.findByText('Moved to Noor Design Studio')).toBeInTheDocument();
  });

  it('a Filed receipt named in ?move opens nothing (AC3)', async () => {
    portal(`${gallery}?status=filed&move=${FILED}`, { items: [item(FILED, 'FILED')] });
    await screen.findAllByRole('listitem');
    expect(screen.queryByRole('dialog', { name: 'Move receipt' })).toBeNull();
  });
});

describe('the review page (MUT-503 DR1)', () => {
  it('has Move to profile… beside the title; after the move it goes on to the next receipt to review', async () => {
    const { user, router } = portal(`${gallery}/${R1}`, { routes: { [`POST /v1/receipts/${R1}/move`]: () => ok({ receipt: { ...receipt(R1), organizationId: ORG_A }, fromProfileId: ORG_B }) } });
    await user.click(await screen.findByRole('button', { name: 'Move to profile…' }));
    expect(locationOf(router)).toBe(`${gallery}/${R1}?move=true`);
    const dialog = await screen.findByRole('dialog', { name: 'Move receipt' });
    await user.click(within(dialog).getByRole('radio', { name: /Noor Design Studio/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Move to Noor Design Studio' }));
    expect(await screen.findByText('Moved to Noor Design Studio')).toBeInTheDocument();
    await waitFor(() => expect(locationOf(router)).toBe(`${gallery}/${R2}`));
  });

  it('a Filed receipt\'s page has no Move (AC3)', async () => {
    portal(`${gallery}/${FILED}`, { items: [item(FILED, 'FILED')] });
    expect(await screen.findByRole('heading', { name: 'Filed receipt' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Move to profile…' })).toBeNull();
  });
});
