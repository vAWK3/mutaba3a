import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HostedLanguageProvider, PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../Toast';
import { ReceiptUploader } from '../ReceiptUploader';
import type { ExpenseReceipt } from '../../api/client';

// The portal opens in Arabic until a person chooses (MUT-209); these cases speak English, so choose it as a person would
beforeEach(() => localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en'));

const fetchMock = vi.fn();
const putMock = vi.fn();

function ok(body: unknown, status = 200) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function receipt(overrides: Partial<ExpenseReceipt> = {}): ExpenseReceipt {
  return {
    id: 'r1',
    expenseId: 'e1',
    filename: 'receipt.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1000,
    status: 'READY',
    uploadedByUserId: 'u1',
    createdAt: '',
    completedAt: '',
    ...overrides,
  } as ExpenseReceipt;
}

function renderUploader(receipts: ExpenseReceipt[] = []) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <HostedLanguageProvider>
        <ToastProvider>
          <ReceiptUploader profileId="org-1" expenseId="e1" receipts={receipts} />
        </ToastProvider>
      </HostedLanguageProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  putMock.mockReset();
  putMock.mockResolvedValue(new Response(null, { status: 200 }));
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method ?? 'GET').toUpperCase();
    if (url.startsWith('https://bucket.test')) return putMock(url, init);
    const path = new URL(url, 'http://portal.test').pathname;
    if (method === 'POST' && path === '/v1/expenses/e1/receipts') {
      return ok({ receipt: receipt({ status: 'PENDING_UPLOAD' }), upload: { url: 'https://bucket.test/upload', method: 'PUT', headers: { 'x-goog-foo': 'bar' }, expiresAt: '' } }, 201);
    }
    if (method === 'POST' && path === '/v1/expenses/e1/receipts/r1/complete') return ok(receipt());
    if (method === 'DELETE' && path === '/v1/expenses/e1/receipts/r1') return new Response(null, { status: 204 });
    if (method === 'GET' && path === '/v1/expenses/e1/receipts/r1/download') return ok({ url: 'https://bucket.test/dl' });
    return ok({ error: { code: 'NOT_FOUND', message: 'nf' } }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function pdfFile(name = 'receipt.pdf', size = 1000) {
  const file = new File([new Uint8Array(size)], name, { type: 'application/pdf' });
  return file;
}

describe('ReceiptUploader', () => {
  it('uploads a file: start, PUT to the signed URL with its headers, then complete', async () => {
    const user = userEvent.setup();
    renderUploader([]);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, pdfFile());

    await waitFor(() => expect(putMock).toHaveBeenCalled());
    const [, init] = putMock.mock.calls[0];
    expect(init.method).toBe('PUT');
    expect(init.headers).toEqual({ 'x-goog-foo': 'bar' });
    expect(init.credentials).toBe('omit');

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u, i]) => String(u).includes('/receipts/r1/complete') && (i as RequestInit).method === 'POST')).toBe(true),
    );
  });

  it('rejects a non-accepted file type before ever calling the API', async () => {
    // fireEvent.change, not user.upload: user-event itself enforces the
    // input's `accept` attribute (like a real file picker), so it can't
    // exercise this defense-in-depth path — drag-and-drop or a browser that
    // doesn't enforce `accept` still needs the client-side check caught here.
    renderUploader([]);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const textFile = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    Object.defineProperty(input, 'files', { value: [textFile] });
    fireEvent.change(input);

    expect(await screen.findByText('Receipts must be a PDF, JPEG or PNG file.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a file over 10 MB before ever calling the API', async () => {
    const user = userEvent.setup();
    renderUploader([]);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, pdfFile('big.pdf', 10 * 1024 * 1024 + 1));

    expect(await screen.findByText('Receipts can be at most 10 MB.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('disables "Add receipt" once 10 READY receipts exist', () => {
    const ten = Array.from({ length: 10 }, (_, i) => receipt({ id: `r${i}`, filename: `r${i}.pdf` }));
    renderUploader(ten);
    expect(screen.getByRole('button', { name: 'Add receipt' })).toBeDisabled();
    expect(screen.getByText('This expense already has 10 receipts, the most allowed.')).toBeInTheDocument();
  });

  it('does not count a still-uploading receipt against the 10-receipt cap', () => {
    const nine = Array.from({ length: 9 }, (_, i) => receipt({ id: `r${i}` }));
    renderUploader([...nine, receipt({ id: 'pending', status: 'PENDING_UPLOAD' })]);
    expect(screen.getByRole('button', { name: 'Add receipt' })).not.toBeDisabled();
  });

  it('downloads a receipt via the signed URL', async () => {
    const user = userEvent.setup();
    const openSpy = vi.fn();
    const { downloadNavigator } = await import('../../data/download');
    const original = downloadNavigator.open;
    downloadNavigator.open = openSpy;
    try {
      renderUploader([receipt()]);
      await user.click(screen.getByRole('button', { name: 'Download' }));
      await waitFor(() => expect(openSpy).toHaveBeenCalledWith('https://bucket.test/dl'));
    } finally {
      downloadNavigator.open = original;
    }
  });

  it('deletes a receipt', async () => {
    const user = userEvent.setup();
    renderUploader([receipt()]);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u, i]) => String(u).includes('/receipts/r1') && (i as RequestInit | undefined)?.method === 'DELETE')).toBe(true),
    );
  });
});
