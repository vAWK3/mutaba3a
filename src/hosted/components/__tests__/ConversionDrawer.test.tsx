import type { ComponentProps } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HostedLanguageProvider } from '../../i18n/HostedLanguageProvider';
import { ToastProvider } from '../Toast';
import { ConversionDrawer } from '../ConversionDrawer';
import { PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';

// The portal opens in Arabic until a person chooses (MUT-209); these cases speak English, so choose it as a person would
beforeEach(() => localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en'));

const fetchMock = vi.fn();

function ok(body: unknown, status = 200) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function fail(status: number, code: string, details?: unknown) {
  return ok({ error: { code, message: code, details: details ?? null, requestId: 'req-1' } }, status);
}

function renderDrawer(props: Partial<ComponentProps<typeof ConversionDrawer>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <HostedLanguageProvider>
        <ToastProvider>
          <ConversionDrawer profileId="org-1" onClose={onClose} {...props} />
        </ToastProvider>
      </HostedLanguageProvider>
    </QueryClientProvider>,
  );
  return { onClose };
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('ConversionDrawer (hosted)', () => {
  it('renders the create form with both amount inputs in decimal-text mode', async () => {
    renderDrawer();
    await screen.findByText('Log conversion');
    const [fromAmount, toAmount] = (await screen.findAllByPlaceholderText('0.00')) as HTMLInputElement[];
    expect(fromAmount.type).toBe('text');
    expect(fromAmount.getAttribute('dir')).toBe('ltr');
    expect(fromAmount.getAttribute('inputmode')).toBe('decimal');
    expect(toAmount.type).toBe('text');
  });

  it('creates a conversion with an Idempotency-Key and closes on success', async () => {
    const user = userEvent.setup();
    let createCall: { body: unknown; headers: Headers } | null = null;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input), 'http://portal.test');
      const method = (init.method ?? 'GET').toUpperCase();
      if (method === 'POST' && url.pathname === '/v1/conversions') {
        createCall = { body: JSON.parse(String(init.body)), headers: new Headers(init.headers) };
        return ok({ id: 'c1' }, 201);
      }
      return fail(404, 'NOT_FOUND');
    });

    const { onClose } = renderDrawer();
    const [fromAmount, toAmount] = await screen.findAllByPlaceholderText('0.00');
    await user.type(fromAmount, '100.00');
    await user.type(toAmount, '365.00');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(createCall).not.toBeNull();
    expect(createCall!.headers.get('idempotency-key')).toBeTruthy();
    expect(createCall!.body).toMatchObject({ amount: '100.00', currency: 'USD', toAmount: '365.00', toCurrency: 'ILS' });
  });

  it('shows the implied rate once both amounts are typed', async () => {
    const user = userEvent.setup();
    renderDrawer();
    const [fromAmount, toAmount] = await screen.findAllByPlaceholderText('0.00');
    await user.type(fromAmount, '100');
    await user.type(toAmount, '91.20');
    expect(await screen.findByText('Implied rate: 1 USD = 0.9120 ILS')).toBeInTheDocument();
  });

  it('blocks a same-currency conversion client-side, no request sent', async () => {
    const user = userEvent.setup();
    renderDrawer();
    const [fromAmount, toAmount] = await screen.findAllByPlaceholderText('0.00');
    await user.type(fromAmount, '100.00');
    await user.type(toAmount, '100.00');
    // Both currency selects default to USD/ILS; force the same currency on both sides.
    const selects = screen.getAllByRole('combobox');
    await user.selectOptions(selects[1]!, 'USD');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Choose a different currency to convert to')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps a server AMOUNT_INVALID on the destination leg onto the toAmount field', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input), 'http://portal.test');
      if ((init.method ?? 'GET').toUpperCase() === 'POST' && url.pathname === '/v1/conversions') {
        return fail(422, 'VALIDATION_FAILED', { reason: 'AMOUNT_INVALID', field: 'toAmount' });
      }
      return fail(404, 'NOT_FOUND');
    });

    const { onClose } = renderDrawer();
    const [fromAmount, toAmount] = await screen.findAllByPlaceholderText('0.00');
    await user.type(fromAmount, '100.00');
    await user.type(toAmount, '365.00');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Enter a valid amount')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('resends the same Idempotency-Key when Save is retried after a network failure (MUT-133 D5)', async () => {
    const user = userEvent.setup();
    const keys: (string | null)[] = [];
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input), 'http://portal.test');
      if ((init.method ?? 'GET').toUpperCase() === 'POST' && url.pathname === '/v1/conversions') {
        keys.push(new Headers(init.headers).get('idempotency-key'));
        if (keys.length === 1) throw new TypeError('network down');
        return ok({ id: 'c1' }, 201);
      }
      return fail(404, 'NOT_FOUND');
    });
    const { onClose } = renderDrawer();
    const [fromAmount, toAmount] = await screen.findAllByPlaceholderText('0.00');
    await user.type(fromAmount, '100.00');
    await user.type(toAmount, '365.00');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(keys).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(keys[1]).toBe(keys[0]);
  });

  it('defaults the date to today in the profile\'s zone when the list passes it (MUT-133 D5)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-13T22:30:00Z'));
    try {
      renderDrawer({ timezone: 'Asia/Jerusalem' });
      expect(await screen.findByDisplayValue('2026-10-14')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('ConversionDrawer (hosted) edit mode (MUT-194)', () => {
  const ID = 'c0000000-0000-4000-8000-000000000001';

  function conversion(over: Record<string, unknown> = {}) {
    return {
      id: ID,
      occurredOn: '2026-10-05',
      amount: '100.00',
      currency: 'USD',
      toAmount: '365.00',
      toCurrency: 'ILS',
      notes: 'Transferred to ILS account',
      createdByUserId: 'u1',
      version: 3,
      createdAt: '2026-10-05T08:00:00.000Z',
      updatedAt: '2026-10-05T08:00:00.000Z',
      ...over,
    };
  }

  /** A tiny server: GET returns the current row; PATCH and DELETE are recorded and answered by `onPatch`/`onDelete`. */
  function server(opts: { current?: () => Record<string, unknown>; onPatch?: (body: Record<string, unknown>, ifMatch: string | null) => Response; onDelete?: () => Response } = {}) {
    const calls: { method: string; path: string; body?: Record<string, unknown>; ifMatch?: string | null }[] = [];
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input), 'http://portal.test');
      const method = (init.method ?? 'GET').toUpperCase();
      const headers = new Headers(init.headers);
      const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
      calls.push({ method, path: url.pathname, body, ifMatch: headers.get('if-match') });
      if (url.pathname !== `/v1/conversions/${ID}`) return fail(404, 'NOT_FOUND');
      if (method === 'GET') return ok(opts.current ? opts.current() : conversion());
      if (method === 'PATCH') return opts.onPatch ? opts.onPatch(body ?? {}, headers.get('if-match')) : ok(conversion({ ...body, version: 4 }));
      if (method === 'DELETE') return opts.onDelete ? opts.onDelete() : new Response(null, { status: 204 });
      return fail(404, 'NOT_FOUND');
    });
    return calls;
  }

  const fields = () => ({
    fromAmount: screen.getByLabelText('From amount') as HTMLInputElement,
    fromCurrency: screen.getByLabelText('From currency') as HTMLSelectElement,
    toAmount: screen.getByLabelText('To amount') as HTMLInputElement,
    toCurrency: screen.getByLabelText('To currency') as HTMLSelectElement,
    date: screen.getByLabelText('Date') as HTMLInputElement,
    notes: screen.getByLabelText('Notes') as HTMLTextAreaElement,
  });

  afterEach(() => localStorage.clear());

  it('prefills both legs, the date and the notes from the server, under an edit title', async () => {
    server();
    renderDrawer({ mode: 'edit', conversionId: ID });
    expect(await screen.findByText('Edit conversion')).toBeInTheDocument();
    await waitFor(() => expect(fields().fromAmount.value).toBe('100.00'));
    const f = fields();
    expect(f.fromCurrency.value).toBe('USD');
    expect(f.toAmount.value).toBe('365.00');
    expect(f.toCurrency.value).toBe('ILS');
    expect(f.date.value).toBe('2026-10-05');
    expect(f.notes.value).toBe('Transferred to ILS account');
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('hides Save and Delete while the conversion loads', async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    renderDrawer({ mode: 'edit', conversionId: ID });
    expect(await screen.findByText('Loading...')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('says a conversion deleted elsewhere no longer exists, with a Close that closes the drawer', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async () => fail(404, 'NOT_FOUND'));
    const { onClose } = renderDrawer({ mode: 'edit', conversionId: ID });
    expect(await screen.findByText('This conversion no longer exists')).toBeInTheDocument();
    expect(screen.queryByText("Can't reach Mutaba3a right now")).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    const closes = screen.getAllByRole('button', { name: 'Close' });
    await user.click(closes[closes.length - 1]!);
    expect(onClose).toHaveBeenCalled();
  });

  it('says the same in Arabic', async () => {
    localStorage.setItem(PORTAL_LANGUAGE_KEY, 'ar');
    fetchMock.mockImplementation(async () => fail(404, 'NOT_FOUND'));
    renderDrawer({ mode: 'edit', conversionId: ID });
    expect(await screen.findByText('لم يعد هذا التحويل موجوداً')).toBeInTheDocument();
  });

  it('shows an error, and no form, when the conversion cannot be loaded', async () => {
    fetchMock.mockImplementation(async () => fail(500, 'INTERNAL'));
    renderDrawer({ mode: 'edit', conversionId: ID });
    // Any other load error keeps the portal's existing error state (QueryView's Unreachable card), with a retry.
    expect(await screen.findByText("Can't reach Mutaba3a right now")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('saves with a PATCH carrying both legs, the date and the notes at the loaded version, then closes', async () => {
    const user = userEvent.setup();
    const calls = server();
    const { onClose } = renderDrawer({ mode: 'edit', conversionId: ID });
    await waitFor(() => expect(fields().toAmount.value).toBe('365.00'));
    await user.clear(fields().toAmount);
    await user.type(fields().toAmount, '366.50');
    await user.clear(fields().notes);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.ifMatch).toBe('3');
    expect(patch.body).toEqual({ occurredOn: '2026-10-05', amount: '100.00', currency: 'USD', toAmount: '366.50', toCurrency: 'ILS', notes: null });
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('on 409 shows the conflict message, stays open, refetches and refills with the latest values, and the next Save uses the new version (D6)', async () => {
    const user = userEvent.setup();
    let latest = conversion();
    let patches = 0;
    const calls = server({
      current: () => latest,
      onPatch: (_body, ifMatch) => {
        patches += 1;
        if (ifMatch === '3') return fail(409, 'CONFLICT', { reason: 'VERSION_MISMATCH', currentVersion: 4 });
        return ok(conversion({ ..._body, version: 5 }));
      },
    });
    const { onClose } = renderDrawer({ mode: 'edit', conversionId: ID });
    await waitFor(() => expect(fields().toAmount.value).toBe('365.00'));
    // Someone else changes it meanwhile.
    latest = conversion({ toAmount: '370.00', notes: 'changed on the phone', version: 4 });
    await user.clear(fields().toAmount);
    await user.type(fields().toAmount, '366.50');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('This conversion changed elsewhere — showing the latest version')).toBeInTheDocument();
    await waitFor(() => expect(fields().toAmount.value).toBe('370.00'));
    expect(fields().notes.value).toBe('changed on the phone');
    expect(onClose).not.toHaveBeenCalled();
    expect(calls.filter((c) => c.method === 'GET').length).toBeGreaterThanOrEqual(2);

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(patches).toBe(2);
    expect(calls.filter((c) => c.method === 'PATCH').map((c) => c.ifMatch)).toEqual(['3', '4']);
  });

  it('Delete confirms naming both legs and that it can\'t be undone, then DELETEs and reports the id (D7)', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal('confirm', confirmSpy);
    const calls = server();
    const onDeleted = vi.fn();
    const { onClose } = renderDrawer({ mode: 'edit', conversionId: ID, onDeleted });
    await waitFor(() => expect(fields().fromAmount.value).toBe('100.00'));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(ID));
    expect(confirmSpy).toHaveBeenCalledWith("Delete this conversion ($100.00 → ₪365.00)? This can't be undone.");
    expect(calls.some((c) => c.method === 'DELETE' && c.path === `/v1/conversions/${ID}`)).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a cancelled confirm sends nothing and keeps the drawer open', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('confirm', vi.fn(() => false));
    const calls = server();
    const onDeleted = vi.fn();
    const { onClose } = renderDrawer({ mode: 'edit', conversionId: ID, onDeleted });
    await waitFor(() => expect(fields().fromAmount.value).toBe('100.00'));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    expect(onDeleted).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('edits and saves a JOD conversion with 3 decimals (D7)', async () => {
    const user = userEvent.setup();
    const calls = server({ current: () => conversion({ amount: '100.000', currency: 'JOD', toAmount: '141.00', toCurrency: 'USD', version: 1 }) });
    const { onClose } = renderDrawer({ mode: 'edit', conversionId: ID });
    await waitFor(() => expect(fields().fromAmount.value).toBe('100.000'));
    expect(fields().fromCurrency.value).toBe('JOD');
    await user.clear(fields().fromAmount);
    await user.type(fields().fromAmount, '99.125');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.ifMatch).toBe('1');
    expect(patch.body).toMatchObject({ amount: '99.125', currency: 'JOD', toAmount: '141.00', toCurrency: 'USD' });
  });

  it('edits and saves an AED-to-OMR conversion, each leg at its own precision (MUT-281)', async () => {
    const user = userEvent.setup();
    const calls = server({ current: () => conversion({ amount: '100.00', currency: 'AED', toAmount: '10.456', toCurrency: 'OMR', version: 1 }) });
    const { onClose } = renderDrawer({ mode: 'edit', conversionId: ID });
    await waitFor(() => expect(fields().fromAmount.value).toBe('100.00'));
    expect(fields().fromCurrency.value).toBe('AED');
    expect(fields().toCurrency.value).toBe('OMR');
    await user.clear(fields().fromAmount);
    await user.type(fields().fromAmount, '99.50');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.body).toMatchObject({ amount: '99.50', currency: 'AED', toAmount: '10.456', toCurrency: 'OMR' });
  });

  it('shows the Arabic edit title and delete confirm (AC9)', async () => {
    const user = userEvent.setup();
    localStorage.setItem(PORTAL_LANGUAGE_KEY, 'ar');
    const confirmSpy = vi.fn(() => false);
    vi.stubGlobal('confirm', confirmSpy);
    server();
    renderDrawer({ mode: 'edit', conversionId: ID });
    expect(await screen.findByText('تعديل التحويل')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'حذف' }));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    const message = (confirmSpy.mock.calls[0] as unknown as [string])[0];
    expect(message).toContain('حذف هذا التحويل');
    expect(message).toContain('100.00');
    expect(message).toContain('365.00');
  });
});
