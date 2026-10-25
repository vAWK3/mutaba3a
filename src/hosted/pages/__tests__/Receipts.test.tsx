import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ORG_A, emptyProfileRoutes, fail, locationOf, me, ok, profile, renderPortal, stubApi, type Handler } from '../../__tests__/harness';
import type { ExpenseReceipt, ReceiptListItem } from '../../api/client';
import { PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';

/** MUT-260: Expenses › Receipts — the gallery, its counts, upload, the review page and approve. */

const R1 = 'b0000000-0000-4000-8000-000000000001';
const R2 = 'b0000000-0000-4000-8000-000000000002';
const R3 = 'b0000000-0000-4000-8000-000000000003';
const E1 = 'e0000000-0000-4000-8000-000000000001';
const GROCERIES = 'c0000000-0000-4000-8000-00000000000a';
const BASE = `/p/${ORG_A}/expenses/receipts`;
const STORAGE = 'https://storage.googleapis.com/qa-bucket';

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
});
afterEach(() => vi.unstubAllGlobals());

function receipt(id: string, over: Partial<ReceiptListItem> = {}): ReceiptListItem {
  return {
    id,
    expenseId: null,
    filename: `${id.slice(-1)}.jpg`,
    mimeType: 'image/jpeg',
    sizeBytes: 1000,
    status: 'READY',
    filingStatus: 'TO_REVIEW',
    receivedOn: '2026-10-24',
    suggested: null,
    approved: null,
    approvedAt: null,
    version: 1,
    uploadedByUserId: null,
    createdAt: '2026-10-24T09:00:00Z',
    completedAt: '2026-10-24T09:00:01Z',
    expense: null,
    ...over,
  };
}

const plain = (item: ReceiptListItem): ExpenseReceipt => {
  const copy: Partial<ReceiptListItem> = { ...item };
  delete copy.expense;
  return copy as ExpenseReceipt;
};

const categories = { items: [{ id: GROCERIES, name: 'Groceries', color: null, archived: false, version: 1, createdAt: '', updatedAt: '' }] };

function portal(path: string, world: { receipts?: ReceiptListItem[]; counts?: Handler; routes?: Record<string, Handler>; writable?: boolean } = {}) {
  const items = world.receipts ?? [];
  const routes: Record<string, Handler> = {
    'GET /v1/me': () => ok(me([profile({ access: { payments: 'read', expenses: 'read-write', capture: 'read-write' } })])),
    ...emptyProfileRoutes(),
    'GET /v1/expense-categories': () => ok(categories),
    'GET /v1/vendors': () => ok({ items: [] }),
    'GET /v1/receipts/counts': world.counts ?? (() => ok({ toReview: items.filter((r) => r.filingStatus === 'TO_REVIEW').length, filed: items.filter((r) => r.filingStatus === 'FILED').length })),
    'GET /v1/receipts': ({ url }) => {
      const status = url.searchParams.get('filingStatus');
      return ok({ items: status ? items.filter((r) => r.filingStatus === status) : items, nextCursor: null });
    },
    ...Object.fromEntries(items.map((r) => [`GET /v1/receipts/${r.id}`, () => ok(plain(r))])),
    ...Object.fromEntries(items.map((r) => [`GET /v1/receipts/${r.id}/download`, ({ url }: { url: URL }) => ok({ url: `${STORAGE}/${r.id}?d=${url.searchParams.get('disposition') ?? 'attachment'}`, expiresAt: '2099-01-01T00:00:00Z', filename: r.filename, mimeType: r.mimeType })])),
    ...world.routes,
  };
  const api = stubApi(routes);
  return { ...renderPortal(path), api };
}

