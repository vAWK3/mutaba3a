import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Receivable } from '../../api/client';
import { HostedLanguageProvider, PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';
import { profile, type StubRequest } from '../../__tests__/harness';
import { CUSTOMERS, PROJECTS, receivable } from '../../pages/__tests__/fixtures';
import { ToastProvider } from '../Toast';
import { RecordPaymentDrawer } from '../RecordPaymentDrawer';

const R = 'b1111111-1111-4111-8111-111111111111';
const C1 = CUSTOMERS[0].id;
const P1 = PROJECTS[0].id;
const PERSONAL = profile({
  writerOfRecord: null,
  isPersonalDefault: true,
  access: { payments: 'read-write', capture: 'read-write', expenses: 'read-write' },
  income: { received: true, owed: true, customer: 'optional' },
  timezone: 'Asia/Jerusalem',
});

const strip = (text: string | null) => (text ?? '').replace(/[⁦-⁩]/g, '');
const owed = (overrides: Partial<Receivable> = {}): Receivable => ({ ...receivable(R, C1, P1, '5000.00', 'DUE', '2026-10-15'), origin: 'ADJUSTMENT', ...overrides });

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
function fail(status: number, code: string, details?: unknown) {
  return json({ error: { code, message: code, details: details ?? null, requestId: 'req-1' } }, status);
}

interface Routes {
  get?: () => Response | Promise<Response>;
  settle?: (request: StubRequest) => Response | Promise<Response>;
}

function stub({ get = () => json(owed()), settle = () => json({ receivable: owed({ status: 'PAID', outstanding: '0.00' }), payment: {} }, 201) }: Routes = {}) {
  const calls: StubRequest[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input), 'http://portal.test');
      const method = (init.method ?? 'GET').toUpperCase();
      const request = { method, url, headers: new Headers(init.headers), body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined };
      calls.push(request);
      if (url.pathname === '/v1/customers') return json({ items: CUSTOMERS, nextCursor: null });
      if (url.pathname === '/v1/projects') return json({ items: PROJECTS, nextCursor: null });
      if (method === 'GET' && url.pathname === `/v1/receivables/${R}`) return get();
      if (method === 'POST' && url.pathname === `/v1/receivables/${R}/settle`) return settle(request);
      return fail(404, 'NOT_FOUND');
    }),
  );
  return { calls, count: (method: string, path: string) => calls.filter((c) => c.method === method && c.url.pathname === path).length };
}

function renderDrawer() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const onClose = vi.fn();
  const onSettled = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <HostedLanguageProvider>
        <ToastProvider>
          <RecordPaymentDrawer profile={PERSONAL} receivableId={R} onClose={onClose} onSettled={onSettled} />
        </ToastProvider>
      </HostedLanguageProvider>
    </QueryClientProvider>,
  );
  return { onClose, onSettled, user: userEvent.setup() };
}

