import type { ComponentProps } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HostedLanguageProvider, PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';
import { profile, type StubRequest } from '../../__tests__/harness';
import { ToastProvider } from '../Toast';
import { IncomeCaptureDrawer } from '../IncomeCaptureDrawer';

const C1 = 'c1111111-1111-4111-8111-111111111111';
const PERSONAL = profile({
  writerOfRecord: null,
  isPersonalDefault: true,
  access: { payments: 'read-write', capture: 'read-write', expenses: 'read-write' },
  income: { received: true, owed: true, customer: 'optional' },
  timezone: 'Asia/Jerusalem',
  defaultCurrency: 'ILS',
});

const strip = (text: string | null) => (text ?? '').replace(/[⁦-⁩]/g, '');

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
function fail(status: number, code: string, details?: unknown) {
  return json({ error: { code, message: code, details: details ?? null, requestId: 'req-1' } }, status);
}

type Responder = (request: StubRequest) => Response | Promise<Response>;

function stub(onIncome: Responder) {
  const posts: StubRequest[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input), 'http://portal.test');
      const method = (init.method ?? 'GET').toUpperCase();
      const request = { method, url, headers: new Headers(init.headers), body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined };
      if (method === 'GET' && url.pathname === '/v1/customers') {
        return json({ items: [{ id: C1, name: 'Nour Studio', status: 'ACTIVE' }], nextCursor: null });
      }
      if (method === 'GET' && url.pathname === '/v1/projects') return json({ items: [], nextCursor: null });
      if (method === 'POST' && url.pathname === '/v1/income') {
        posts.push(request);
        return onIncome(request);
      }
      return fail(404, 'NOT_FOUND');
    }),
  );
  return posts;
}

function renderDrawer(props: Partial<ComponentProps<typeof IncomeCaptureDrawer>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <HostedLanguageProvider>
        <ToastProvider>
          <IncomeCaptureDrawer profile={PERSONAL} initialKind="owed" onClose={onClose} {...props} />
        </ToastProvider>
      </HostedLanguageProvider>
    </QueryClientProvider>,
  );
  return { onClose, user: userEvent.setup() };
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

const created = (body: unknown) => json({ id: 'i1', ...(body as object), status: 'OPEN', title: null, notes: null, dueDate: null, projectId: null }, 201);