describe('the Receipts tab (D1, D4)', () => {
  it('shows under Expenses with its To-review count when the library answers', async () => {
    portal(`/p/${ORG_A}/expenses/groups`, { receipts: [receipt(R1), receipt(R2)], routes: { 'GET /v1/expense-groups': () => ok({ items: [] }) } });
    const tabs = await screen.findByRole('navigation', { name: 'Expenses pages' });
    expect(await within(tabs).findByRole('link', { name: 'Receipts · 2 to review' })).toHaveAttribute('href', BASE);
  });

  it('is hidden when the library answers 404 (A11), and its page says it is not available', async () => {
    const { api } = portal(BASE, { counts: () => fail(404, 'NOT_FOUND') });
    expect(await screen.findByText("Receipts aren't available here")).toBeInTheDocument();
    const tabs = screen.getByRole('navigation', { name: 'Expenses pages' });
    expect(within(tabs).queryByRole('link', { name: /Receipts/ })).toBeNull();
    // Not retried
    expect(api.count('GET /v1/receipts/counts')).toBe(1);
    expect(api.count('GET /v1/receipts')).toBe(0);
  });

  it('a 503 hides it too', async () => {
    portal(BASE, { counts: () => fail(503, 'ATTACHMENTS_NOT_CONFIGURED') });
    expect(await screen.findByText("Receipts aren't available here")).toBeInTheDocument();
  });
});

describe('the gallery (AC1)', () => {
  it('lists To review by default, with counts on the filter, and sends filingStatus', async () => {
    const { api } = portal(BASE, { receipts: [receipt(R1), receipt(R2, { mimeType: 'application/pdf', filename: 'inv.pdf' }), receipt(R3, { filingStatus: 'FILED', expenseId: E1, expense: { vendor: 'Spinneys', title: null, amount: '212.00', currency: 'ILS', occurredOn: '2026-10-20', categoryId: null } })] });
    const grid = await screen.findByRole('list', { name: 'Receipts' });
    await waitFor(() => expect(within(grid).getAllByRole('listitem')).toHaveLength(2));
    expect(api.calls.find((c) => c.url.pathname === '/v1/receipts')?.url.searchParams.get('filingStatus')).toBe('TO_REVIEW');
    expect(screen.getByRole('tab', { name: /To review\s*2/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Filed\s*1/ })).toBeInTheDocument();
  });

  it('a PDF card shows a tile and fetches nothing; an image card loads its original (attachment)', async () => {
    const { api } = portal(BASE, { receipts: [receipt(R1), receipt(R2, { mimeType: 'application/pdf', filename: 'inv.pdf' })] });
    const pdfCard = await screen.findByRole('link', { name: 'Open inv.pdf' });
    expect(within(pdfCard).getByText('PDF')).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector(`[data-receipt-id="${R1}"] img`)).toHaveAttribute('src', `${STORAGE}/${R1}?d=attachment`));
    expect(api.count(`GET /v1/receipts/${R2}/download`)).toBe(0);
  });

  it('Filed shows the expense on each card; All sends no filter; the filter lives in the URL', async () => {
    const filed = receipt(R3, { filingStatus: 'FILED', expenseId: E1, expense: { vendor: 'Spinneys', title: null, amount: '212.00', currency: 'ILS', occurredOn: '2026-10-20', categoryId: null } });
    const { user, router, api } = portal(BASE, { receipts: [receipt(R1), filed] });
    await user.click(await screen.findByRole('tab', { name: /Filed/ }));
    expect(await screen.findByText('Spinneys')).toBeInTheDocument();
    expect(locationOf(router)).toContain('status=filed');
    await user.click(screen.getByRole('tab', { name: 'All' }));
    await waitFor(() => expect(api.calls.filter((c) => c.url.pathname === '/v1/receipts').some((c) => !c.url.searchParams.has('filingStatus'))).toBe(true));
  });
});

