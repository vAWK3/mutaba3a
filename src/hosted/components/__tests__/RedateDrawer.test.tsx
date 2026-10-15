import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Payment, Receivable } from '../../api/client';
import { HostedLanguageProvider, PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';
import { profile, type StubRequest } from '../../__tests__/harness';
import { CUSTOMERS, PROJECTS, payment, receivable } from '../../pages/__tests__/fixtures';
import { ToastProvider } from '../Toast';
import { RedateDrawer } from '../RedateDrawer';

/** MUT-224: the ?income= / ?payment= drawers change one date, at the version they loaded. */

const R = 'b1111111-1111-4111-8111-111111111111';
const P = 'c1111111-1111-4111-8111-111111111111';
const P2 = 'c2222222-2222-4222-8222-222222222222';
const C1 = CUSTOMERS[0].id;
const ME = 'd1111111-1111-4111-8111-111111111111';
const PJ = PROJECTS[0].id;
const PERSONAL = profile({
  writerOfRecord: null,
  isPersonalDefault: true,
  owned: true,
  type: 'PERSONAL',
  access: { payments: 'read-write', capture: 'read-write', expenses: 'read-write' },
  income: { received: true, owed: true, customer: 'optional' },
  timezone: 'Asia/Jerusalem',
});

const owed = (o: Partial<Receivable> = {}): Receivable => ({ ...receivable(R, C1, PJ, '500.00', 'DUE', '2026-11-15'), origin: 'ADJUSTMENT', gross: '500.00', postingDate: '2026-10-08', version: 3, ...o });
const mine = (o: Partial<Payment> = {}): Payment => ({ ...payment(P, 'PAY-2026-0007'), id: P, origin: 'capture', status: 'POSTED', capturedBy: { userId: ME, displayName: 'Me' }, receivedOn: '2026-10-08', version: 2, allocations: [], allocated: '0.00', unallocated: '585.00', ...o });

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
function fail(status: number, code: string, details?: unknown) {
  return json({ error: { code, message: code, details: details ?? null, requestId: 'req-1' } }, status);
}

interface Routes {
  getOwed?: () => Response;
  getPayment?: () => Response;
  listPayments?: () => Response;
  patch?: (request: StubRequest) => Response | Promise<Response>;
}

function stub(routes: Routes = {}) {
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
      if (method === 'GET' && url.pathname === `/v1/receivables/${R}`) return (routes.getOwed ?? (() => json(owed())))();
      if (method === 'GET' && url.pathname === `/v1/payments/${P}`) return (routes.getPayment ?? (() => json(mine())))();
      if (method === 'GET' && url.pathname === '/v1/payments') return (routes.listPayments ?? (() => json({ items: [], nextCursor: null })))();
      if (method === 'PATCH') return (routes.patch ?? (() => json({})))(request);
      return fail(404, 'NOT_FOUND');
    }),
  );
  return { calls, patches: () => calls.filter((c) => c.method === 'PATCH') };
}

function renderDrawer(kind: 'owed' | 'payment', id = kind === 'owed' ? R : P) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const props = { onClose: vi.fn(), onOpenPayment: vi.fn(), onSeePayments: vi.fn() };
  const view = render(
    <QueryClientProvider client={queryClient}>
      <HostedLanguageProvider>
        <ToastProvider>
          <RedateDrawer kind={kind} profile={PERSONAL} id={id} userId={ME} {...props} />
        </ToastProvider>
      </HostedLanguageProvider>
    </QueryClientProvider>,
  );
  return { ...props, user: userEvent.setup(), queryClient, unmount: view.unmount };
}

const dateInput = () => screen.findByLabelText<HTMLInputElement>(/^(Date|Received on)$/);
const save = () => screen.getByRole('button', { name: 'Save' });

async function setDate(user: ReturnType<typeof userEvent.setup>, value: string) {
  const input = await dateInput();
  await user.clear(input);
  await user.type(input, value);
}

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

