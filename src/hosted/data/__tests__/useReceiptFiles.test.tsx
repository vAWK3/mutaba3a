import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect, type ReactNode } from 'react';
import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fail, ok, stubApi } from '../../__tests__/harness';
import { HostedLanguageProvider, PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';
import { ToastProvider } from '../../components/Toast';
import { useReceiptFiles } from '../useReceiptFiles';
import { receiptsKey, useReceipts } from '../receiptQueries';

/**
 * MUT-657: the gallery's upload, lifted into one hook so home's drop zone and the gallery share its rules (type, 10 MB,
 * a name the server takes), its 429 messages and its "added to To review" line; `onLanded` says how many landed.
 */

const P = '11111111-1111-4111-8111-111111111111';
const R = 'b0000000-0000-4000-8000-000000000002';
const STORAGE = 'https://storage.googleapis.com/qa-bucket';

beforeEach(() => localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en'));
afterEach(() => vi.unstubAllGlobals());

const started = () => ok({ receipt: { id: R, status: 'PENDING_UPLOAD' }, upload: { url: `${STORAGE}/upload/${R}`, method: 'PUT', headers: {}, expiresAt: '2099-01-01T00:00:00Z' } }, 201);
const landing = {
  'POST /v1/receipts/uploads': started,
  [`PUT /qa-bucket/upload/${R}`]: () => new Response(null, { status: 200 }),
  [`POST /v1/receipts/${R}/complete`]: () => ok({ id: R, status: 'READY' }),
};

/** The probe's `onFiles`, handed out after each render. */
const sink: { send: (files: File[]) => Promise<void> } = { send: async () => {} };
const send = (files: File[]) => sink.send(files);

function Probe({ onLanded }: { onLanded: (count: number) => void }) {
  const files = useReceiptFiles(P, { onLanded });
  useEffect(() => {
    sink.send = files.onFiles;
  });
  return <span data-testid="uploading">{String(files.uploading)}</span>;
}

function mount(onLanded = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrap = (children: ReactNode) => (
    <QueryClientProvider client={queryClient}>
      <HostedLanguageProvider>
        <ToastProvider>{children}</ToastProvider>
      </HostedLanguageProvider>
    </QueryClientProvider>
  );
  render(wrap(<Probe onLanded={onLanded} />));
  return { onLanded, queryClient };
}

const png = (name = 'a.png', bytes = 3) => new File(['x'.repeat(bytes)], name, { type: 'image/png' });

describe('useReceiptFiles (MUT-657)', () => {
  it('uploads what passes, says it landed in To review, and calls onLanded with the count', async () => {
    const api = stubApi(landing);
    const { onLanded } = mount();
    await act(() => send([png()]));
    expect(api.count('POST /v1/receipts/uploads')).toBe(1);
    expect(await screen.findByText('1 receipt added to To review')).toBeInTheDocument();
    expect(onLanded).toHaveBeenCalledWith(1);
  });

  it('refuses a wrong type and a file over 10 MB before any request, with the existing messages', async () => {
    const api = stubApi(landing);
    const { onLanded } = mount();
    await act(() => send([new File(['x'], 'notes.txt', { type: 'text/plain' })]));
    expect(await screen.findByText('notes.txt: receipts must be a PDF, JPEG or PNG file.')).toBeInTheDocument();
    const big = png('big.png');
    Object.defineProperty(big, 'size', { value: 10 * 1024 * 1024 + 1 });
    await act(() => send([big]));
    expect(await screen.findByText(/big\.png/)).toBeInTheDocument();
    expect(api.count('POST /v1/receipts/uploads')).toBe(0);
    expect(onLanded).not.toHaveBeenCalled();
  });

  it('tells the pending cap from the per-minute budget on a 429', async () => {
    stubApi({ 'POST /v1/receipts/uploads': () => fail(429, 'RATE_LIMITED', { reason: 'TOO_MANY_PENDING_UPLOADS' }) });
    mount();
    await act(() => send([png()]));
    expect(await screen.findByText('Too many unfinished uploads. Finish or remove them, then try again.')).toBeInTheDocument();

    stubApi({ 'POST /v1/receipts/uploads': () => fail(429, 'RATE_LIMITED', undefined, { 'Retry-After': '30' }) });
    await act(() => send([png('b.png')]));
    expect(await screen.findByText(/30/)).toBeInTheDocument();
  });
});

/** MUT-657: home's short To review list never shares the gallery's 24-a-page cache. */
describe('useReceipts with a limit (MUT-657)', () => {
  function Lists() {
    useReceipts(P, 'to_review');
    useReceipts(P, 'to_review', 8);
    return null;
  }

  it('keys and fetches each limit apart', async () => {
    const api = stubApi({ 'GET /v1/receipts': () => ok({ items: [], nextCursor: null }) });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <Lists />
      </QueryClientProvider>,
    );
    await vi.waitFor(() => expect(api.count('GET /v1/receipts')).toBe(2));
    const limits = api.calls.filter((c) => c.url.pathname === '/v1/receipts').map((c) => c.url.searchParams.get('limit'));
    expect(limits.sort()).toEqual(['24', '8']);
    expect(queryClient.getQueryCache().findAll({ queryKey: receiptsKey(P, 'list') })).toHaveLength(2);
  });
});
