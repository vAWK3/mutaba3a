import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HostedLanguageProvider, PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../Toast';
import { ReceiptUploader, type ReceiptUploaderProps } from '../ReceiptUploader';
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

function renderUploader(receipts: ExpenseReceipt[] = [], extra: Partial<ReceiptUploaderProps> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const tree = (list: ExpenseReceipt[]) => (
    <QueryClientProvider client={queryClient}>
      <HostedLanguageProvider>
        <ToastProvider>
          <ReceiptUploader profileId="org-1" expenseId="e1" receipts={list} {...extra} />
        </ToastProvider>
      </HostedLanguageProvider>
    </QueryClientProvider>
  );
  const { rerender } = render(tree(receipts));
  return { rerenderWith: (list: ExpenseReceipt[]) => rerender(tree(list)) };
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
    if (method === 'GET' && path === '/v1/expenses/e1/receipts/r1/download') return ok({ url: 'https://bucket.test/dl', filename: 'receipt.pdf' });
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
      await waitFor(() => expect(openSpy).toHaveBeenCalledWith('https://bucket.test/dl', 'receipt.pdf'));
    } finally {
      downloadNavigator.open = original;
    }
  });

  it('stores the file on this device when the receipt was signed with a local-blob URL (MUT-287)', async () => {
    const user = userEvent.setup();
    const { localFiles } = await import('../../data/download');
    const original = localFiles.put;
    const putLocal = vi.fn(async () => undefined);
    localFiles.put = putLocal;
    const remote = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const path = new URL(String(input), 'http://portal.test').pathname;
      if ((init.method ?? 'GET').toUpperCase() === 'POST' && path === '/v1/expenses/e1/receipts') {
        return ok({ receipt: receipt({ status: 'PENDING_UPLOAD' }), upload: { url: 'local-blob:org/o1/expense-receipts/r1', method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, expiresAt: '' } }, 201);
      }
      return remote(input, init);
    });
    try {
      renderUploader([]);
      const file = pdfFile();
      await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, file);

      await waitFor(() => expect(putLocal).toHaveBeenCalledWith('local-blob:org/o1/expense-receipts/r1', file));
      expect(putMock).not.toHaveBeenCalled();
      expect(fetchMock.mock.calls.some(([u]) => String(u).startsWith('local-blob:'))).toBe(false);
      await waitFor(() =>
        expect(fetchMock.mock.calls.some(([u, i]) => String(u).includes('/receipts/r1/complete') && (i as RequestInit).method === 'POST')).toBe(true),
      );
    } finally {
      localFiles.put = original;
    }
  });

  it('says the upload failed when this device refuses to store the file', async () => {
    const user = userEvent.setup();
    const { localFiles } = await import('../../data/download');
    const original = localFiles.put;
    localFiles.put = vi.fn(async () => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    const remote = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const path = new URL(String(input), 'http://portal.test').pathname;
      if ((init.method ?? 'GET').toUpperCase() === 'POST' && path === '/v1/expenses/e1/receipts') {
        return ok({ receipt: receipt({ status: 'PENDING_UPLOAD' }), upload: { url: 'local-blob:k', method: 'PUT', headers: {}, expiresAt: '' } }, 201);
      }
      return remote(input, init);
    });
    try {
      renderUploader([]);
      await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, pdfFile());

      expect(await screen.findByText("Couldn't upload the receipt. Try again.")).toBeInTheDocument();
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/complete'))).toBe(false);
    } finally {
      localFiles.put = original;
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

  describe('incoming files from a new expense (MUT-491 R3)', () => {
    it('uploads them one at a time on mount and reports none failed', async () => {
      const onIncomingSettled = vi.fn();
      renderUploader([], { incoming: [pdfFile('a.pdf'), pdfFile('b.pdf')], onIncomingSettled });
      expect(screen.getAllByText('Uploading…').length).toBeGreaterThan(0);
      await waitFor(() => expect(onIncomingSettled).toHaveBeenCalledWith([]));
      const starts = fetchMock.mock.calls.filter(([u, i]) => String(u).endsWith('/v1/expenses/e1/receipts') && (i as RequestInit).method === 'POST');
      expect(starts.map(([, i]) => JSON.parse(String((i as RequestInit).body)).filename)).toEqual(['a.pdf', 'b.pdf']);
      expect(onIncomingSettled).toHaveBeenCalledTimes(1);
    });

    it('keeps a failed file in the list with Upload again and Remove, and reports it by name', async () => {
      const user = userEvent.setup();
      putMock.mockResolvedValueOnce(new Response(null, { status: 403 }));
      const onIncomingSettled = vi.fn();
      renderUploader([], { incoming: [pdfFile('taxi.pdf')], onIncomingSettled });
      await waitFor(() => expect(onIncomingSettled).toHaveBeenCalledWith(['taxi.pdf']));
      expect(screen.getByText("Couldn't upload the receipt. Try again.")).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      // The failed PUT's PENDING row was deleted (R1)
      expect(fetchMock.mock.calls.some(([u, i]) => String(u).endsWith('/receipts/r1') && (i as RequestInit).method === 'DELETE')).toBe(true);

      await user.click(screen.getByRole('button', { name: 'Upload again' }));
      await waitFor(() => expect(screen.queryByText("Couldn't upload the receipt. Try again.")).not.toBeInTheDocument());
      expect(onIncomingSettled).toHaveBeenCalledTimes(1);
    });

    it('a complete whose answer was lost shows READY once the refetch lists it, not failed', async () => {
      const remote = fetchMock.getMockImplementation()!;
      fetchMock.mockImplementation(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        if (String(input).includes('/receipts/r1/complete')) return ok({ error: { code: 'UNKNOWN', message: 'bad gateway' } }, 502);
        return remote(input, init);
      });
      const { rerenderWith } = renderUploader([], { incoming: [pdfFile('taxi.pdf')] });
      expect(await screen.findByText("Couldn't upload the receipt. Try again.")).toBeInTheDocument();
      rerenderWith([receipt({ id: 'r1', filename: 'taxi.pdf' })]);
      expect(screen.queryByText("Couldn't upload the receipt. Try again.")).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
    });

    it('Remove drops a failed file', async () => {
      const user = userEvent.setup();
      putMock.mockResolvedValueOnce(new Response(null, { status: 403 }));
      renderUploader([], { incoming: [pdfFile('taxi.pdf')] });
      await user.click(await screen.findByRole('button', { name: 'Remove' }));
      expect(screen.queryByText('taxi.pdf')).not.toBeInTheDocument();
    });

    it('takes several files in one pick in edit mode too', async () => {
      renderUploader([]);
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      expect(input.multiple).toBe(true);
    });
  });
});