const save = () => screen.getByRole('button', { name: 'Record payment' });
const amountLine = () => document.querySelector('.hp-settle-line');

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-14T09:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('RecordPaymentDrawer (MUT-133)', () => {
  it('opens at once with a skeleton and a disabled Save, then shows what is left in the title (5A, 2A)', async () => {
    let release: (r: Response) => void = () => {};
    stub({ get: () => new Promise<Response>((resolve) => (release = resolve)) });
    renderDrawer();
    expect(screen.getByRole('heading', { name: 'Record payment' })).toBeInTheDocument();
    expect(screen.getByLabelText('Loading')).toHaveAttribute('aria-busy', 'true');
    expect(save()).toBeDisabled();
    release(json(owed()));
    const heading = await screen.findByRole('heading', { name: /left/ });
    expect(strip(heading.textContent)).toBe('Record payment · ₪5,000.00 left');
    expect(await screen.findByText('Al-Quds Bakery · Lease dispute · due Oct 15, 2026')).toBeInTheDocument();
    expect(screen.getByText("Check the amount: a recorded payment can't be changed yet.")).toBeInTheDocument();
  });

  it('records the full amount it shows, always sending it, dated today in the profile\'s zone (R2, R3)', async () => {
    const api = stub();
    const { onSettled, user } = renderDrawer();
    const amount = await screen.findByLabelText('Amount (ILS)');
    expect(amount).toHaveValue('5000.00');
    expect(amountLine()).toHaveTextContent('Paid in full');
    await user.click(save());
    await waitFor(() => expect(onSettled).toHaveBeenCalled());
    const post = api.calls.find((c) => c.method === 'POST')!;
    expect(post.body).toEqual({ amount: '5000.00', paidAt: '2026-10-14', method: 'CASH' });
    expect(post.headers.get('Idempotency-Key')).toBeTruthy();
    expect(onSettled.mock.calls[0][0].receivable.status).toBe('PAID');
    const toast = screen.getByTestId('toast-live');
    expect(strip(toast.textContent)).toBe('Payment recorded · ₪5,000.00 from Al-Quds Bakery');
  });

  it('says what stays owed for a partial payment and sends what was typed (4A)', async () => {
    const api = stub({ settle: () => json({ receivable: owed({ status: 'PARTIALLY_PAID', outstanding: '3000.00' }), payment: {} }, 201) });
    const { onSettled, user } = renderDrawer();
    const amount = await screen.findByLabelText('Amount (ILS)');
    await user.clear(amount);
    await user.type(amount, '2,000');
    expect(strip(amountLine()!.textContent)).toBe('₪3,000.00 still owed');
    await user.click(save());
    await waitFor(() => expect(onSettled).toHaveBeenCalled());
    expect(api.calls.find((c) => c.method === 'POST')!.body).toMatchObject({ amount: '2000.00' });
  });

  it('blocks Save while the amount exceeds what is left (4A)', async () => {
    const api = stub();
    const { user } = renderDrawer();
    const amount = await screen.findByLabelText('Amount (ILS)');
    await user.clear(amount);
    await user.type(amount, '6000');
    expect(strip(amountLine()!.textContent)).toBe("Exceeds what's left (₪5,000.00)");
    expect(save()).toBeDisabled();
    await user.clear(amount);
    await user.type(amount, '100');
    expect(save()).toBeEnabled();
    expect(api.count('POST', `/v1/receivables/${R}/settle`)).toBe(0);
  });

  it('shows the new figure and re-reads when a phone partial landed meanwhile (R2)', async () => {
    let reads = 0;
    const api = stub({
      get: () => json(++reads === 1 ? owed() : owed({ outstanding: '3000.00', status: 'PARTIALLY_PAID', version: 2 })),
      settle: () => fail(422, 'VALIDATION_FAILED', { reason: 'ALLOCATION_EXCEEDS_OUTSTANDING', outstanding: '3000.00' }),
    });
    const { user, onSettled } = renderDrawer();
    await screen.findByLabelText('Amount (ILS)');
    await user.click(save());
    await waitFor(() => expect(api.count('GET', `/v1/receivables/${R}`)).toBe(2));
    const heading = await screen.findByRole('heading', { name: /3,000/ });
    expect(strip(heading.textContent)).toBe('Record payment · ₪3,000.00 left');
    expect(onSettled).not.toHaveBeenCalled();
  });

  it('keeps the inline error from the race visible until the amount changes', async () => {
    stub({ settle: () => fail(422, 'VALIDATION_FAILED', { reason: 'ALLOCATION_EXCEEDS_OUTSTANDING', outstanding: '3000.00' }) });
    const { user } = renderDrawer();
    await screen.findByLabelText('Amount (ILS)');
    await user.click(save());
    const error = await screen.findByText(/more than what's left now/);
    expect(strip(error.textContent)).toBe("That's more than what's left now (₪3,000.00)");
  });

  it('says there is nothing left to pay when the entry was paid, voided or removed', async () => {
    stub({ get: () => json(owed({ status: 'PAID', outstanding: '0.00' })) });
    renderDrawer();
    expect(await screen.findByText('Nothing left to pay on this entry')).toBeInTheDocument();
    expect(screen.queryByLabelText('Amount (ILS)')).toBeNull();
    expect(save()).toBeDisabled();
  });

  it('treats a 404 the same way', async () => {
    stub({ get: () => fail(404, 'NOT_FOUND') });
    renderDrawer();
    expect(await screen.findByText('Nothing left to pay on this entry')).toBeInTheDocument();
  });

  it('shows the unreachable state, not a form, when the receivable cannot load', async () => {
    stub({ get: () => fail(500, 'INTERNAL') });
    renderDrawer();
    expect(await screen.findByText("Can't reach Mutaba3a right now")).toBeInTheDocument();
    expect(screen.queryByLabelText('Amount (ILS)')).toBeNull();
  });

  it('toasts and re-reads when another settle won the race', async () => {
    const api = stub({ settle: () => fail(409, 'CONFLICT', { reason: 'VERSION_MISMATCH' }) });
    const { user } = renderDrawer();
    await screen.findByLabelText('Amount (ILS)');
    await user.click(save());
    expect(await screen.findByRole('alert')).toHaveTextContent('This entry changed while you were recording. Showing the latest.');
    await waitFor(() => expect(api.count('GET', `/v1/receivables/${R}`)).toBe(2));
  });

  it('labels Method as a radio group', async () => {
    stub();
    renderDrawer();
    const group = await screen.findByRole('radiogroup', { name: 'Method' });
    expect(within(group).getByRole('radio', { name: 'Cash' })).toHaveAttribute('aria-checked', 'true');
  });
});
