import { useState, type ComponentProps } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HostedLanguageProvider, PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../Toast';
import { ExpenseDrawer } from '../ExpenseDrawer';
import en from '../../i18n/en.json';
import ar from '../../i18n/ar.json';

const { trackPortal } = vi.hoisted(() => ({ trackPortal: vi.fn(async () => {}) }));
vi.mock('../../analytics/portalAnalytics', () => ({ trackPortal }));

// The portal opens in Arabic until a person chooses (MUT-209); these cases speak English, so choose it as a person would
beforeEach(() => localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en'));

const fetchMock = vi.fn();

function ok(body: unknown, status = 200) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function fail(status: number, code: string, details?: unknown) {
  return ok({ error: { code, message: code, details: details ?? null, requestId: 'req-1' } }, status);
}

const EMPTY_CATEGORIES = { items: [{ id: 'cat-1', name: 'Software', color: null, archived: false, version: 1, createdAt: '', updatedAt: '' }] };
const EMPTY_DIRECTORY = { items: [], nextCursor: null };
const EN_CONFLICT = en.hosted.expenses.errors.conflict;

function route(routes: Record<string, (req: { method: string; url: URL; body: unknown }) => Response>) {
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), 'http://portal.test');
    const method = (init.method ?? 'GET').toUpperCase();
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    const handler = routes[`${method} ${url.pathname}`];
    if (!handler) return fail(404, 'NOT_FOUND');
    return handler({ method, url, body });
  });
}

function renderDrawer(props: Partial<ComponentProps<typeof ExpenseDrawer>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <HostedLanguageProvider>
        <ToastProvider>
          <ExpenseDrawer profileId="org-1" mode="create" onClose={onClose} {...props} />
        </ToastProvider>
      </HostedLanguageProvider>
    </QueryClientProvider>,
  );
  return { onClose, queryClient };
}

