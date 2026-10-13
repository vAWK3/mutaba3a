import type { ComponentProps } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HostedLanguageProvider } from '../../i18n/HostedLanguageProvider';
import { ToastProvider } from '../Toast';
import { ConversionDrawer } from '../ConversionDrawer';

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
