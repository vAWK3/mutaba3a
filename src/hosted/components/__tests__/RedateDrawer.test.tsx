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

const owed = (o: Partial<Receivable> = {}): Receivable => ({ ...receivable(R, C1, PJ, '500.00', 'DUE', '2026-11-15'), origin: 'ADJUSTMENT', gross: '500.00', postingDate: '2026-10-08', capturedByUserId: ME, version: 3, ...o });
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
  /** MUT-453: reverse and credits. */
  post?: (request: StubRequest) => Response | Promise<Response>;
  credits?: () => Response;
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
      if (method === 'GET' && url.pathname === `/v1/receivables/${R}/credits`) return (routes.credits ?? (() => json({ receivable: owed(), credits: [] })))();
      if (method === 'PATCH') return (routes.patch ?? (() => json({})))(request);
      if (method === 'POST') return (routes.post ?? (() => json({})))(request);
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
  it('shows the entry read-only, its date editable up to ten years after the profile’s today, and says the due date stays', async () => {
    stub();
    renderDrawer('owed');
    const input = await dateInput();
    expect(input.value).toBe('2026-10-08');
    expect(input.max).toBe('2036-10-21'); // MUT-392: an Owed may move ahead, up to today + 3660 days
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

  it('moves an Owed into the future, and says the due date moves once the new date passes it (MUT-392 D3)', async () => {
    const api = stub({ patch: () => json({ id: R, kind: 'owed', occurredOn: '2026-12-01', version: 4 }) });
    const { user, onClose } = renderDrawer('owed');
    await setDate(user, '2026-11-10');
    expect(screen.getByText(/Due Nov 15, 2026 — stays as it is/)).toBeInTheDocument();
    await setDate(user, '2026-12-01');
    expect(screen.getByText(/Due Jan 15, 2027 — moves with the new date/)).toBeInTheDocument();
    await user.click(save());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.patches()[0]!.body).toEqual({ occurredOn: '2026-12-01' });
  });

  it('moves a part-paid Owed into the future too: nothing is refused once money moves (MUT-392 D2)', async () => {
    const api = stub({ getOwed: () => json(owed({ paid: '100.00', status: 'PARTIALLY_PAID' })), patch: () => json({ id: R, kind: 'owed', occurredOn: '2026-11-10', version: 4 }) });
    const { user, onClose } = renderDrawer('owed');
    expect((await dateInput()).max).not.toBe('2026-10-14');
    await setDate(user, '2026-11-10');
    await user.click(save());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.patches()[0]!.body).toEqual({ occurredOn: '2026-11-10' });
  });

  it('refuses an Owed more than ten years ahead before asking the server (MUT-392)', async () => {
    const api = stub();
    const { user, onClose } = renderDrawer('owed');
    await setDate(user, '2036-10-22');
    await user.click(save());
    expect(await screen.findByText(/The date can.t be more than ten years ahead/)).toBeInTheDocument();
    expect(api.patches()).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();
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
  it('caps a payment date at the profile’s today and refuses a later one before asking the server (MUT-392: the money has moved)', async () => {
    const api = stub();
    const { user, onClose } = renderDrawer('payment');
    expect((await dateInput()).max).toBe('2026-10-14');
    await setDate(user, '2026-10-15');
    await user.click(save());
    expect(await screen.findByText(/The date can.t be later than today/)).toBeInTheDocument();
    expect(api.patches()).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();
  });

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

describe('RedateDrawer — an Owed entry a partner captured (MUT-373)', () => {
  it('opens read-only with no Save: only who captured it may re-date it, but either partner may correct it (MUT-453 D2)', async () => {
    stub({ getOwed: () => json(owed({ capturedByUserId: 'u-partner' })) });
    renderDrawer('owed');
    expect(await screen.findByRole('button', { name: 'Reduce amount owed' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel amount owed' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });
});

describe('RedateDrawer — a payment it can no longer change', () => {
  it('shows "no longer available" for a payment its person undid, with no Save', async () => {
    stub({ getPayment: () => json(mine({ status: 'REVERSED', reversalReason: 'capture_undo' })) });
    renderDrawer('payment');
    expect(await screen.findByText('This entry is no longer available.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('opens someone else’s payment read-only, offering Reverse payment but no Save (MUT-453 D2)', async () => {
    stub({ getPayment: () => json(mine({ capturedBy: { userId: 'u-other', displayName: 'Rami' } })) });
    renderDrawer('payment');
    expect(await screen.findByRole('button', { name: 'Reverse payment' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
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

describe('RedateDrawer — corrections (MUT-453)', () => {
  const posts = (calls: StubRequest[]) => calls.filter((c) => c.method === 'POST');
  const reasonBox = () => screen.getByLabelText('Reason');

  it('reverses a payment with a reason; the reason is required first, and the key is the attempt’s', async () => {
    const { calls } = stub({ post: () => json(mine({ status: 'REVERSED', reversalReason: 'Applied to the wrong job' })) });
    const { user, onClose } = renderDrawer('payment');
    await user.click(await screen.findByRole('button', { name: 'Reverse payment' }));
    await user.click(screen.getByRole('button', { name: 'Reverse payment' }));
    expect(await screen.findByText('Say why, so the history makes sense later.')).toBeInTheDocument();
    expect(posts(calls)).toHaveLength(0);

    await user.type(reasonBox(), '  Applied to the wrong job ');
    await user.click(screen.getByRole('button', { name: 'Reverse payment' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const [sent] = posts(calls);
    expect(sent!.url.pathname).toBe(`/v1/payments/${P}/reverse`);
    expect(sent!.body).toEqual({ reason: 'Applied to the wrong job' });
    expect(sent!.headers.get('idempotency-key')).toBeTruthy();
    expect(await screen.findByText(/Payment reversed/)).toBeInTheDocument();
  });

  it('reduces an Owed by part of what is left, showing what stays owed; more than is left is refused before sending', async () => {
    const { calls } = stub({ post: () => json({ receivable: owed({ outstanding: '300.00', credited: '200.00' }), credit: {} }, 201) });
    const { user, onClose } = renderDrawer('owed');
    await user.click(await screen.findByRole('button', { name: 'Reduce amount owed' }));
    const amount = screen.getByLabelText('Reduce by (ILS)');
    await user.type(amount, '600');
    await user.type(reasonBox(), 'Agreed a lower fee');
    await user.click(screen.getByRole('button', { name: 'Reduce' }));
    expect(posts(calls)).toHaveLength(0);

    await user.clear(amount);
    await user.type(amount, '200');
    expect(screen.getByText(/left after this/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reduce' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(posts(calls)[0]).toMatchObject({ body: { amount: '200.00', reason: 'Agreed a lower fee' } });
    expect(posts(calls)[0]!.url.pathname).toBe(`/v1/receivables/${R}/credits`);
  });

  it('Cancel credits everything left', async () => {
    const { calls } = stub({ post: () => json({ receivable: owed({ outstanding: '0.00', credited: '500.00', status: 'PAID' }), credit: {} }, 201) });
    const { user, onClose } = renderDrawer('owed');
    await user.click(await screen.findByRole('button', { name: 'Cancel amount owed' }));
    await user.type(reasonBox(), 'Client dropped the job');
    await user.click(screen.getByRole('button', { name: 'Cancel amount owed' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(posts(calls)[0]).toMatchObject({ body: { amount: '500.00', reason: 'Client dropped the job' } });
  });

  it('when another tab paid meanwhile, shows the new maximum under the amount and stays open', async () => {
    stub({ post: () => fail(422, 'VALIDATION_FAILED', { reason: 'CREDIT_EXCEEDS_OUTSTANDING', outstanding: '100.00' }) });
    const { user, onClose } = renderDrawer('owed');
    await user.click(await screen.findByRole('button', { name: 'Reduce amount owed' }));
    await user.type(screen.getByLabelText('Reduce by (ILS)'), '200');
    await user.type(reasonBox(), 'Typo');
    await user.click(screen.getByRole('button', { name: 'Reduce' }));
    expect(await screen.findByText(/more than what’s left now/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Back returns to the entry without sending anything', async () => {
    const { calls } = stub();
    const { user } = renderDrawer('payment');
    await user.click(await screen.findByRole('button', { name: 'Reverse payment' }));
    await user.click(screen.getAllByRole('button', { name: 'Back' })[0]!);
    expect(await screen.findByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(posts(calls)).toHaveLength(0);
  });

  it('shows a reversed payment’s reason and an Owed’s credits, with no correction offered on what is closed', async () => {
    stub({ getPayment: () => json(mine({ status: 'REVERSED', reversedAt: '2026-10-12T08:00:00Z', reversalReason: 'Applied to the wrong job' })) });
    const payment = renderDrawer('payment');
    expect(await screen.findByText(/Reversed on .* · Applied to the wrong job/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reverse payment' })).toBeNull();
    payment.unmount();
    vi.unstubAllGlobals();

    const credited = owed({ status: 'PAID', outstanding: '0.00', credited: '500.00' });
    stub({ getOwed: () => json(credited), credits: () => json({ receivable: credited, credits: [{ id: 'k1', receivableId: R, amount: '500.00', net: '500.00', vat: '0.00', reason: 'Client dropped the job', effectiveDate: '2026-10-12', createdAt: '2026-10-12T08:00:00Z' }] }) });
    renderDrawer('owed');
    expect(await screen.findByText(/Client dropped the job/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reduce amount owed' })).toBeNull();
  });

  it('offers no correction on a Malafat-fed profile’s rows (it opens nothing there at all)', async () => {
    stub();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const malafat = profile({ writerOfRecord: 'MALAFAT', isPersonalDefault: false, owned: false, access: { payments: 'read', capture: 'read-write' }, income: { received: true, owed: false, customer: 'linked-required' } });
    render(
      <QueryClientProvider client={queryClient}>
        <HostedLanguageProvider>
          <ToastProvider>
            <RedateDrawer kind="payment" profile={malafat} id={P} userId={ME} onClose={vi.fn()} onOpenPayment={vi.fn()} onSeePayments={vi.fn()} />
          </ToastProvider>
        </HostedLanguageProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('This entry is no longer available.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reverse payment' })).toBeNull();
  });
});

describe('RedateDrawer — corrections, review fixes (MUT-453 qa-reconcile)', () => {
  const posts = (calls: StubRequest[]) => calls.filter((c) => c.method === 'POST');

  it('a retry after a 409 conflict sends a new Idempotency-Key, so it is not the stored refusal again', async () => {
    let n = 0;
    const { calls } = stub({ post: () => (n++ === 0 ? fail(409, 'CONFLICT', { reason: 'VERSION_MISMATCH' }) : json(mine({ status: 'REVERSED', reversalReason: 'Typo' }))) });
    const { user, onClose } = renderDrawer('payment');
    await user.click(await screen.findByRole('button', { name: 'Reverse payment' }));
    await user.type(screen.getByLabelText('Reason'), 'Typo');
    await user.click(screen.getByRole('button', { name: 'Reverse payment' }));
    expect(await screen.findByText(/changed while you were saving/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reverse payment' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const [first, second] = posts(calls);
    expect(first!.headers.get('idempotency-key')).not.toBe(second!.headers.get('idempotency-key'));
  });

  it('Cancel that left something owed (it grew meanwhile) says what is still owed, not "cancelled"', async () => {
    stub({ post: () => json({ receivable: owed({ outstanding: '200.00', credited: '500.00', status: 'DUE' }), credit: {} }, 201) });
    const { user, onClose } = renderDrawer('owed');
    await user.click(await screen.findByRole('button', { name: 'Cancel amount owed' }));
    await user.type(screen.getByLabelText('Reason'), 'Client dropped the job');
    await user.click(screen.getByRole('button', { name: 'Cancel amount owed' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(await screen.findByText(/200\.00.* is still owed/)).toBeInTheDocument();
    expect(screen.queryByText('Amount owed cancelled')).toBeNull();
  });

  it('Cancel refused because less is left now shows the new figure, not silence', async () => {
    stub({ post: () => fail(422, 'VALIDATION_FAILED', { reason: 'CREDIT_EXCEEDS_OUTSTANDING', outstanding: '100.00' }) });
    const { user, onClose } = renderDrawer('owed');
    await user.click(await screen.findByRole('button', { name: 'Cancel amount owed' }));
    await user.type(screen.getByLabelText('Reason'), 'Client dropped the job');
    await user.click(screen.getByRole('button', { name: 'Cancel amount owed' }));
    expect(await screen.findByText(/more than what’s left now \(.*100\.00.*\)/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