describe('IncomeCaptureDrawer (MUT-133)', () => {
  it('records Owed for a prefilled client with the profile header, an Idempotency-Key and a canonical amount, then says so politely', async () => {
    const posts = stub((r) => created(r.body));
    const { onClose, user } = renderDrawer({ defaultCustomerId: C1 });
    expect(screen.getByRole('heading', { name: 'New income' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Amount'), '1,200');
    await user.type(screen.getByLabelText('What was it for?'), 'Logo redesign');
    await user.click(screen.getByRole('button', { name: 'Save income' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(posts).toHaveLength(1);
    expect(posts[0].headers.get('X-Mutaba3a-Profile')).toBe(PERSONAL.id);
    expect(posts[0].headers.get('Idempotency-Key')).toBeTruthy();
    expect(posts[0].body).toEqual({ kind: 'owed', amount: '1200.00', currency: 'ILS', occurredOn: '2026-10-14', customerId: C1, title: 'Logo redesign' });
    expect(strip(screen.getByRole('status').textContent)).toBe('Saved · ₪1,200.00 owed by Nour Studio');
  });

  it('needs a client for Owed before anything is sent', async () => {
    const posts = stub((r) => created(r.body));
    const { user } = renderDrawer();
    await user.type(screen.getByLabelText('Amount'), '500');
    await user.click(screen.getByRole('button', { name: 'Save income' }));
    expect(await screen.findByText('Owed needs a client')).toBeInTheDocument();
    expect(posts).toHaveLength(0);
  });

  it('sends Received with its method and no client, and never the Owed-only fields', async () => {
    const posts = stub((r) => created(r.body));
    const { user, onClose } = renderDrawer({ initialKind: 'received' });
    expect(screen.queryByLabelText('What was it for?')).toBeNull();
    expect(screen.getByLabelText('Client (optional)')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Amount'), '₪500');
    await user.click(screen.getByRole('button', { name: /More details/ }));
    await user.click(screen.getByRole('radio', { name: 'Bank transfer' }));
    await user.click(screen.getByRole('button', { name: 'Save income' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(posts[0].body).toEqual({ kind: 'received', amount: '500.00', currency: 'ILS', occurredOn: '2026-10-14', method: 'BANK' });
    expect(strip(screen.getByRole('status').textContent)).toBe('Saved · ₪500.00 received');
  });

  it('summarises the hidden defaults, and opens More details when the server faults a hidden field (1A)', async () => {
    stub(() => fail(422, 'VALIDATION_FAILED', { reason: 'DATE_INVALID', field: 'occurredOn' }));
    const { user } = renderDrawer({ defaultCustomerId: C1 });
    expect(screen.getByTestId('income-defaults')).toHaveTextContent('ILS · today · due the 15th of next month');
    expect(screen.queryByLabelText('Date')).toBeNull();
    await user.type(screen.getByLabelText('Amount'), '100');
    await user.click(screen.getByRole('button', { name: 'Save income' }));
    expect(await screen.findByText("The date can't be later than today")).toBeInTheDocument();
    expect(screen.getByLabelText('Date')).toBeInTheDocument();
  });

  it('caps the date at today in the profile\'s zone, not the browser\'s (R3)', async () => {
    // 22:30Z on the 13th is already the 14th in Jerusalem.
    vi.setSystemTime(new Date('2026-10-13T22:30:00Z'));
    stub((r) => created(r.body));
    const { user } = renderDrawer({ defaultCustomerId: C1 });
    await user.click(screen.getByRole('button', { name: /More details/ }));
    expect(screen.getByLabelText('Date')).toHaveValue('2026-10-14');
    expect(screen.getByLabelText('Date')).toHaveAttribute('max', '2026-10-14');
  });

  it('resends the same Idempotency-Key when Save is retried after a network failure, and a new one after an edit', async () => {
    let attempt = 0;
    const posts = stub(() => {
      attempt += 1;
      if (attempt <= 2) return Promise.reject(new TypeError('network down'));
      return json({ id: 'i1' }, 201);
    });
    const { user } = renderDrawer({ defaultCustomerId: C1 });
    await user.type(screen.getByLabelText('Amount'), '100');
    await user.click(screen.getByRole('button', { name: 'Save income' }));
    await screen.findByText("Couldn't reach the server. Try again.");
    await user.click(screen.getByRole('button', { name: 'Save income' }));
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1].headers.get('Idempotency-Key')).toBe(posts[0].headers.get('Idempotency-Key'));

    await user.type(screen.getByLabelText('Amount'), '0');
    await user.click(screen.getByRole('button', { name: 'Save income' }));
    await waitFor(() => expect(posts).toHaveLength(3));
    expect(posts[2].headers.get('Idempotency-Key')).not.toBe(posts[0].headers.get('Idempotency-Key'));
  });

  it('sends one POST however fast Save is pressed twice', async () => {
    let release: (r: Response) => void = () => {};
    const posts = stub(() => new Promise<Response>((resolve) => (release = resolve)));
    const { user } = renderDrawer({ defaultCustomerId: C1 });
    await user.type(screen.getByLabelText('Amount'), '100');
    const save = screen.getByRole('button', { name: 'Save income' });
    await user.click(save);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled());
    await user.click(screen.getByRole('button', { name: 'Saving...' }));
    expect(posts).toHaveLength(1);
    release(json({ id: 'i1' }, 201));
  });

  it('offers only the kinds the profile allows, falling back when the URL asks for another', () => {
    stub((r) => created(r.body));
    renderDrawer({ profile: { ...PERSONAL, income: { received: true, owed: false, customer: 'optional' } }, initialKind: 'owed' });
    expect(screen.queryByRole('radiogroup', { name: 'Kind' })).toBeNull();
    expect(screen.queryByLabelText('What was it for?')).toBeNull();
    expect(screen.getByLabelText('Client (optional)')).toBeInTheDocument();
  });

  it('flags an amount typed in another currency', async () => {
    const posts = stub((r) => created(r.body));
    const { user } = renderDrawer({ defaultCustomerId: C1 });
    await user.type(screen.getByLabelText('Amount'), '$5');
    await user.click(screen.getByRole('button', { name: 'Save income' }));
    expect(await screen.findByText('That amount is in USD; this entry is in ILS')).toBeInTheDocument();
    expect(posts).toHaveLength(0);
  });

  it('reads in Arabic with a left-to-right amount field', () => {
    localStorage.setItem(PORTAL_LANGUAGE_KEY, 'ar');
    stub((r) => created(r.body));
    renderDrawer();
    expect(screen.getByRole('heading', { name: 'دخل جديد' })).toBeInTheDocument();
    expect(screen.getByLabelText('المبلغ')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByRole('radiogroup', { name: 'النوع' })).toBeInTheDocument();
  });
});
