import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../../../lib/theme';
import { HostedLanguageProvider, PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';
import { fail, ok, profile, stubApi } from '../../__tests__/harness';
import { AttachExternalInvoiceDrawer, type ExternalEntry } from '../AttachExternalInvoiceDrawer';

/** MUT-647: the attach drawer: read, confirm (an amount that differs is said, never blocking), attach. */
const BUSINESS = profile({ type: 'BUSINESS', owned: true });
const ENTRY: ExternalEntry = { kind: 'OWED', id: 'e1111111-1111-4111-8111-111111111111', client: 'Client 1', amount: '1500.00', currency: 'ILS' };
const READ = { read: true, number: '3381', documentDate: '2026-11-15', amount: '1500.00' };
const pdf = () => new File(['%PDF-1.4 x'], 'invoice.pdf', { type: 'application/pdf' });

function renderDrawer(initialFile: File | null = null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <HostedLanguageProvider>
          <AttachExternalInvoiceDrawer profile={BUSINESS} entry={ENTRY} existing={null} initialFile={initialFile} onClose={onClose} />
        </HostedLanguageProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { onClose, user: userEvent.setup() };
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
});
afterEach(() => vi.unstubAllGlobals());

describe('AttachExternalInvoiceDrawer (MUT-647)', () => {
  it('prefills what the reader found; a total written differently but equal matches; a different one is said and Attach still sends', async () => {
    const api = stubApi({
      'POST /v1/issuing/external-invoices/read': () => ok({ ...READ, amount: '1,500' }),
      'POST /v1/issuing/external-invoices': () => ok({ id: 'x1' }, 201),
    });
    const { user, onClose } = renderDrawer();
    await user.upload(screen.getByTestId('external-file'), pdf());
    expect(await screen.findByLabelText('Invoice number')).toHaveValue('3381');
    expect(screen.getByLabelText('Invoice date')).toHaveValue('2026-11-15');
    expect(screen.getByTestId('external-amount-note')).toHaveTextContent('The total matches this entry.');

    await user.clear(screen.getByLabelText('Total on the invoice'));
    await user.type(screen.getByLabelText('Total on the invoice'), '1450.5');
    expect(screen.getByTestId('external-amount-note')).toHaveTextContent('The total differs');
    await user.clear(screen.getByLabelText('Invoice number'));
    await user.type(screen.getByLabelText('Invoice number'), '3382');
    await user.click(screen.getByTestId('external-attach'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const post = api.calls.find((c) => c.method === 'POST' && c.url.pathname === '/v1/issuing/external-invoices');
    expect(Object.fromEntries(post!.url.searchParams)).toEqual({ entryKind: 'OWED', entryId: ENTRY.id, number: '3382', documentDate: '2026-11-15', filename: 'invoice.pdf' });
  });

  it('a file dropped on the row is read at once; nothing read leaves the fields to type, and a missing number stops Attach', async () => {
    const api = stubApi({ 'POST /v1/issuing/external-invoices/read': () => ok({ read: false, number: null, documentDate: null, amount: null }) });
    const { user } = renderDrawer(pdf());
    expect(await screen.findByLabelText('Invoice number')).toHaveValue('');
    await user.type(screen.getByLabelText('Invoice date'), '15/11/2026');
    await user.click(screen.getByTestId('external-attach'));
    expect(screen.getByText('Enter the invoice number.')).toBeInTheDocument();
    expect(api.count('POST /v1/issuing/external-invoices')).toBe(0);
    expect(api.count('POST /v1/issuing/external-invoices/read')).toBe(1);
  });

  it('refuses a file that is not a PDF or an image before sending it', async () => {
    const api = stubApi({});
    renderDrawer();
    fireEvent.change(screen.getByTestId('external-file'), { target: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose a PDF, JPEG or PNG file.');
    expect(api.calls).toHaveLength(0);
  });

  it('says why the server refused: the entry already has one', async () => {
    stubApi({
      'POST /v1/issuing/external-invoices/read': () => ok(READ),
      'POST /v1/issuing/external-invoices': () => fail(409, 'CONFLICT', { reason: 'EXTERNAL_INVOICE_EXISTS' }),
    });
    const { user } = renderDrawer(pdf());
    await screen.findByLabelText('Invoice number');
    await user.click(screen.getByTestId('external-attach'));
    expect(await screen.findByRole('alert')).toHaveTextContent('This entry already has an invoice issued elsewhere.');
  });
});