describe('upload (AC2, D9)', () => {
  it('starts, PUTs and completes each file, then the list and counts refresh', async () => {
    let listed = [receipt(R1)];
    const { user, api } = portal(BASE, {
      receipts: listed,
      routes: {
        'GET /v1/receipts': () => ok({ items: listed, nextCursor: null }),
        'POST /v1/receipts/uploads': ({ body }) => ok({ receipt: plain(receipt(R2, { status: 'PENDING_UPLOAD', filename: (body as { filename: string }).filename })), upload: { url: `${STORAGE}/upload/${R2}`, method: 'PUT', headers: { 'Content-Type': 'image/png' }, expiresAt: '2099-01-01T00:00:00Z' } }, 201),
        'PUT /qa-bucket/upload/b0000000-0000-4000-8000-000000000002': () => new Response(null, { status: 200 }),
        [`POST /v1/receipts/${R2}/complete`]: () => {
          listed = [receipt(R2, { filename: 'new.png', mimeType: 'image/png' }), ...listed];
          return ok(plain(listed[0]));
        },
      },
    });
    await screen.findByRole('list', { name: 'Receipts' });
    const file = new File(['png'], 'new.png', { type: 'image/png' });
    await user.upload(screen.getByTestId('receipts-upload-input'), file);
    expect(await screen.findByRole('link', { name: 'Open new.png' })).toBeInTheDocument();
    const start = api.calls.find((c) => c.method === 'POST' && c.url.pathname === '/v1/receipts/uploads');
    expect(start?.body).toEqual({ filename: 'new.png', mimeType: 'image/png', sizeBytes: 3 });
    expect(start?.headers.get('Idempotency-Key')).toBeTruthy();
    expect(await screen.findByText('1 receipt added to To review')).toBeInTheDocument();
  });

  it('refuses a wrong type before any request', async () => {
    const { api } = portal(BASE, { receipts: [receipt(R1)] });
    await screen.findByRole('list', { name: 'Receipts' });
    // The picker's accept would filter it; a drop or an "All files" pick still can't get past the rules.
    fireEvent.change(screen.getByTestId('receipts-upload-input'), { target: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] } });
    expect(await screen.findByText('notes.txt: receipts must be a PDF, JPEG or PNG file.')).toBeInTheDocument();
    expect(api.count('POST /v1/receipts/uploads')).toBe(0);
  });

  it('says why a 429 refused it: the pending cap, or the per-minute budget (A4)', async () => {
    const { user } = portal(BASE, {
      receipts: [receipt(R1)],
      routes: { 'POST /v1/receipts/uploads': () => fail(429, 'RATE_LIMITED', { reason: 'TOO_MANY_PENDING_UPLOADS' }) },
    });
    await screen.findByRole('list', { name: 'Receipts' });
    await user.upload(screen.getByTestId('receipts-upload-input'), new File(['png'], 'a.png', { type: 'image/png' }));
    expect(await screen.findByText('Too many unfinished uploads. Finish or remove them, then try again.')).toBeInTheDocument();
  });

  it('a read-only profile has no Upload (D11)', async () => {
    portal(BASE, {
      receipts: [receipt(R1)],
      routes: { 'GET /v1/me': () => ok({ ...me([profile({ billing: { state: 'READ_ONLY', source: 'TRIAL', until: '2099-01-01T00:00:00Z' } as never })]), billingStanding: 'read-only' }) },
    });
    await screen.findByRole('list', { name: 'Receipts' });
    expect(screen.queryByRole('button', { name: 'Upload receipt' })).toBeNull();
  });
});

const suggested = {
  readerVersion: 'phone-1',
  date: { value: '2026-10-24', source: 'qr' as const, confidence: 0.95 },
  totalMinor: { value: '8420', source: 'qr' as const, confidence: 0.95 },
  currency: { value: 'ILS', source: 'qr' as const, confidence: 0.95 },
  vendorName: { value: 'Shufersal', source: 'ocr' as const, confidence: 0.3 },
};