describe('RedateDrawer — an Owed entry (?income=)', () => {
  it('shows the entry read-only, its date editable up to the profile’s today, and says the due date stays', async () => {
    stub();
    renderDrawer('owed');
    const input = await dateInput();
    expect(input.value).toBe('2026-10-08');
    expect(input.max).toBe('2026-10-14');
    expect(input.min).toBe('2016-10-06'); // MUT-227: the server's ten-year floor, today − 3660 days
    expect(screen.getByText(/Due Nov 15, 2026 — stays as it is/)).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('.hp-settle-context')?.textContent).toContain(CUSTOMERS[0].name));
    expect(screen.queryByRole('textbox', { name: /amount/i })).toBeNull();
  });

  it('saves the new date with If-Match at the loaded version, then closes', async () => {
    const api = stub({ patch: () => json({ id: R, kind: 'owed', occurredOn: '2026-09-30', version: 4 }) });
    const { user, onClose } = renderDrawer('owed');
    await setDate(user, '2026-09-30');
    await user.click(save());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const [sent] = api.patches();
    expect(sent!.url.pathname).toBe(`/v1/income/${R}`);
    expect(sent!.headers.get('If-Match')).toBe('3');
    expect(sent!.body).toEqual({ occurredOn: '2026-09-30' });
  });

  it('closes without a request when the date did not change', async () => {
    const api = stub();
    const { user, onClose } = renderDrawer('owed');
    await dateInput();
    await user.click(save());
    expect(onClose).toHaveBeenCalled();
    expect(api.patches()).toHaveLength(0);
  });

  it('on 409 re-reads, refills with the latest date, says so, and the next save sends the new version', async () => {
    let reads = 0;
    let conflicted = false;
    const api = stub({
      getOwed: () => json(reads++ === 0 ? owed() : owed({ postingDate: '2026-10-01', version: 4 })),
      patch: () => {
        if (!conflicted) {
          conflicted = true;
          return fail(409, 'CONFLICT', { reason: 'VERSION_MISMATCH', currentVersion: 4 });
        }
        return json({ id: R, version: 5 });
      },
    });
    const { user, onClose } = renderDrawer('owed');
    await setDate(user, '2026-09-30');
    await user.click(save());
    expect(await screen.findByText(/changed elsewhere/i)).toBeInTheDocument();
    await waitFor(async () => expect((await dateInput()).value).toBe('2026-10-01'));
    expect(onClose).not.toHaveBeenCalled();

    await setDate(user, '2026-09-29');
    await user.click(save());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.patches()[1]!.headers.get('If-Match')).toBe('4');
  });

  it('shows a server 422 under the date and stays open', async () => {
    stub({ patch: () => fail(422, 'VALIDATION_FAILED', { reason: 'DATE_INVALID', field: 'occurredOn' }) });
    const { user, onClose } = renderDrawer('owed');
    await setDate(user, '2026-10-13');
    await user.click(save());
    expect(await screen.findByText(/The date can.t be later than today/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('refuses a date more than ten years back before asking the server, as the server would (MUT-227)', async () => {
    const api = stub();
    const { user, onClose } = renderDrawer('owed');
    await setDate(user, '2016-10-05');
    await user.click(save());
    expect(await screen.findByText(/The date can.t be more than ten years ago/)).toBeInTheDocument();
    expect(api.patches()).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes without a request for an entry already older than the floor whose date did not change (MUT-227)', async () => {
    const api = stub({ getOwed: () => json(owed({ postingDate: '2010-03-01' })) });
    const { user, onClose } = renderDrawer('owed');
    await waitFor(async () => expect((await dateInput()).value).toBe('2010-03-01'));
    await user.click(save());
    expect(onClose).toHaveBeenCalled();
    expect(api.patches()).toHaveLength(0);
  });

  it('says "more than ten years ago" when the server refuses the date with the past bound (MUT-227)', async () => {
    stub({ patch: () => fail(422, 'VALIDATION_FAILED', { reason: 'DATE_INVALID', field: 'occurredOn', bound: 'past' }) });
    const { user, onClose } = renderDrawer('owed');
    await setDate(user, '2016-10-07');
    await user.click(save());
    expect(await screen.findByText(/The date can.t be more than ten years ago/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps a typed date when a background re-read brings a new version, and saves at that version', async () => {
    let reads = 0;
    const api = stub({ getOwed: () => json(reads++ === 0 ? owed() : owed({ version: 4 })), patch: () => json({ id: R, version: 5 }) });
    const { user, onClose, queryClient } = renderDrawer('owed');
    await setDate(user, '2026-09-30');
    await queryClient.invalidateQueries();
    await waitFor(() => expect(reads).toBe(2));
    expect((await dateInput()).value).toBe('2026-09-30');
    await user.click(save());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.patches()[0]!.headers.get('If-Match')).toBe('4');
  });

  it('refills an untouched date when a background re-read brings a new one', async () => {
    let reads = 0;
    stub({ getOwed: () => json(reads++ === 0 ? owed() : owed({ postingDate: '2026-10-01', version: 4 })) });
    const { queryClient } = renderDrawer('owed');
    await dateInput();
    await queryClient.invalidateQueries();
    await waitFor(async () => expect((await dateInput()).value).toBe('2026-10-01'));
  });

  it('does not close or toast for a save that answers after the drawer was closed', async () => {
    let answer: (response: Response) => void = () => {};
    stub({ patch: () => new Promise<Response>((resolve) => (answer = resolve)) });
    const { user, onClose, unmount } = renderDrawer('owed');
    await setDate(user, '2026-09-30');
    await user.click(save());
    unmount();
    answer(json({ id: R, version: 4 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows "no longer available" for an entry Malafat posted (the server would refuse it)', async () => {
    stub({ getOwed: () => json(owed({ origin: 'INSTALLMENT' })) });
    renderDrawer('owed');
    expect(await screen.findByText('This entry is no longer available.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('says calmly when the entry no longer exists', async () => {
    stub({ getOwed: () => fail(404, 'NOT_FOUND') });
    renderDrawer('owed');
    expect(await screen.findByText('This entry is no longer available.')).toBeInTheDocument();
  });

  it('makes no payments request for an entry nothing was paid on', async () => {
    const api = stub();
    renderDrawer('owed');
    await dateInput();
    expect(api.calls.some((c) => c.url.pathname === '/v1/payments')).toBe(false);
  });

  it('lists the payments applied to a settled entry; a line opens that payment (eng review R4)', async () => {
    const applied = mine({ id: P2, receivedOn: '2026-10-10', amount: '500.00', allocations: [{ ...payment(P2, 'x').allocations[0]!, receivableId: R }] });
    const other = mine({ id: P, allocations: [] });
    const api = stub({ getOwed: () => json(owed({ status: 'PAID', paid: '500.00', outstanding: '0.00' })), listPayments: () => json({ items: [applied, other], nextCursor: null }) });
    const { user, onOpenPayment, onSeePayments } = renderDrawer('owed');
    const line = await screen.findByRole('button', { name: /Oct 10, 2026/ });
    expect(screen.queryAllByRole('button', { name: /Oct 8, 2026/ })).toHaveLength(0);
    const list = api.calls.find((c) => c.url.pathname === '/v1/payments')!;
    expect(list.url.searchParams.get('customerId')).toBe(C1);
    await user.click(line);
    expect(onOpenPayment).toHaveBeenCalledWith(P2);
    expect(screen.queryByRole('button', { name: /See this client’s payments/ })).toBeNull();
    expect(onSeePayments).not.toHaveBeenCalled();
  });

  it('offers the client’s payments when the first page may not hold them all', async () => {
    stub({ getOwed: () => json(owed({ status: 'PAID', paid: '500.00', outstanding: '0.00' })), listPayments: () => json({ items: [], nextCursor: 'next' }) });
    const { user, onSeePayments } = renderDrawer('owed');
    await user.click(await screen.findByRole('button', { name: /See this client’s payments/ }));
    expect(onSeePayments).toHaveBeenCalledWith(C1);
  });
});

describe('RedateDrawer — a payment (?payment=)', () => {
  it('saves the new received date with If-Match through PATCH /v1/payments', async () => {
    const api = stub({ patch: () => json(mine({ receivedOn: '2026-10-02', version: 3 })) });
    const { user, onClose } = renderDrawer('payment');
    expect((await dateInput()).value).toBe('2026-10-08');
    await setDate(user, '2026-10-02');
    await user.click(save());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const [sent] = api.patches();
    expect(sent!.url.pathname).toBe(`/v1/payments/${P}`);
    expect(sent!.headers.get('If-Match')).toBe('2');
    expect(sent!.body).toEqual({ receivedOn: '2026-10-02' });
  });
});

describe('RedateDrawer — a payment it can no longer change', () => {
  it('shows "no longer available" for an undone payment or someone else’s, with no Save', async () => {
    for (const refused of [mine({ status: 'REVERSED' }), mine({ capturedBy: { userId: 'u-other', displayName: 'Rami' } })]) {
      stub({ getPayment: () => json(refused) });
      const { unmount } = renderDrawer('payment');
      expect(await screen.findByText('This entry is no longer available.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
      unmount();
      vi.unstubAllGlobals();
    }
  });

  it('when the server answers 404 on save, says so instead of doing nothing', async () => {
    let reads = 0;
    stub({ getPayment: () => json(reads++ === 0 ? mine() : mine({ status: 'REVERSED', version: 3 })), patch: () => fail(404, 'NOT_FOUND') });
    const { user, onClose } = renderDrawer('payment');
    await setDate(user, '2026-10-02');
    await user.click(save());
    expect(await screen.findAllByText('This entry is no longer available.')).not.toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('RedateDrawer — Arabic', () => {
  it('renders its labels in Arabic', async () => {
    localStorage.setItem(PORTAL_LANGUAGE_KEY, 'ar');
    stub();
    renderDrawer('payment');
    expect(await screen.findByRole('heading', { name: 'تغيير تاريخ الاستلام' })).toBeInTheDocument();
    expect(await screen.findByLabelText('تاريخ الاستلام')).toBeInTheDocument();
  });
});
