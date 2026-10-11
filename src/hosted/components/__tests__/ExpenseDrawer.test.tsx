import type { ComponentProps } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HostedLanguageProvider } from '../../i18n/HostedLanguageProvider';
import { ToastProvider } from '../Toast';
import { ExpenseDrawer } from '../ExpenseDrawer';

const fetchMock = vi.fn();

function ok(body: unknown, status = 200) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function fail(status: number, code: string, details?: unknown) {
  return ok({ error: { code, message: code, details: details ?? null, requestId: 'req-1' } }, status);
}

const EMPTY_CATEGORIES = { items: [{ id: 'cat-1', name: 'Software', color: null, archived: false, version: 1, createdAt: '', updatedAt: '' }] };
const EMPTY_DIRECTORY = { items: [], nextCursor: null };

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
  return { onClose };
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  route({
    'GET /v1/expense-categories': () => ok(EMPTY_CATEGORIES),
    'GET /v1/customers': () => ok(EMPTY_DIRECTORY),
    'GET /v1/projects': () => ok(EMPTY_DIRECTORY),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('ExpenseDrawer (hosted)', () => {
  it('renders the create form once categories load, with the amount input in decimal-text mode', async () => {
    renderDrawer();
    await screen.findByText('Record expense');
    const amount = (await screen.findByPlaceholderText('0.00')) as HTMLInputElement;
    expect(amount.type).toBe('text');
    expect(amount.getAttribute('dir')).toBe('ltr');
    expect(amount.getAttribute('inputmode')).toBe('decimal');
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
});
