import type { ComponentProps } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HostedLanguageProvider, PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';
import { profile, type StubRequest } from '../../__tests__/harness';
import { ToastProvider } from '../Toast';
import { IncomeCaptureDrawer } from '../IncomeCaptureDrawer';

const { trackPortal } = vi.hoisted(() => ({ trackPortal: vi.fn(async () => {}) }));
vi.mock('../../analytics/portalAnalytics', () => ({ trackPortal }));

const C1 = 'c1111111-1111-4111-8111-111111111111';
const PERSONAL = profile({
  writerOfRecord: null,
  isPersonalDefault: true,
  owned: true,
  type: 'PERSONAL',
  access: { payments: 'read-write', capture: 'read-write', expenses: 'read-write' },
  income: { received: true, owed: true, customer: 'optional' },
  timezone: 'Asia/Jerusalem',
  defaultCurrency: 'ILS',
});
const BUSINESS = profile({
  writerOfRecord: null,
  isPersonalDefault: false,
  owned: true,
  type: 'BUSINESS',
  access: { payments: 'read-write', capture: 'read-write', expenses: 'read-write' },
  income: { received: true, owed: true, customer: 'optional' },
  timezone: 'Asia/Jerusalem',
  defaultCurrency: 'ILS',
});

function scaleOf(el: Element): number {
  const match = /scale\(([-\d.]+)\)/.exec((el as HTMLElement).style.transform);
  return match ? Number(match[1]) : 0;
}

const strip = (text: string | null) => (text ?? '').replace(/[⁦-⁩]/g, '');

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
function fail(status: number, code: string, details?: unknown) {
  return json({ error: { code, message: code, details: details ?? null, requestId: 'req-1' } }, status);
}

type Responder = (request: StubRequest) => Response | Promise<Response>;

interface StubMatter {
  id: string;
  name: string;
  customerId: string;
  currency: string;
}