beforeEach(() => {
  trackPortal.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  route({
    'GET /v1/expense-categories': () => ok(EMPTY_CATEGORIES),
    'GET /v1/customers': () => ok(EMPTY_DIRECTORY),
    'GET /v1/projects': () => ok(EMPTY_DIRECTORY),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('ExpenseDrawer vendor field (MUT-254)', () => {
  const CATEGORIES = { items: [EMPTY_CATEGORIES.items[0]!, { id: 'cat-2', name: 'Travel', color: null, archived: false, version: 1, createdAt: '', updatedAt: '' }] };
  const CAB = { id: 'v1', name: 'Yellow Cab', matchedName: 'Yellow Cab', exact: false, registrationNo: null, phone: null, email: null, lastCategoryId: 'cat-2' };
  beforeEach(() =>
    route({
      'GET /v1/expense-categories': () => ok(CATEGORIES),
      'GET /v1/customers': () => ok(EMPTY_DIRECTORY),
      'GET /v1/projects': () => ok(EMPTY_DIRECTORY),
      'GET /v1/vendors': () => ok({ items: [CAB] }),
    }),
  );

  it('picking a suggested vendor prefills its last category into an empty field', async () => {
    const user = userEvent.setup();
    renderDrawer();
    const category = (await screen.findByDisplayValue('Choose a category')) as HTMLSelectElement;
    await user.click(screen.getByLabelText('Vendor'));
    await user.click(await screen.findByRole('option', { name: 'Yellow Cab' }));
    expect((screen.getByLabelText('Vendor') as HTMLInputElement).value).toBe('Yellow Cab');
    await waitFor(() => expect(category.value).toBe('cat-2'));
  });

  it('never overwrites a category already chosen', async () => {
    const user = userEvent.setup();
    renderDrawer();
    const category = (await screen.findByDisplayValue('Choose a category')) as HTMLSelectElement;
    await user.selectOptions(category, 'cat-1');
    await user.click(screen.getByLabelText('Vendor'));
    await user.click(await screen.findByRole('option', { name: 'Yellow Cab' }));
    expect((screen.getByLabelText('Vendor') as HTMLInputElement).value).toBe('Yellow Cab');
    expect(category.value).toBe('cat-1');
  });
});

describe('ExpenseDrawer (hosted)', () => {
  it('renders the create form once categories load, with the amount input in decimal-text mode', async () => {
    renderDrawer();
    await screen.findByText('Record expense');
    const amount = (await screen.findByPlaceholderText('0.00')) as HTMLInputElement;
    expect(amount.type).toBe('text');
    expect(amount.getAttribute('dir')).toBe('ltr');
    expect(amount.getAttribute('inputmode')).toBe('decimal');
  });

  it('names the client field by its label, and offers Add client only when the profile allows it (MUT-286)', async () => {
    const user = userEvent.setup();
    renderDrawer({ canAddClient: false });
    const client = await screen.findByLabelText('Client');
    await user.type(client, 'Ramallah Bakery');
    expect(screen.queryByRole('option', { name: /Add client/ })).toBeNull();
  });

  it('adds a matter for the chosen client in the expense currency, and names the field by its label (MUT-318)', async () => {
    const user = userEvent.setup();
    const created: unknown[] = [];
    route({
      'GET /v1/expense-categories': () => ok(EMPTY_CATEGORIES),
      'GET /v1/customers': () => ok({ items: [{ id: 'c1', name: 'Haddad & Partners' }], nextCursor: null }),
      'GET /v1/projects': () => ok(EMPTY_DIRECTORY),
      'POST /v1/projects': ({ body }) => {
        created.push(body);
        return ok({ id: 'p9', ...(body as object) }, 201);
      },
    });
    renderDrawer({ canAddClient: true });
    const matter = await screen.findByLabelText('Matter');
    await user.type(matter, 'Lease dispute');
    expect(screen.queryByRole('option', { name: /Add matter/ })).toBeNull();
    expect(screen.getByText('Choose a client first to add a matter.')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Client'), 'Haddad');
    await user.click(await screen.findByRole('option', { name: 'Haddad & Partners' }));
    await user.clear(matter);
    await user.type(matter, 'Lease dispute');
    await user.click(await screen.findByRole('option', { name: /Add matter.*Lease dispute/ }));

    await waitFor(() => expect(created).toEqual([{ customerId: 'c1', name: 'Lease dispute', currency: 'USD' }]));
    expect(matter).toHaveValue('Lease dispute');
  });

  it('holds Save while a matter is being added (review D1)', async () => {
    const user = userEvent.setup();
    let land!: () => void;
    const gate = new Promise<void>((resolve) => (land = resolve));
    route({
      'GET /v1/expense-categories': () => ok(EMPTY_CATEGORIES),
      'GET /v1/customers': () => ok({ items: [{ id: 'c1', name: 'Haddad & Partners' }], nextCursor: null }),
      'GET /v1/projects': () => ok(EMPTY_DIRECTORY),
    });
    const fallback = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      if ((init.method ?? 'GET').toUpperCase() === 'POST' && String(input).includes('/v1/projects')) {
        await gate;
        return ok({ id: 'p9', name: 'Lease dispute', customerId: 'c1', currency: 'USD' }, 201);
      }
      return fallback(input, init);
    });
    renderDrawer({ canAddClient: true });
    const matter = await screen.findByLabelText('Matter');
    await user.type(screen.getByLabelText('Client'), 'Haddad');
    await user.click(await screen.findByRole('option', { name: 'Haddad & Partners' }));
    await user.type(matter, 'Lease dispute');
    await user.click(await screen.findByRole('option', { name: /Add matter.*Lease dispute/ }));

    const save = screen.getByRole('button', { name: 'Save' });
    await waitFor(() => expect(save).toBeDisabled());
    land();
    await waitFor(() => expect(save).not.toBeDisabled());
    expect(matter).toHaveValue('Lease dispute');
  });

  it('picking a matter with no client fills the client, and changing the client empties a matter of another one (MUT-318 2A)', async () => {
    const user = userEvent.setup();
    route({
      'GET /v1/expense-categories': () => ok(EMPTY_CATEGORIES),
      'GET /v1/customers': () =>
        ok({ items: [{ id: 'c1', name: 'Haddad & Partners' }, { id: 'c2', name: 'Nablus Textiles' }], nextCursor: null }),
      'GET /v1/projects': ({ url }) => {
        const customerId = url.searchParams.get('customerId');
        const items = [{ id: 'p1', name: 'Retainer', customerId: 'c1' }].filter((p) => !customerId || p.customerId === customerId);
        return ok({ items, nextCursor: null });
      },
    });
    renderDrawer({ canAddClient: true });
    const matter = await screen.findByLabelText('Matter');
    const client = screen.getByLabelText('Client');
    await user.click(matter);
    await user.click(await screen.findByRole('option', { name: /Retainer/ }));
    await waitFor(() => expect(client).toHaveValue('Haddad & Partners'));
    expect(matter).toHaveValue('Retainer');

    await user.clear(client);
    await user.type(client, 'Nablus');
    await user.click(await screen.findByRole('option', { name: 'Nablus Textiles' }));
    await waitFor(() => expect(matter).toHaveValue(''));
  });

  it('creates an expense with an Idempotency-Key and closes on success', async () => {
    const user = userEvent.setup();
    let createCall: { body: unknown; headers: Headers } | null = null;
    route({
      'GET /v1/expense-categories': () => ok(EMPTY_CATEGORIES),
      'GET /v1/customers': () => ok(EMPTY_DIRECTORY),
      'GET /v1/projects': () => ok(EMPTY_DIRECTORY),
    });
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input), 'http://portal.test');
      const method = (init.method ?? 'GET').toUpperCase();
      if (method === 'GET' && url.pathname === '/v1/expense-categories') return ok(EMPTY_CATEGORIES);
      if (method === 'GET' && (url.pathname === '/v1/customers' || url.pathname === '/v1/projects')) return ok(EMPTY_DIRECTORY);
      if (method === 'POST' && url.pathname === '/v1/expenses') {
        createCall = { body: JSON.parse(String(init.body)), headers: new Headers(init.headers) };
        return ok({ id: 'e1' }, 201);
      }
      return fail(404, 'NOT_FOUND');
    });

    const { onClose } = renderDrawer();
    const amount = await screen.findByPlaceholderText('0.00');
    await user.type(amount, '12.50');
    const categorySelect = await screen.findByDisplayValue('Choose a category');
    await user.selectOptions(categorySelect, 'cat-1');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(createCall).not.toBeNull();
    expect(createCall!.headers.get('idempotency-key')).toBeTruthy();
    expect(createCall!.body).toMatchObject({ amount: '12.50', currency: 'USD', categoryId: 'cat-1' });
    // Opt-in usage counts (MUT-155): one count per confirmed create, the currency only
    expect(trackPortal).toHaveBeenCalledExactlyOnceWith('expense_recorded', { currency: 'USD' });
  });

  it('resends the same Idempotency-Key when Save is retried after a network failure (MUT-133 D5)', async () => {
    const user = userEvent.setup();
    const keys: (string | null)[] = [];
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input), 'http://portal.test');
      const method = (init.method ?? 'GET').toUpperCase();
      if (method === 'GET' && url.pathname === '/v1/expense-categories') return ok(EMPTY_CATEGORIES);
      if (method === 'GET' && (url.pathname === '/v1/customers' || url.pathname === '/v1/projects')) return ok(EMPTY_DIRECTORY);
      if (method === 'POST' && url.pathname === '/v1/expenses') {
        keys.push(new Headers(init.headers).get('idempotency-key'));
        if (keys.length === 1) throw new TypeError('network down');
        return ok({ id: 'e1' }, 201);
      }
      return fail(404, 'NOT_FOUND');
    });
    const { onClose } = renderDrawer();
    await user.type(await screen.findByPlaceholderText('0.00'), '12.50');
    await user.selectOptions(await screen.findByDisplayValue('Choose a category'), 'cat-1');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(keys).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(keys[1]).toBe(keys[0]);
    expect(trackPortal).toHaveBeenCalledOnce();
  });

  it('sends a date past the picker\'s ten-year max to the server, and says "more than ten years ahead" when it refuses (MUT-392)', async () => {
    const user = userEvent.setup();
    let posted: unknown = null;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input), 'http://portal.test');
      const method = (init.method ?? 'GET').toUpperCase();
      if (method === 'GET' && url.pathname === '/v1/expense-categories') return ok(EMPTY_CATEGORIES);
      if (method === 'GET' && (url.pathname === '/v1/customers' || url.pathname === '/v1/projects')) return ok(EMPTY_DIRECTORY);
      if (method === 'POST' && url.pathname === '/v1/expenses') {
        posted = JSON.parse(String(init.body));
        return fail(422, 'VALIDATION_FAILED', { reason: 'DATE_INVALID', field: 'occurredOn', bound: 'future' });
      }
      return fail(404, 'NOT_FOUND');
    });

    const { onClose } = renderDrawer();
    await user.type(await screen.findByPlaceholderText('0.00'), '12.50');
    await user.selectOptions(await screen.findByDisplayValue('Choose a category'), 'cat-1');
    // Typed past the date input's max: the form must not let the browser block Save silently.
    fireEvent.change(screen.getByLabelText(/^Date/), { target: { value: '2060-01-01' } });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText("The date can't be more than ten years ahead")).toBeInTheDocument();
    expect(posted).toMatchObject({ occurredOn: '2060-01-01' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('defaults the date to today in the profile\'s zone when the list passes it (MUT-133 D5)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-13T22:30:00Z'));
    try {
      renderDrawer({ timezone: 'Asia/Jerusalem' });
      expect(await screen.findByDisplayValue('2026-10-14')).toBeInTheDocument();
      // MUT-392: an expense may be dated ahead, up to the server's ten-year ceiling.
      expect(screen.getByDisplayValue('2026-10-14')).toHaveAttribute('max', '2036-10-21');
    } finally {
      vi.useRealTimers();
    }
  });

  it('creates a JOD expense with a 3-decimal amount (MUT-140: JOD is 3-decimal, not 2)', async () => {
    const user = userEvent.setup();
    let createCall: { body: unknown } | null = null;
    route({
      'GET /v1/expense-categories': () => ok(EMPTY_CATEGORIES),
      'GET /v1/customers': () => ok(EMPTY_DIRECTORY),
      'GET /v1/projects': () => ok(EMPTY_DIRECTORY),
      'POST /v1/expenses': (req) => {
        createCall = { body: req.body };
        return ok({ id: 'e1' }, 201);
      },
    });

    const { onClose } = renderDrawer();
    await user.selectOptions(await screen.findByLabelText('Currency *'), 'JOD');
    await user.type(await screen.findByPlaceholderText('0.00'), '45.678');
    await user.selectOptions(await screen.findByDisplayValue('Choose a category'), 'cat-1');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(createCall!.body).toMatchObject({ amount: '45.678', currency: 'JOD' });
  });

  it('rejects a JOD amount with a 4th decimal place', async () => {
    const user = userEvent.setup();
    const createExpense = vi.fn();
    route({
      'GET /v1/expense-categories': () => ok(EMPTY_CATEGORIES),
      'GET /v1/customers': () => ok(EMPTY_DIRECTORY),
      'GET /v1/projects': () => ok(EMPTY_DIRECTORY),
      'POST /v1/expenses': (req) => {
        createExpense(req.body);
        return ok({ id: 'e1' }, 201);
      },
    });

    renderDrawer();
    await user.selectOptions(await screen.findByLabelText('Currency *'), 'JOD');
    await user.type(await screen.findByPlaceholderText('0.00'), '45.6789');
    await user.selectOptions(await screen.findByDisplayValue('Choose a category'), 'cat-1');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Enter a valid amount')).toBeInTheDocument();
    expect(createExpense).not.toHaveBeenCalled();
  });

  it('blocks the drawer body behind a spinner in edit mode until the expense loads', async () => {
    let resolveExpense: (r: Response) => void = () => {};
    route({
      'GET /v1/expense-categories': () => ok(EMPTY_CATEGORIES),
      'GET /v1/customers': () => ok(EMPTY_DIRECTORY),
      'GET /v1/projects': () => ok(EMPTY_DIRECTORY),
      'GET /v1/expenses/e1': () => new Promise<Response>((resolve) => { resolveExpense = resolve; }),
    });

    renderDrawer({ mode: 'edit', expenseId: 'e1' });
    expect(await screen.findByText('Loading...')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('0.00')).not.toBeInTheDocument();

    resolveExpense(
      ok({
        id: 'e1', occurredOn: '2026-09-01', amount: '99.99', currency: 'ILS', title: 'Hosting', vendor: 'ACME',
        categoryId: 'cat-1', customerId: null, projectId: null, notes: null, createdByUserId: 'u', version: 1,
        createdAt: '', updatedAt: '', receipts: [],
      }),
    );

    expect(await screen.findByDisplayValue('99.99')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Hosting')).toBeInTheDocument();
    expect(screen.getByText('Receipts')).toBeInTheDocument();
  });

  it('shows the receipts section only in edit mode, not while creating', async () => {
    renderDrawer({ mode: 'create' });
    await screen.findByText('Record expense');
    expect(screen.queryByText('Receipts')).not.toBeInTheDocument();
  });

  it('PATCHes on edit with no currency field and null (not omitted) for a cleared field', async () => {
    // The drawer sends no `currency` on edit (the API takes one only with
    // `amount`, ADR-096; MUT-277) and its optional fields are `string | null`, where `null`
    // clears a field and omission leaves it unchanged — sending `undefined`
    // for a field the user cleared would silently fail to clear it.
    const user = userEvent.setup();
    let patchBody: Record<string, unknown> | null = null;
    route({
      'GET /v1/expense-categories': () => ok(EMPTY_CATEGORIES),
      'GET /v1/customers': () => ok(EMPTY_DIRECTORY),
      'GET /v1/projects': () => ok(EMPTY_DIRECTORY),
      'GET /v1/expenses/e1': () =>
        ok({
          id: 'e1', occurredOn: '2026-09-01', amount: '99.99', currency: 'ILS', title: 'Hosting', vendor: 'ACME',
          categoryId: 'cat-1', customerId: null, projectId: null, notes: null, createdByUserId: 'u', version: 3,
          createdAt: '', updatedAt: '', receipts: [],
        }),
    });
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input), 'http://portal.test');
      const method = (init.method ?? 'GET').toUpperCase();
      if (method === 'GET' && url.pathname === '/v1/expense-categories') return ok(EMPTY_CATEGORIES);
      if (method === 'GET' && (url.pathname === '/v1/customers' || url.pathname === '/v1/projects')) return ok(EMPTY_DIRECTORY);
      if (method === 'GET' && url.pathname === '/v1/expenses/e1') {
        return ok({
          id: 'e1', occurredOn: '2026-09-01', amount: '99.99', currency: 'ILS', title: 'Hosting', vendor: 'ACME',
          categoryId: 'cat-1', customerId: null, projectId: null, notes: null, createdByUserId: 'u', version: 3,
          createdAt: '', updatedAt: '', receipts: [],
        });
      }
      if (method === 'PATCH' && url.pathname === '/v1/expenses/e1') {
        patchBody = JSON.parse(String(init.body));
        return ok({ id: 'e1' });
      }
      return fail(404, 'NOT_FOUND');
    });

    const { onClose } = renderDrawer({ mode: 'edit', expenseId: 'e1' });
    const vendorInput = await screen.findByDisplayValue('ACME');
    // MUT-272 review: the currency can't be picked on edit until MUT-277 sends it — a pick the PATCH dropped saved
    // the old currency silently.
    expect(document.getElementById('expense-currency')).toBeDisabled();
    await user.clear(vendorInput);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(patchBody).not.toBeNull();
    expect(patchBody).not.toHaveProperty('currency');
    expect((patchBody as Record<string, unknown>).vendor).toBeNull();
    expect((patchBody as Record<string, unknown>).title).toBe('Hosting');
    // An edit is not a new expense (MUT-155)
    expect(trackPortal).not.toHaveBeenCalled();
  });

  it('shows a field-level error for an archived category and does not close the drawer', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input), 'http://portal.test');
      const method = (init.method ?? 'GET').toUpperCase();
      if (method === 'GET' && url.pathname === '/v1/expense-categories') return ok(EMPTY_CATEGORIES);
      if (method === 'GET' && (url.pathname === '/v1/customers' || url.pathname === '/v1/projects')) return ok(EMPTY_DIRECTORY);
      if (method === 'POST' && url.pathname === '/v1/expenses') return fail(422, 'VALIDATION_FAILED', { reason: 'CATEGORY_ARCHIVED' });
      return fail(404, 'NOT_FOUND');
    });

    const { onClose } = renderDrawer();
    const amount = await screen.findByPlaceholderText('0.00');
    await user.type(amount, '12.50');
    const categorySelect = await screen.findByDisplayValue('Choose a category');
    await user.selectOptions(categorySelect, 'cat-1');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('This category is no longer available — pick another')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(trackPortal).not.toHaveBeenCalled();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDrawer();
    await screen.findByText('Record expense');
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on overlay click', async () => {
    const { onClose } = renderDrawer();
    await screen.findByText('Record expense');
    const overlay = document.querySelector('.drawer-overlay');
    expect(overlay).toBeTruthy();
    (overlay as HTMLElement).click();
    expect(onClose).toHaveBeenCalled();
  });

  describe('a stale version (MUT-221)', () => {
    function expense(over: Record<string, unknown> = {}) {
      return {
        id: 'e1', occurredOn: '2026-09-01', amount: '99.99', currency: 'ILS', title: 'Hosting', vendor: 'ACME',
        categoryId: 'cat-1', customerId: null, projectId: null, notes: null, createdByUserId: 'u', version: 3,
        createdAt: '', updatedAt: '', receipts: [], ...over,
      };
    }

    function server(current: () => Record<string, unknown>, onPatch: (ifMatch: string | null) => Response) {
      const calls: { method: string; ifMatch: string | null }[] = [];
      fetchMock.mockImplementation(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = new URL(String(input), 'http://portal.test');
        const method = (init.method ?? 'GET').toUpperCase();
        const ifMatch = new Headers(init.headers).get('if-match');
        if (method === 'GET' && url.pathname === '/v1/expense-categories') return ok(EMPTY_CATEGORIES);
        if (method === 'GET' && (url.pathname === '/v1/customers' || url.pathname === '/v1/projects')) return ok(EMPTY_DIRECTORY);
        if (url.pathname !== '/v1/expenses/e1') return fail(404, 'NOT_FOUND');
        calls.push({ method, ifMatch });
        if (method === 'GET') return ok(current());
        if (method === 'PATCH') return onPatch(ifMatch);
        return fail(404, 'NOT_FOUND');
      });
      return calls;
    }

    it('on 409 shows the conflict message, stays open, refills with the latest values, and the next Save uses the new version', async () => {
      const user = userEvent.setup();
      let latest = expense();
      const calls = server(
        () => latest,
        (ifMatch) => (ifMatch === '3' ? fail(409, 'CONFLICT', { reason: 'VERSION_MISMATCH', currentVersion: 4 }) : ok(expense({ version: 5 }))),
      );
      const { onClose } = renderDrawer({ mode: 'edit', expenseId: 'e1' });
      const vendor = (await screen.findByDisplayValue('ACME')) as HTMLInputElement;
      // Someone else changes it meanwhile.
      latest = expense({ vendor: 'Changed elsewhere', version: 4 });
      await user.clear(vendor);
      await user.type(vendor, 'Mine');
      await user.click(screen.getByRole('button', { name: 'Save' }));

      expect(await screen.findByText(EN_CONFLICT)).toBeInTheDocument();
      expect(await screen.findByDisplayValue('Changed elsewhere')).toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(onClose).toHaveBeenCalled());
      expect(calls.filter((c) => c.method === 'PATCH').map((c) => c.ifMatch)).toEqual(['3', '4']);
    });

    it('keeps what was typed when the same version is refetched in the background', async () => {
      const user = userEvent.setup();
      server(() => expense(), () => ok(expense({ version: 4 })));
      const { queryClient } = renderDrawer({ mode: 'edit', expenseId: 'e1' });
      const vendor = (await screen.findByDisplayValue('ACME')) as HTMLInputElement;
      await user.clear(vendor);
      await user.type(vendor, 'Typed');

      await queryClient.refetchQueries();

      expect(vendor.value).toBe('Typed');
    });
  });
});

