import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { ORG_A, emptyProfileRoutes, fail, locationOf, me, ok, profile, renderPortal, stubApi, type Handler } from '../../__tests__/harness';
import { PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';
import { BACKSTOP_MS, useSavedFlashStore } from '../../../lib/savedFlashStore';
import { CUSTOMERS, page } from './fixtures';

/**
 * After-save feedback on the portal (R1 via HP1, MUT-91): a save tints its row
 * when the list shows it, or says "Expense saved · Show" when it doesn't, and
 * Show anchors the list on the saved record (server `anchor`, eng review D10).
 * The same store and hook as the local app; only the notice is the portal's.
 */

const E1 = 'e1111111-1111-4111-8111-111111111111';
const E2 = 'e2222222-2222-4222-8222-222222222222';
const K1 = 'b1111111-1111-4111-8111-111111111111';
const K2 = 'b2222222-2222-4222-8222-222222222222';
const OTHER_CATEGORY = 'cafe0000-0000-4000-8000-000000000000';
const CATEGORIES = { items: [{ id: 'cat-1', name: 'Software', color: null, archived: false, version: 1, createdAt: '', updatedAt: '' }] };

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
  act(() => useSavedFlashStore.getState().clear());
});
afterEach(() => vi.unstubAllGlobals());

function expense(overrides: Record<string, unknown> = {}) {
  return {
    id: E1,
    occurredOn: '2026-10-01',
    amount: '45.50',
    currency: 'ILS',
    title: 'Office supplies',
    vendor: null,
    categoryId: 'cat-1',
    customerId: null,
    projectId: null,
    notes: null,
    createdByUserId: 'u1',
    version: 1,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function conversion(overrides: Record<string, unknown> = {}) {
  return { id: K1, occurredOn: '2026-10-01', amount: '100.00', currency: 'USD', toAmount: '365.00', toCurrency: 'ILS', notes: 'Old', createdByUserId: 'u1', createdAt: '', ...overrides };
}

function portal(path: string, routes: Record<string, Handler>) {
  const api = stubApi({
    'GET /v1/me': () => ok(me([profile()])),
    ...emptyProfileRoutes(),
    'GET /v1/customers': () => ok(page(CUSTOMERS)),
    'GET /v1/expense-categories': () => ok(CATEGORIES),
    ...routes,
  });
  return { ...renderPortal(path), api };
}

const rowWith = async (text: string) => (await screen.findByText(text)).closest('tr')!;

async function recordExpense(user: ReturnType<typeof renderPortal>['user']) {
  await user.click(screen.getAllByRole('button', { name: 'Record expense' })[0]);
  await user.type(await screen.findByPlaceholderText('0.00'), '12.50');
  await user.selectOptions(await screen.findByDisplayValue('Choose a category'), 'cat-1');
  await user.click(screen.getByRole('button', { name: 'Save' }));
}

describe('portal expenses: after save', () => {
  it('tints a saved expense the list shows, announces "Saved", and raises no notice', async () => {
    let saved = false;
    const { user } = portal(`/p/${ORG_A}/expenses`, {
      'GET /v1/expenses': () => ok(page(saved ? [expense({ id: E2, title: 'Printer ink' }), expense()] : [expense()])),
      'POST /v1/expenses': () => {
        saved = true;
        return ok(expense({ id: E2, title: 'Printer ink' }), 201);
      },
    });
    await screen.findByText('Office supplies');
    await recordExpense(user);

    await waitFor(async () => expect(await rowWith('Printer ink')).toHaveClass('row-flash'));
    expect(await rowWith('Office supplies')).not.toHaveClass('row-flash');
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
    expect(screen.queryByText('Expense saved')).not.toBeInTheDocument();
  });

  it('says "Expense saved · Show" when the list does not show it; Show anchors the list on it and tints it', async () => {
    const { user, router, api } = portal(`/p/${ORG_A}/expenses?categoryId=${OTHER_CATEGORY}`, {
      'GET /v1/expenses': (req) =>
        ok(page(req.url.searchParams.get('anchor') === E2 ? [expense({ id: E2, title: 'Printer ink', occurredOn: '2026-08-01' }), expense({ occurredOn: '2026-07-01' })] : [])),
      'POST /v1/expenses': () => ok(expense({ id: E2, title: 'Printer ink', occurredOn: '2026-08-01' }), 201),
    });
    await screen.findByText('Nothing matches these filters.');
    await recordExpense(user);

    const notice = await screen.findByText('Expense saved');
    expect(notice.closest('[role="status"]')).not.toBeNull();
    await user.click(within(notice.closest('[role="status"]') as HTMLElement).getByRole('button', { name: 'Show' }));

    await waitFor(() => expect(locationOf(router)).toContain(`anchor=${E2}`));
    expect(locationOf(router)).not.toContain('categoryId');
    await waitFor(async () => expect(await rowWith('Printer ink')).toHaveClass('row-flash'));
    expect(screen.queryByText('Expense saved')).not.toBeInTheDocument();

    const anchored = api.calls.filter((c) => c.url.pathname === '/v1/expenses' && c.url.searchParams.get('anchor') === E2);
    expect(anchored.length).toBeGreaterThan(0);
    expect(anchored.every((c) => !c.url.searchParams.has('cursor'))).toBe(true);

    expect(screen.getByText('Showing from a saved entry')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show latest' }));
    await waitFor(() => expect(locationOf(router)).not.toContain('anchor'));
  });

  it('tints an edited expense in place with no notice', async () => {
    const { user } = portal(`/p/${ORG_A}/expenses`, {
      'GET /v1/expenses': () => ok(page([expense()])),
      [`GET /v1/expenses/${E1}`]: () => ok(expense({ receipts: [] })),
      [`PATCH /v1/expenses/${E1}`]: () => ok(expense({ version: 2 })),
    });
    await user.click(await rowWith('Office supplies'));
    await screen.findByText('Edit expense', { selector: '.drawer-title' });
    await user.click(await screen.findByRole('button', { name: 'Save' }));

    await waitFor(async () => expect(await rowWith('Office supplies')).toHaveClass('row-flash'));
    expect(screen.queryByText('Expense saved')).not.toBeInTheDocument();
  });

  it('a delete neither tints nor raises a notice', async () => {
    vi.stubGlobal('confirm', () => true);
    let deleted = false;
    const { user } = portal(`/p/${ORG_A}/expenses`, {
      'GET /v1/expenses': () => ok(page(deleted ? [] : [expense()])),
      [`GET /v1/expenses/${E1}`]: () => ok(expense({ receipts: [] })),
      [`DELETE /v1/expenses/${E1}`]: () => {
        deleted = true;
        return new Response(null, { status: 204 });
      },
    });
    await user.click(await rowWith('Office supplies'));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await screen.findByText('No expenses recorded on this profile yet');
    await new Promise((resolve) => setTimeout(resolve, BACKSTOP_MS + 100)); // past the backstop
    expect(useSavedFlashStore.getState().pending).toBeNull();
    expect(screen.queryByText('Expense saved')).not.toBeInTheDocument();
  });
});

describe('portal expenses: after save, the hard paths (review)', () => {
  it('a failed save marks nothing', async () => {
    const { user } = portal(`/p/${ORG_A}/expenses`, {
      'GET /v1/expenses': () => ok(page([expense()])),
      'POST /v1/expenses': () => fail(422, 'VALIDATION_FAILED'),
    });
    await screen.findByText('Office supplies');
    await recordExpense(user);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled());
    expect(useSavedFlashStore.getState().pending).toBeNull();
    expect(screen.queryByText('Expense saved')).not.toBeInTheDocument();
  });

  it('a save whose list refetch fails still says "Expense saved" behind the Unreachable card (D4)', async () => {
    let saved = false;
    const { user } = portal(`/p/${ORG_A}/expenses`, {
      'GET /v1/expenses': () => (saved ? fail(503, 'UNAVAILABLE') : ok(page([expense()]))),
      'POST /v1/expenses': () => {
        saved = true;
        return ok(expense({ id: E2, title: 'Printer ink' }), 201);
      },
    });
    await screen.findByText('Office supplies');
    await recordExpense(user);
    expect(await screen.findByText('Expense saved', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText("Can't reach MTB3A right now")).toBeInTheDocument();
  });

  it('an edit whose refetch fails is not claimed by the stale rows: the notice still confirms it (D4)', async () => {
    let saved = false;
    const { user } = portal(`/p/${ORG_A}/expenses`, {
      'GET /v1/expenses': () => (saved ? fail(503, 'UNAVAILABLE') : ok(page([expense()]))),
      [`GET /v1/expenses/${E1}`]: () => ok(expense({ receipts: [] })),
      [`PATCH /v1/expenses/${E1}`]: () => {
        saved = true;
        return ok(expense({ version: 2 }));
      },
    });
    await user.click(await rowWith('Office supplies'));
    await user.click(await screen.findByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Expense saved', {}, { timeout: 3000 })).toBeInTheDocument();
  });

  it('Show lands even when the list was already anchored on that expense (filters changed, anchor did not)', async () => {
    const { user, router } = portal(`/p/${ORG_A}/expenses?anchor=${E2}&categoryId=${OTHER_CATEGORY}`, {
      'GET /v1/expenses': (req) =>
        ok(page(req.url.searchParams.get('categoryId') ? [] : [expense({ id: E2, title: 'Printer ink' }), expense()])),
      [`GET /v1/expenses/${E2}`]: () => ok(expense({ id: E2, title: 'Printer ink', receipts: [] })),
      [`PATCH /v1/expenses/${E2}`]: () => ok(expense({ id: E2, title: 'Printer ink', version: 2 })),
    });
    await screen.findByText('Nothing matches these filters.');
    // The edit drawer opened by URL, as a row click would.
    await act(async () => {
      await router.navigate({ to: '.', search: (prev: Record<string, unknown>) => ({ ...prev, expense: E2 }), replace: true });
    });
    await user.click(await screen.findByRole('button', { name: 'Save' }));
    const notice = (await screen.findByText('Expense saved')).closest('[role="status"]') as HTMLElement;
    await user.click(within(notice).getByRole('button', { name: 'Show' }));
    await waitFor(() => expect(locationOf(router)).not.toContain('categoryId'));
    await waitFor(async () => expect(await rowWith('Printer ink')).toHaveClass('row-flash'));
  });

  it('Show moves focus to the note above the anchored list, not to the page body', async () => {
    const { user } = portal(`/p/${ORG_A}/expenses?categoryId=${OTHER_CATEGORY}`, {
      'GET /v1/expenses': (req) => ok(page(req.url.searchParams.get('anchor') === E2 ? [expense({ id: E2, title: 'Printer ink' })] : [])),
      'POST /v1/expenses': () => ok(expense({ id: E2, title: 'Printer ink' }), 201),
    });
    await screen.findByText('Nothing matches these filters.');
    await recordExpense(user);
    const notice = (await screen.findByText('Expense saved')).closest('[role="status"]') as HTMLElement;
    await user.click(within(notice).getByRole('button', { name: 'Show' }));
    const note = await screen.findByText('Showing from a saved entry');
    await waitFor(() => expect(note.closest('.hp-anchored')).toHaveFocus());
  });
});

describe('portal expenses: an anchored list', () => {
  it('a stale anchor (the record is gone) drops itself and shows the latest list, not the Unreachable card', async () => {
    const { router, api } = portal(`/p/${ORG_A}/expenses?anchor=${E2}`, {
      'GET /v1/expenses': (req) =>
        req.url.searchParams.get('anchor') ? fail(404, 'NOT_FOUND', { field: 'anchor', reason: 'ANCHOR_NOT_FOUND' }) : ok(page([expense()])),
    });
    expect(await screen.findByText('Office supplies')).toBeInTheDocument();
    expect(locationOf(router)).not.toContain('anchor');
    expect(screen.queryByText("Can't reach MTB3A right now")).not.toBeInTheDocument();
    expect(api.count('GET /v1/me')).toBe(1); // not mistaken for a removed profile
  });

  it('Show more on an anchored list follows the cursor and sends no anchor', async () => {
    const { user, api } = portal(`/p/${ORG_A}/expenses?anchor=${E2}`, {
      'GET /v1/expenses': (req) =>
        req.url.searchParams.get('cursor') === 'c2' ? ok(page([expense({ occurredOn: '2026-07-01' })])) : ok(page([expense({ id: E2, title: 'Printer ink' })], 'c2')),
    });
    await screen.findByText('Printer ink');
    await user.click(screen.getByRole('button', { name: 'Show more' }));
    await screen.findByText('Office supplies');
    const next = api.calls.find((c) => c.url.pathname === '/v1/expenses' && c.url.searchParams.get('cursor') === 'c2')!;
    expect(next.url.searchParams.has('anchor')).toBe(false);
  });

  it('deleting the record the list is anchored on drops the anchor instead of a 404 dead end', async () => {
    vi.stubGlobal('confirm', () => true);
    let deleted = false;
    const { user, router } = portal(`/p/${ORG_A}/expenses?anchor=${E2}`, {
      'GET /v1/expenses': (req) => {
        if (req.url.searchParams.get('anchor') === E2) {
          return deleted ? fail(404, 'NOT_FOUND') : ok(page([expense({ id: E2, title: 'Printer ink' }), expense()]));
        }
        return ok(page([expense()]));
      },
      [`GET /v1/expenses/${E2}`]: () => ok(expense({ id: E2, title: 'Printer ink', receipts: [] })),
      [`DELETE /v1/expenses/${E2}`]: () => {
        deleted = true;
        return new Response(null, { status: 204 });
      },
    });
    await user.click(await rowWith('Printer ink'));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(locationOf(router)).not.toContain('anchor'));
    expect(await screen.findByText('Office supplies')).toBeInTheDocument();
    expect(screen.queryByText('Showing from a saved entry')).not.toBeInTheDocument();
  });
});

describe('portal conversions: after save (D7)', () => {
  async function logConversion(user: ReturnType<typeof renderPortal>['user']) {
    await user.click(screen.getAllByRole('button', { name: 'Log conversion' })[0]);
    const [fromAmount, toAmount] = await screen.findAllByPlaceholderText('0.00');
    await user.type(fromAmount, '100.00');
    await user.type(toAmount, '365.00');
    await user.click(screen.getByRole('button', { name: 'Save' }));
  }

  it('tints a saved conversion the list shows', async () => {
    let saved = false;
    const { user } = portal(`/p/${ORG_A}/conversions`, {
      'GET /v1/conversions': () => ok(page(saved ? [conversion({ id: K2, notes: 'New' }), conversion()] : [conversion()])),
      'POST /v1/conversions': () => {
        saved = true;
        return ok(conversion({ id: K2, notes: 'New' }), 201);
      },
    });
    await screen.findByText('Old');
    await logConversion(user);
    await waitFor(async () => expect(await rowWith('New')).toHaveClass('row-flash'));
    expect(screen.queryByText('Conversion saved')).not.toBeInTheDocument();
  });

  it('says "Conversion saved · Show" when the list does not show it, and Show anchors on it', async () => {
    const { user, router } = portal(`/p/${ORG_A}/conversions?currency=EUR`, {
      'GET /v1/conversions': (req) => ok(page(req.url.searchParams.get('anchor') === K2 ? [conversion({ id: K2, notes: 'New' })] : [])),
      'POST /v1/conversions': () => ok(conversion({ id: K2, notes: 'New' }), 201),
    });
    await screen.findByText('Nothing matches these filters.');
    await logConversion(user);
    const notice = (await screen.findByText('Conversion saved')).closest('[role="status"]') as HTMLElement;
    await user.click(within(notice).getByRole('button', { name: 'Show' }));
    await waitFor(() => expect(locationOf(router)).toContain(`anchor=${K2}`));
    expect(locationOf(router)).not.toContain('currency');
    await waitFor(async () => expect(await rowWith('New')).toHaveClass('row-flash'));
  });
});