function stub(onIncome: Responder, matters: StubMatter[] = [], projectPosts: StubRequest[] = [], projectGate?: Promise<void>) {
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
      if (method === 'GET' && url.pathname === '/v1/projects') {
        const customerId = url.searchParams.get('customerId');
        return json({ items: matters.filter((m) => !customerId || m.customerId === customerId), nextCursor: null });
      }
      if (method === 'POST' && url.pathname === '/v1/projects') {
        projectPosts.push(request);
        if (projectGate) await projectGate;
        const made = { id: 'm-new', ...(request.body as object) } as StubMatter;
        matters.push(made);
        return json(made, 201);
      }
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

describe('IncomeCaptureDrawer counts a confirmed save (MUT-155, ADR-090)', () => {
  beforeEach(() => trackPortal.mockClear());

  it('sends income_recorded with only the currency and whether it was paid, after the server confirms', async () => {
    stub((r) => created(r.body));
    const { user, onClose } = renderDrawer({ initialKind: 'received' });
    await user.type(screen.getByLabelText('Amount'), '500');
    await user.click(screen.getByRole('button', { name: 'Save income' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(trackPortal).toHaveBeenCalledExactlyOnceWith('income_recorded', { currency: 'ILS', paid: true });
  });

  it('marks owed income as not paid', async () => {
    stub((r) => created(r.body));
    const { user, onClose } = renderDrawer({ defaultCustomerId: C1 });
    await user.type(screen.getByLabelText('Amount'), '100');
    await user.click(screen.getByRole('button', { name: 'Save income' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(trackPortal).toHaveBeenCalledExactlyOnceWith('income_recorded', { currency: 'ILS', paid: false });
  });

  it('counts nothing when the save fails', async () => {
    stub(() => fail(422, 'VALIDATION_FAILED', { reason: 'DATE_INVALID', field: 'occurredOn' }));
    const { user } = renderDrawer({ defaultCustomerId: C1 });
    await user.type(screen.getByLabelText('Amount'), '100');
    await user.click(screen.getByRole('button', { name: 'Save income' }));
    expect(await screen.findByText("The date can't be later than today")).toBeInTheDocument();
    expect(trackPortal).not.toHaveBeenCalled();
  });
});

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
    expect(strip(screen.getByTestId('toast-live').textContent)).toBe('Saved · ₪1,200.00 owed by Nour Studio');
  });

  it('plays the playful (overshooting) icon preset on a PERSONAL profile save (MUT-338)', async () => {
    const posts = stub((r) => created(r.body));
    const { user } = renderDrawer({ defaultCustomerId: C1 });
    await user.type(screen.getByLabelText('Amount'), '100');
    await user.click(screen.getByRole('button', { name: 'Save income' }));
    await waitFor(() => expect(posts).toHaveLength(1));

    const parts = Array.from(screen.getByTestId('toast-live').querySelectorAll('[data-part]'));
    expect(parts.length).toBeGreaterThan(0);
    await waitFor(() => parts.forEach((part) => expect(scaleOf(part)).toBeGreaterThan(1)), { timeout: 2000 });
    await waitFor(() => parts.forEach((part) => expect(scaleOf(part)).toBe(1)), { timeout: 2000 });
  });

  it('plays the playful icon preset on a BUSINESS profile without firm features (MUT-338, comment 12272)', async () => {
    const posts = stub((r) => created(r.body));
    const { user } = renderDrawer({ profile: BUSINESS, defaultCustomerId: C1 });
    await user.type(screen.getByLabelText('Amount'), '100');
    await user.click(screen.getByRole('button', { name: 'Save income' }));
    await waitFor(() => expect(posts).toHaveLength(1));

    const parts = Array.from(screen.getByTestId('toast-live').querySelectorAll('[data-part]'));
    expect(parts.length).toBeGreaterThan(0);
    await waitFor(() => parts.forEach((part) => expect(scaleOf(part)).toBeGreaterThan(1)), { timeout: 2000 });
  });

  it('plays the restrained icon preset once firm features are on (MUT-338)', async () => {
    const posts = stub((r) => created(r.body));
    const { user } = renderDrawer({ profile: { ...BUSINESS, firm: true, role: 'OWNER' }, defaultCustomerId: C1 });
    await user.type(screen.getByLabelText('Amount'), '100');
    await user.click(screen.getByRole('button', { name: 'Save income' }));
    await waitFor(() => expect(posts).toHaveLength(1));

    const parts = Array.from(screen.getByTestId('toast-live').querySelectorAll('[data-part]'));
    expect(parts.length).toBeGreaterThan(0);
    await waitFor(() => parts.forEach((part) => expect(scaleOf(part)).toBe(1)), { timeout: 2000 });
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
    expect(strip(screen.getByTestId('toast-live').textContent)).toBe('Saved · ₪500.00 received');
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

  it('reopens More details for an error there even after the person collapsed it (review #2)', async () => {
    const posts = stub((r) => created(r.body));
    const { user } = renderDrawer({ defaultCustomerId: C1 });
    await user.type(screen.getByLabelText('Amount'), '100');
    await user.click(screen.getByRole('button', { name: /More details/ }));
    await user.clear(screen.getByLabelText('Date'));
    await user.click(screen.getByRole('button', { name: /Fewer details/ }));
    expect(screen.queryByLabelText('Date')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save income' }));
    expect(await screen.findByText('Choose a date')).toBeInTheDocument();
    expect(screen.getByLabelText('Date')).toBeInTheDocument();
    expect(posts).toHaveLength(0);
  });

  it('caps a Received date at today in the profile\'s zone, not the browser\'s (R3)', async () => {
    // 22:30Z on the 13th is already the 14th in Jerusalem.
    vi.setSystemTime(new Date('2026-10-13T22:30:00Z'));
    stub((r) => created(r.body));
    const { user } = renderDrawer({ defaultCustomerId: C1, initialKind: 'received' });
    await user.click(screen.getByRole('button', { name: /More details/ }));
    expect(screen.getByLabelText('Date')).toHaveValue('2026-10-14');
    expect(screen.getByLabelText('Date')).toHaveAttribute('max', '2026-10-14');
  });

  it('refuses a Received dated after today at the date, without a request (MUT-392)', async () => {
    vi.setSystemTime(new Date('2026-10-14T09:00:00Z'));
    const posts = stub((r) => created(r.body));
    const { user, onClose } = renderDrawer({ defaultCustomerId: C1, initialKind: 'received' });
    await user.type(screen.getByLabelText('Amount'), '750');
    await user.click(screen.getByRole('button', { name: /More details/ }));
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-10-15' } });
    await user.click(screen.getByRole('button', { name: 'Save income' }));
    expect(await screen.findByText("The date can't be later than today")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(posts).toHaveLength(0);
  });

  it('lets an Owed date go up to ten years ahead of the profile\'s today (MUT-392)', async () => {
    vi.setSystemTime(new Date('2026-10-13T22:30:00Z'));
    stub((r) => created(r.body));
    const { user } = renderDrawer({ defaultCustomerId: C1 });
    await user.click(screen.getByRole('button', { name: /More details/ }));
    expect(screen.getByLabelText('Date')).toHaveAttribute('max', '2036-10-21');
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
    // aria-disabled, not disabled: a focused button that becomes disabled is blurred in Chromium (review #3).
    await waitFor(() => expect(screen.getByRole('button', { name: 'Saving...' })).toHaveAttribute('aria-disabled', 'true'));
    expect(screen.getByRole('button', { name: 'Saving...' })).not.toBeDisabled();
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

describe('IncomeCaptureDrawer matters (MUT-318)', () => {
  const RETAINER = { id: 'm1', name: 'Retainer', customerId: C1, currency: 'ILS' };

  it('adds a matter for the chosen client, in the drawer currency, and saves Owed on it', async () => {
    const projectPosts: StubRequest[] = [];
    const posts = stub((r) => created(r.body), [], projectPosts);
    const { user, onClose } = renderDrawer({ defaultCustomerId: C1 });
    await user.type(screen.getByLabelText('Amount'), '900');
    await user.click(screen.getByRole('button', { name: /More details/ }));
    await user.selectOptions(screen.getByLabelText('Currency'), 'USD');
    await user.type(screen.getByLabelText('Matter (optional)'), 'Menu design');
    await user.click(await screen.findByRole('option', { name: /Add matter.*Menu design/ }));
    await waitFor(() => expect(projectPosts).toHaveLength(1));
    expect(projectPosts[0].body).toEqual({ customerId: C1, name: 'Menu design', currency: 'USD' });

    await user.click(screen.getByRole('button', { name: 'Save income' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(posts[0].body).toMatchObject({ kind: 'owed', customerId: C1, projectId: 'm-new', currency: 'USD' });
  });

  it('holds Save while the matter is being added, so the income never saves without it (review D1)', async () => {
    let land!: () => void;
    const gate = new Promise<void>((resolve) => (land = resolve));
    const projectPosts: StubRequest[] = [];
    const posts = stub((r) => created(r.body), [], projectPosts, gate);
    const { user, onClose } = renderDrawer({ defaultCustomerId: C1 });
    await user.type(screen.getByLabelText('Amount'), '900');
    await user.click(screen.getByRole('button', { name: /More details/ }));
    await user.type(screen.getByLabelText('Matter (optional)'), 'Menu design');
    await user.click(await screen.findByRole('option', { name: /Add matter.*Menu design/ }));
    await waitFor(() => expect(projectPosts).toHaveLength(1));

    const save = screen.getByRole('button', { name: 'Save income' });
    expect(save).toHaveAttribute('aria-disabled', 'true');
    await user.click(save);
    expect(posts).toHaveLength(0);

    land();
    await waitFor(() => expect(save).not.toHaveAttribute('aria-disabled'));
    await user.click(save);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toMatchObject({ projectId: 'm-new' });
  });

  it('Enter held in the matter field while it is being added still saves once it lands (A1 with the Save hold)', async () => {
    let land!: () => void;
    const gate = new Promise<void>((resolve) => (land = resolve));
    const posts = stub((r) => created(r.body), [], [], gate);
    const { user, onClose } = renderDrawer({ defaultCustomerId: C1 });
    await user.type(screen.getByLabelText('Amount'), '900');
    await user.click(screen.getByRole('button', { name: /More details/ }));
    const matter = screen.getByLabelText('Matter (optional)');
    await user.type(matter, 'Menu design');
    await screen.findByRole('option', { name: /Add matter.*Menu design/ });
    await user.keyboard('{Enter}');
    await waitFor(() => expect(matter).toHaveAttribute('readonly'));
    await user.keyboard('{Enter}');
    expect(posts).toHaveLength(0);

    land();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toMatchObject({ projectId: 'm-new' });
  });

  it('picking a matter with no client fills the client, so Owed saves (2A)', async () => {
    const posts = stub((r) => created(r.body), [RETAINER]);
    const { user, onClose } = renderDrawer();
    await user.type(screen.getByLabelText('Amount'), '500');
    await user.click(screen.getByRole('button', { name: /More details/ }));
    await user.click(screen.getByLabelText('Matter (optional)'));
    await user.click(await screen.findByRole('option', { name: /Retainer/ }));

    await waitFor(() => expect(screen.getByLabelText('Client')).toHaveValue('Nour Studio'));
    await user.click(screen.getByRole('button', { name: 'Save income' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(posts[0].body).toMatchObject({ customerId: C1, projectId: 'm1' });
  });

  it('clearing the chosen client clears its matter, as the local app does (2A, 3A)', async () => {
    stub((r) => created(r.body), [RETAINER]);
    const { user } = renderDrawer({ defaultCustomerId: C1 });
    await user.click(screen.getByRole('button', { name: /More details/ }));
    const matter = screen.getByLabelText('Matter (optional)');
    await user.click(matter);
    await user.click(await screen.findByRole('option', { name: 'Retainer' }));
    expect(matter).toHaveValue('Retainer');

    await user.clear(screen.getByLabelText('Client'));
    await waitFor(() => expect(matter).toHaveValue(''));
  });

  it('says under the matter that a Malafat capture must be in the matter\'s currency (review D2)', async () => {
    const posts = stub(() => fail(422, 'VALIDATION_FAILED', { reason: 'CURRENCY_MISMATCH', field: 'currency', projectCurrency: 'USD' }), [RETAINER]);
    const malafat = profile({ ...PERSONAL, writerOfRecord: 'MALAFAT', owned: false });
    const { user, onClose } = renderDrawer({ profile: { ...malafat, owned: true }, defaultCustomerId: C1, initialKind: 'received' });
    await user.type(screen.getByLabelText('Amount'), '500');
    await user.click(screen.getByRole('button', { name: /More details/ }));
    await user.click(screen.getByLabelText('Matter (optional)'));
    await user.click(await screen.findByRole('option', { name: 'Retainer' }));
    await user.click(screen.getByRole('button', { name: 'Save income' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    await waitFor(() =>
      expect([...document.querySelectorAll('.form-error')].map((p) => strip(p.textContent))).toContain(
        'This matter is in USD. Record it in USD, or choose another matter.',
      ),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it('offers no Add matter on a Malafat-fed profile', async () => {
    stub((r) => created(r.body), [{ id: 'm1', name: 'Menu design', customerId: C1, currency: 'ILS' }]);
    const malafat = profile({ ...PERSONAL, writerOfRecord: 'MALAFAT', owned: false });
    const { user } = renderDrawer({ profile: { ...malafat, owned: true }, defaultCustomerId: C1, initialKind: 'received' });
    await user.click(screen.getByRole('button', { name: /More details/ }));
    await user.type(screen.getByLabelText('Matter (optional)'), 'Menu');
    // The list is open (so an Add row would show), and a name the client has no matter for still gets none
    expect(await screen.findByRole('option', { name: 'Menu design' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Matter (optional)'), ' review');
    await waitFor(() => expect(screen.queryByRole('option', { name: 'Menu design' })).toBeNull());
    expect(screen.queryByRole('option', { name: /Add matter/ })).toBeNull();
    expect(screen.queryByText('Choose a client first to add a matter.')).toBeNull();
  });
});