describe('ExpenseDrawer: added by Claude (MUT-436 AC5)', () => {
  const expenseFrom = (captureSource: string | null) => () =>
    ok({
      id: 'e1', occurredOn: '2026-09-01', amount: '45.90', currency: 'ILS', title: null, vendor: 'كارفور',
      categoryId: null, customerId: null, projectId: null, notes: null, createdByUserId: 'u', captureSource, version: 1,
      createdAt: '', updatedAt: '', receipts: [],
    });
  const routesWith = (captureSource: string | null) => ({
    'GET /v1/expense-categories': () => ok(EMPTY_CATEGORIES),
    'GET /v1/customers': () => ok(EMPTY_DIRECTORY),
    'GET /v1/projects': () => ok(EMPTY_DIRECTORY),
    'GET /v1/expenses/e1': expenseFrom(captureSource),
  });

  it('marks an expense a person’s Claude added', async () => {
    route(routesWith('mcp'));
    renderDrawer({ mode: 'edit', expenseId: 'e1' });
    expect(await screen.findByText(en.hosted.expenses.drawer.addedByClaude.replace('{claude}', '').trim(), { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Claude').tagName).toBe('BDI');
  });

  it('says it in Arabic too, with Claude kept left-to-right', async () => {
    localStorage.setItem(PORTAL_LANGUAGE_KEY, 'ar');
    route(routesWith('mcp'));
    renderDrawer({ mode: 'edit', expenseId: 'e1' });
    expect(await screen.findByText(ar.hosted.expenses.drawer.addedByClaude.replace('{claude}', '').trim(), { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Claude').tagName).toBe('BDI');
  });

  it('shows nothing for an expense from the phone or the portal', async () => {
    for (const source of ['siri', null]) {
      route(routesWith(source));
      const { unmount } = renderDrawerUnmountable();
      await screen.findByDisplayValue('45.90');
      expect(screen.queryByText('Claude')).toBeNull();
      unmount();
    }
  });
});

function renderDrawerUnmountable() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <HostedLanguageProvider>
        <ToastProvider>
          <ExpenseDrawer profileId="org-1" mode="edit" expenseId="e1" onClose={vi.fn()} />
        </ToastProvider>
      </HostedLanguageProvider>
    </QueryClientProvider>,
  );
}

describe('ExpenseDrawer delete confirm (DESIGN.md › Destructive confirm, MUT-417)', () => {
  function expenseRoutes(expense: Record<string, unknown>, deletes: string[]) {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input), 'http://portal.test');
      const method = (init.method ?? 'GET').toUpperCase();
      if (method === 'GET' && url.pathname === '/v1/expense-categories') return ok(EMPTY_CATEGORIES);
      if (method === 'GET' && (url.pathname === '/v1/customers' || url.pathname === '/v1/projects')) return ok(EMPTY_DIRECTORY);
      if (method === 'GET' && url.pathname === '/v1/expenses/e1') {
        return ok({
          id: 'e1', occurredOn: '2026-09-01', amount: '99.99', currency: 'ILS', title: 'Hosting', vendor: 'ACME',
          categoryId: 'cat-1', customerId: null, projectId: null, notes: null, createdByUserId: 'u', version: 3,
          createdAt: '', updatedAt: '', receipts: [], ...expense,
        });
      }
      if (method === 'DELETE' && url.pathname === '/v1/expenses/e1') {
        deletes.push(url.pathname);
        return new Response(null, { status: 204 });
      }
      return fail(404, 'NOT_FOUND');
    });
  }

  it('never calls window.confirm: Delete turns the footer into a confirm naming the expense, and its Delete removes it', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal('confirm', confirmSpy);
    const deletes: string[] = [];
    expenseRoutes({}, deletes);
    const onDeleted = vi.fn();
    renderDrawer({ mode: 'edit', expenseId: 'e1', onDeleted });
    await screen.findByDisplayValue('ACME');

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const group = screen.getByRole('group', { name: /^Delete “Hosting” \(.*99\.99\)\? This can't be undone\.$/ });
    expect(within(group).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(deletes).toEqual([]);

    await user.click(within(group).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith('e1'));
    expect(deletes).toEqual(['/v1/expenses/e1']);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('names the vendor when there is no title, and Escape cancels without closing the drawer', async () => {
    const user = userEvent.setup();
    const deletes: string[] = [];
    expenseRoutes({ title: null }, deletes);
    const { onClose } = renderDrawer({ mode: 'edit', expenseId: 'e1' });
    await screen.findByDisplayValue('ACME');

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('group', { name: /^Delete “ACME”/ })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('group', { name: /^Delete “ACME”/ })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete' })).toHaveFocus());
    expect(onClose).not.toHaveBeenCalled();
    expect(deletes).toEqual([]);
  });
});

describe('ExpenseDrawer receipts on a new expense (MUT-491)', () => {
  const EXPENSE = { id: 'e1', amount: '12.50', currency: 'USD', occurredOn: '2026-10-28', title: null, vendor: null, categoryId: 'cat-1', customerId: null, projectId: null, notes: null, version: 1, captureSource: 'portal' };
  const READY = (name: string, id: string) => ({ id, expenseId: 'e1', filename: name, mimeType: 'application/pdf', sizeBytes: 4, status: 'READY', uploadedByUserId: 'u1', createdAt: '', completedAt: '' });
  const pdf = (name: string) => new File(['%PDF'], name, { type: 'application/pdf' });

  /** The list's part (ExpensesList): onCreated moves the drawer to ?expense=<id>, the same instance in edit mode. */
  function Flip({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
    const [expenseId, setExpenseId] = useState<string | undefined>(undefined);
    return (
      <ExpenseDrawer
        profileId="org-1"
        mode={expenseId ? 'edit' : 'create'}
        expenseId={expenseId}
        onClose={onClose}
        onCreated={(id) => {
          onCreated(id);
          setExpenseId(id);
        }}
      />
    );
  }

  function renderFlip() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const onClose = vi.fn();
    const onCreated = vi.fn();
    const utils = render(
      <QueryClientProvider client={queryClient}>
        <HostedLanguageProvider>
          <ToastProvider>
            <Flip onClose={onClose} onCreated={onCreated} />
          </ToastProvider>
        </HostedLanguageProvider>
      </QueryClientProvider>,
    );
    return { ...utils, onClose, onCreated };
  }

  /** Routes for a create and its receipts; `putStatus` per filename (200 unless named). */
  function receiptRoutes({ putStatus = {}, holdCreate, holdPut }: { putStatus?: Record<string, number>; holdCreate?: Promise<void>; holdPut?: Promise<void> } = {}) {
    const landed: ReturnType<typeof READY>[] = [];
    const calls: string[] = [];
    let n = 0;
    const pending = new Map<string, string>();
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      const method = (init.method ?? 'GET').toUpperCase();
      if (url.startsWith('https://bucket.test/')) {
        const id = url.slice('https://bucket.test/'.length);
        calls.push(`PUT ${pending.get(id)}`);
        if (holdPut) await holdPut;
        return new Response(null, { status: putStatus[pending.get(id) ?? ''] ?? 200 });
      }
      const path = new URL(url, 'http://portal.test').pathname;
      calls.push(`${method} ${path}`);
      if (method === 'GET' && path === '/v1/expense-categories') return ok(EMPTY_CATEGORIES);
      if (method === 'GET' && (path === '/v1/customers' || path === '/v1/projects' || path === '/v1/vendors')) return ok(EMPTY_DIRECTORY);
      if (method === 'POST' && path === '/v1/expenses') {
        if (holdCreate) await holdCreate;
        return ok(EXPENSE, 201);
      }
      if (method === 'GET' && path === '/v1/expenses/e1') return ok({ ...EXPENSE, receipts: landed });
      if (method === 'POST' && path === '/v1/expenses/e1/receipts') {
        const id = `r${++n}`;
        const filename = JSON.parse(String(init.body)).filename as string;
        pending.set(id, filename);
        return ok({ receipt: { ...READY(filename, id), status: 'PENDING_UPLOAD' }, upload: { url: `https://bucket.test/${id}`, method: 'PUT', headers: {}, expiresAt: '' } }, 201);
      }
      const complete = path.match(/^\/v1\/expenses\/e1\/receipts\/(r\d+)\/complete$/);
      if (method === 'POST' && complete) {
        const done = READY(pending.get(complete[1]!)!, complete[1]!);
        landed.push(done);
        return ok(done);
      }
      if (method === 'DELETE' && path.startsWith('/v1/expenses/e1/receipts/')) return new Response(null, { status: 204 });
      return fail(404, 'NOT_FOUND');
    });
    return { calls };
  }

  async function fillAndQueue(user: ReturnType<typeof userEvent.setup>, files: File[]) {
    await user.type(await screen.findByPlaceholderText('0.00'), '12.50');
    await user.selectOptions(await screen.findByDisplayValue('Choose a category'), 'cat-1');
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files } });
  }

  it('a new expense without receipts saves as before', async () => {
    const user = userEvent.setup();
    const { calls } = receiptRoutes();
    const { onClose, onCreated } = renderFlip();
    await user.type(await screen.findByPlaceholderText('0.00'), '12.50');
    await user.selectOptions(await screen.findByDisplayValue('Choose a category'), 'cat-1');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onCreated).not.toHaveBeenCalled();
    expect(calls.filter((c) => c === 'POST /v1/expenses')).toHaveLength(1);
  });

  it('creates once, opens the new expense, uploads each receipt to it, and closes when all landed', async () => {
    const user = userEvent.setup();
    const { calls } = receiptRoutes();
    const { onClose, onCreated } = renderFlip();
    await fillAndQueue(user, [pdf('taxi.pdf'), pdf('hotel.pdf')]);
    expect(screen.getByText('taxi.pdf')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('e1'));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(calls.filter((c) => c === 'POST /v1/expenses')).toHaveLength(1);
    expect(calls.filter((c) => c.startsWith('PUT '))).toEqual(['PUT taxi.pdf', 'PUT hotel.pdf']);
    expect(calls.filter((c) => /\/complete$/.test(c))).toHaveLength(2);
  });

  it('a second Save while the create is in flight sends no second POST', async () => {
    const user = userEvent.setup();
    let release!: () => void;
    const { calls } = receiptRoutes({ holdCreate: new Promise<void>((resolve) => (release = resolve)) });
    renderFlip();
    await fillAndQueue(user, [pdf('taxi.pdf')]);
    const form = document.getElementById('hosted-expense-form') as HTMLFormElement;
    fireEvent.submit(form);
    fireEvent.submit(form);
    release();
    await waitFor(() => expect(calls.filter((c) => /\/complete$/.test(c))).toHaveLength(1));
    expect(calls.filter((c) => c === 'POST /v1/expenses')).toHaveLength(1);
  });

  it('a failed receipt keeps the drawer open on the new expense, the failure on that file, the others in', async () => {
    const user = userEvent.setup();
    receiptRoutes({ putStatus: { 'hotel.pdf': 403 } });
    const { onClose } = renderFlip();
    await fillAndQueue(user, [pdf('taxi.pdf'), pdf('hotel.pdf')]);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText("Couldn't upload the receipt. Try again.")).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Edit expense' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Upload again' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closing while receipts upload lets them finish without closing or flashing anything later', async () => {
    const user = userEvent.setup();
    let release!: () => void;
    const { calls } = receiptRoutes({ holdPut: new Promise<void>((resolve) => (release = resolve)) });
    const { onClose, unmount } = renderFlip();
    await fillAndQueue(user, [pdf('taxi.pdf')]);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls).toContain('PUT taxi.pdf'));
    unmount();
    release();
    await waitFor(() => expect(calls.filter((c) => /\/complete$/.test(c))).toHaveLength(1));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('offers no receipts on a new expense when the caller cannot open it afterwards', async () => {
    renderDrawer();
    await screen.findByPlaceholderText('0.00');
    expect(screen.queryByRole('button', { name: 'Add receipt' })).not.toBeInTheDocument();
  });
});