describe('the review page (AC3, D7, D8)', () => {
  it('prefills from the suggestion and marks each filled field', async () => {
    portal(`${BASE}/${R1}`, { receipts: [receipt(R1, { suggested })] });
    const amount = await screen.findByLabelText(/Amount/);
    expect(amount).toHaveValue('84.20');
    expect(amount).toHaveAttribute('data-suggested', 'true');
    expect(screen.getByLabelText(/Currency/)).toHaveValue('ILS');
    expect(screen.getByLabelText(/^Date/)).toHaveValue('2026-10-24');
    expect(screen.getByLabelText('Vendor')).toHaveValue('Shufersal');
    expect(document.querySelector('[data-hint-for="amount"]')).toHaveTextContent('From the receipt');
    // Low confidence still fills; only the hint says so
    expect(document.querySelector('[data-hint-for="vendor"]')).toHaveTextContent('From the receipt — check it');
    expect(document.querySelector('[data-hint-for="category"]')).toBeNull();
  });

  it('an unsupported currency leaves the default currency and an empty amount, with what the receipt said (A13, A14)', async () => {
    portal(`${BASE}/${R1}`, { receipts: [receipt(R1, { suggested: { readerVersion: 'p', totalMinor: { value: '12345', source: 'qr', confidence: 1 }, currency: { value: 'BHD', source: 'qr', confidence: 1 } } })] });
    const amount = await screen.findByLabelText(/Amount/);
    expect(amount).toHaveValue('');
    expect(screen.getByLabelText(/Currency/)).toHaveValue('USD');
    expect(document.querySelector('[data-hint-for="amount"]')).toHaveTextContent('The receipt says BHD 12.345');
  });

  it('shows the original inline: an image, and Open full size on the inline URL', async () => {
    const { api } = portal(`${BASE}/${R1}`, { receipts: [receipt(R1)] });
    const img = await screen.findByRole('img', { name: 'Receipt 1.jpg' });
    expect(img).toHaveAttribute('src', `${STORAGE}/${R1}?d=attachment`);
    await waitFor(() => expect(screen.getByRole('link', { name: 'Open full size' })).toHaveAttribute('href', `${STORAGE}/${R1}?d=inline`));
    expect(screen.getByRole('link', { name: 'Open full size' })).toHaveAttribute('target', '_blank');
    expect(api.calls.some((c) => c.url.pathname === `/v1/receipts/${R1}/download` && c.url.searchParams.get('disposition') === 'inline')).toBe(true);
  });

  it('a PDF shows in an iframe', async () => {
    portal(`${BASE}/${R1}`, { receipts: [receipt(R1, { mimeType: 'application/pdf', filename: 'inv.pdf' })] });
    expect(await screen.findByTitle('Receipt inv.pdf (PDF)')).toHaveAttribute('src', `${STORAGE}/${R1}?d=inline`);
  });

  it('Approve files it without the suggestion (A1), keyed, then opens the next receipt', async () => {
    let approved: { body: unknown; key: string | null } | null = null;
    const { user, router } = portal(`${BASE}/${R1}`, {
      receipts: [receipt(R1, { suggested }), receipt(R2)],
      routes: {
        [`POST /v1/receipts/${R1}/approve`]: ({ body, headers }) => {
          approved = { body, key: headers.get('Idempotency-Key') };
          return ok({ expense: { id: E1, occurredOn: '2026-10-24', amount: '84.20', currency: 'ILS', title: null, vendor: 'Shufersal', categoryId: GROCERIES, customerId: null, projectId: null, notes: null, createdByUserId: null, version: 1, createdAt: '', updatedAt: '' }, receipt: plain(receipt(R1, { filingStatus: 'FILED', expenseId: E1 })) }, 201);
        },
      },
    });
    await screen.findByLabelText(/Amount/);
    await user.selectOptions(screen.getByLabelText(/Category/), GROCERIES);
    await user.click(screen.getByRole('button', { name: 'Approve and file' }));
    await waitFor(() => expect(locationOf(router)).toBe(`${BASE}/${R2}`));
    expect(approved!.body).toEqual({ occurredOn: '2026-10-24', amount: '84.20', currency: 'ILS', vendor: 'Shufersal', categoryId: GROCERIES });
    expect(approved!.body).not.toHaveProperty('suggested');
    expect(approved!.key).toBeTruthy();
    expect(await screen.findByText('Filed')).toBeInTheDocument();
  });

  it('the last receipt goes back to the gallery', async () => {
    const { user, router } = portal(`${BASE}/${R1}`, {
      receipts: [receipt(R1, { suggested })],
      routes: { [`POST /v1/receipts/${R1}/approve`]: () => ok({ expense: { id: E1 }, receipt: plain(receipt(R1)) }, 201) },
    });
    await screen.findByLabelText(/Amount/);
    await user.selectOptions(screen.getByLabelText(/Category/), GROCERIES);
    await user.click(screen.getByRole('button', { name: 'Approve and file' }));
    await waitFor(() => expect(locationOf(router)).toBe(BASE));
  });

  it('409 RECEIPT_ALREADY_FILED offers the expense and refreshes into the Filed view (A10); a new key next time (A2)', async () => {
    let filed = false;
    const keys: (string | null)[] = [];
    const { user } = portal(`${BASE}/${R1}`, {
      receipts: [receipt(R1, { suggested })],
      routes: {
        [`GET /v1/receipts/${R1}`]: () => ok(plain(filed ? receipt(R1, { filingStatus: 'FILED', expenseId: E1 }) : receipt(R1, { suggested }))),
        [`POST /v1/receipts/${R1}/approve`]: ({ headers }) => {
          keys.push(headers.get('Idempotency-Key'));
          filed = true;
          return fail(409, 'CONFLICT', { reason: 'RECEIPT_ALREADY_FILED', expenseId: E1 });
        },
        [`GET /v1/expenses/${E1}`]: () => ok({ id: E1, occurredOn: '2026-10-20', amount: '99.00', currency: 'ILS', title: null, vendor: 'Bezeq', categoryId: null, customerId: null, projectId: null, notes: null, createdByUserId: null, version: 1, createdAt: '', updatedAt: '', receipts: [] }),
      },
    });
    await screen.findByLabelText(/Amount/);
    await user.selectOptions(screen.getByLabelText(/Category/), GROCERIES);
    await user.click(screen.getByRole('button', { name: 'Approve and file' }));
    expect(await screen.findByText('This receipt is already filed.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open expense' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Filed receipt' })).toBeInTheDocument();
    expect(await screen.findByText('Bezeq')).toBeInTheDocument();
    expect(keys).toHaveLength(1);
  });

  it('422 ATTACHMENT_NOT_READY shows a banner', async () => {
    const { user } = portal(`${BASE}/${R1}`, {
      receipts: [receipt(R1, { suggested })],
      routes: { [`POST /v1/receipts/${R1}/approve`]: () => fail(422, 'VALIDATION_FAILED', { reason: 'ATTACHMENT_NOT_READY' }) },
    });
    await screen.findByLabelText(/Amount/);
    await user.selectOptions(screen.getByLabelText(/Category/), GROCERIES);
    await user.click(screen.getByRole('button', { name: 'Approve and file' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("This receipt hasn't finished uploading");
  });

  it('a network failure keeps the key, so the retry replays (A2)', async () => {
    const keys: (string | null)[] = [];
    let first = true;
    const { user, router } = portal(`${BASE}/${R1}`, {
      receipts: [receipt(R1, { suggested })],
      routes: {
        [`POST /v1/receipts/${R1}/approve`]: ({ headers }) => {
          keys.push(headers.get('Idempotency-Key'));
          if (first) {
            first = false;
            throw new TypeError('Failed to fetch');
          }
          return ok({ expense: { id: E1 }, receipt: plain(receipt(R1)) }, 201);
        },
      },
    });
    await screen.findByLabelText(/Amount/);
    await user.selectOptions(screen.getByLabelText(/Category/), GROCERIES);
    await user.click(screen.getByRole('button', { name: 'Approve and file' }));
    await waitFor(() => expect(keys).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: 'Approve and file' }));
    await waitFor(() => expect(locationOf(router)).toBe(BASE));
    expect(keys[1]).toBe(keys[0]);
  });

  it('a filed receipt opened by link shows its expense from the expense itself (A3)', async () => {
    portal(`${BASE}/${R3}`, {
      receipts: [receipt(R3, { filingStatus: 'FILED', expenseId: E1 })],
      routes: { [`GET /v1/expenses/${E1}`]: () => ok({ id: E1, occurredOn: '2026-10-20', amount: '99.00', currency: 'ILS', title: null, vendor: 'Bezeq', categoryId: null, customerId: null, projectId: null, notes: null, createdByUserId: null, version: 1, createdAt: '', updatedAt: '', receipts: [] }) },
    });
    expect(await screen.findByText('Bezeq')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open expense' })).toHaveAttribute('href', `/p/${ORG_A}/expenses?expense=${E1}`);
    expect(screen.queryByRole('button', { name: 'Approve and file' })).toBeNull();
  });

  it('a receipt that is not there says so', async () => {
    portal(`${BASE}/${R2}`, { receipts: [receipt(R1)] });
    expect(await screen.findByText("This receipt isn't here")).toBeInTheDocument();
  });
});