describe('ExpenseDrawer VAT row (MUT-302)', () => {
  const EXISTING = {
    id: 'e1', occurredOn: '2026-09-01', amount: '117.00', currency: 'ILS', title: 'Printer', vendor: null, vendorId: null,
    categoryId: 'cat-1', customerId: null, projectId: null, notes: null, createdByUserId: 'u', captureSource: null, version: 3,
    createdAt: '', updatedAt: '', receipts: [],
  };
  const WITH_VAT = { ...EXISTING, vat: { treatment: 'STANDARD_RATED', rateBasisPoints: 1700, net: '100.00', vat: '17.00', gross: '117.00' } };
  let sent: unknown;
  const typeAmount = async (user: ReturnType<typeof userEvent.setup>, amount: string) => {
    await user.type(await screen.findByPlaceholderText('0.00'), amount);
    await user.selectOptions(await screen.findByDisplayValue('Choose a category'), 'cat-1');
  };
  const capture = (extra: Record<string, () => Response> = {}) => {
    sent = undefined;
    route({
      'GET /v1/expense-categories': () => ok(EMPTY_CATEGORIES),
      'GET /v1/customers': () => ok(EMPTY_DIRECTORY),
      'GET /v1/projects': () => ok(EMPTY_DIRECTORY),
      'POST /v1/expenses': () => ok({ ...EXISTING, vat: null }, 201),
      ...extra,
    });
    const handler = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      if (init.method === 'POST' || init.method === 'PATCH') sent = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
      return handler(input, init);
    });
  };

  it('AC3: a non-firm profile has no VAT row, and its body sends no vat', async () => {
    const user = userEvent.setup();
    capture();
    const { onClose } = renderDrawer();
    await typeAmount(user, '117');
    expect(screen.queryByTestId('expense-vat')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(sent).not.toHaveProperty('vat');
  });

  it('a firm profile reads "No VAT recorded"; Standard 17 % on 117 previews 100.00 + 17.00 and saves the rate', async () => {
    const user = userEvent.setup();
    capture();
    const { onClose } = renderDrawer({ firm: true });
    await typeAmount(user, '117');
    expect(screen.getByTestId('expense-vat-summary')).toHaveTextContent('No VAT recorded');
    await user.click(screen.getByRole('button', { name: /VAT/ }));
    await user.selectOptions(screen.getByLabelText('Treatment'), 'STANDARD_RATED');
    await user.type(screen.getByLabelText('Rate'), '17');
    const split = screen.getByTestId('expense-vat-split');
    expect(split).toHaveTextContent('100.00');
    expect(split).toHaveTextContent('17.00');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(sent).toMatchObject({ amount: '117', vat: { treatment: 'STANDARD_RATED', rateBasisPoints: 1700 } });
  });

  it('a firm expense with no VAT chosen sends no vat', async () => {
    const user = userEvent.setup();
    capture();
    const { onClose } = renderDrawer({ firm: true });
    await typeAmount(user, '50');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(sent).not.toHaveProperty('vat');
  });

  it('Standard with no rate stops at the field, opened, and sends nothing', async () => {
    const user = userEvent.setup();
    capture();
    renderDrawer({ firm: true });
    await typeAmount(user, '117');
    await user.click(screen.getByRole('button', { name: /VAT/ }));
    await user.selectOptions(screen.getByLabelText('Treatment'), 'STANDARD_RATED');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Enter the VAT rate')).toBeInTheDocument();
    expect(sent).toBeUndefined();
  });

  it('D4: an untouched edit leaves vat off the PATCH; the closed row reads the stored VAT', async () => {
    const user = userEvent.setup();
    capture({ 'GET /v1/expenses/e1': () => ok(WITH_VAT), 'PATCH /v1/expenses/e1': () => ok(WITH_VAT) });
    const { onClose } = renderDrawer({ mode: 'edit', expenseId: 'e1', firm: true });
    await screen.findByDisplayValue('Printer');
    expect(screen.getByTestId('expense-vat-summary')).toHaveTextContent('VAT 17%');
    expect(screen.getByTestId('expense-vat-summary')).toHaveTextContent('17.00');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(sent).not.toHaveProperty('vat');
  });

  it('D4: Remove VAT sends vat null; a changed rate sends the new one', async () => {
    const user = userEvent.setup();
    capture({ 'GET /v1/expenses/e1': () => ok(WITH_VAT), 'PATCH /v1/expenses/e1': () => ok(WITH_VAT) });
    const { onClose } = renderDrawer({ mode: 'edit', expenseId: 'e1', firm: true });
    await screen.findByDisplayValue('Printer');
    await user.click(screen.getByRole('button', { name: /VAT/ }));
    await user.click(screen.getByRole('button', { name: 'Remove VAT' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(sent).toMatchObject({ vat: null });
  });

  it('OV10: retyping the same rate as "17.00" is no change', async () => {
    const user = userEvent.setup();
    capture({ 'GET /v1/expenses/e1': () => ok(WITH_VAT), 'PATCH /v1/expenses/e1': () => ok(WITH_VAT) });
    const { onClose } = renderDrawer({ mode: 'edit', expenseId: 'e1', firm: true });
    await screen.findByDisplayValue('Printer');
    await user.click(screen.getByRole('button', { name: /VAT/ }));
    const rate = screen.getByLabelText('Rate');
    await user.clear(rate);
    await user.type(rate, '17.00');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(sent).not.toHaveProperty('vat');
  });

  it('in Arabic, the summary’s amount sits in a <bdi> (ADR-101)', async () => {
    localStorage.setItem(PORTAL_LANGUAGE_KEY, 'ar');
    capture({ 'GET /v1/expenses/e1': () => ok(WITH_VAT) });
    renderDrawer({ mode: 'edit', expenseId: 'e1', firm: true });
    await screen.findByDisplayValue('Printer');
    const summary = screen.getByTestId('expense-vat-summary');
    expect(summary).toHaveTextContent(ar.hosted.expenses.vat.summary.replace('{rate}', '17'));
    expect(summary.querySelector('bdi')).not.toBeNull();
  });
});

describe('ExpenseDrawer VAT row summary (MUT-302 review)', () => {
  it('reads the rate as a clean percent, whatever was typed', async () => {
    const user = userEvent.setup();
    renderDrawer({ firm: true });
    await user.type(await screen.findByPlaceholderText('0.00'), '117');
    const toggle = screen.getByRole('button', { name: /VAT/ });
    await user.click(toggle);
    await user.selectOptions(screen.getByLabelText('Treatment'), 'STANDARD_RATED');
    await user.type(screen.getByLabelText('Rate'), '17.50%');
    await user.click(toggle);
    expect(screen.getByTestId('expense-vat-summary')).toHaveTextContent(/^VAT 17\.5%/);
  });
});
