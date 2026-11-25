import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { HostedProfile } from '../../api/client';
import { HostedLanguageProvider, PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';
import { DocumentsPreferenceAsk } from '../DocumentsPreferenceAsk';

const PROFILE = { id: 'p1', name: 'Studio' } as HostedProfile;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function setup(language: 'en' | 'ar', patch: () => Response = () => json({ id: 'c1', version: 4, documentsPreference: 'TAX_INVOICE_FIRST' })) {
  localStorage.setItem(PORTAL_LANGUAGE_KEY, language);
  const calls: Array<{ method: string; path: string; body?: unknown; ifMatch: string | null }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input), 'http://portal.test');
      const method = (init.method ?? 'GET').toUpperCase();
      calls.push({ method, path: url.pathname, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined, ifMatch: new Headers(init.headers).get('If-Match') });
      if (method === 'GET') return json({ id: 'c1', version: 3, documentsPreference: null });
      return patch();
    }),
  );
  const onClose = vi.fn();
  const onAnswered = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <HostedLanguageProvider>
        <DocumentsPreferenceAsk profile={PROFILE} ask={{ customerId: 'c1', customerName: 'Rami', onAnswered }} onClose={onClose} />
      </HostedLanguageProvider>
    </QueryClientProvider>,
  );
  return { calls, onClose, onAnswered, user: userEvent.setup() };
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('DocumentsPreferenceAsk (MUT-661)', () => {
  it('asks with four choices and saves the pick on the client with the version just read, then hands the answer on', async () => {
    const { calls, onClose, onAnswered, user } = setup('en');
    expect(screen.getByText(/How do you issue documents to/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Tax invoice first|Payment request first|On payment|No document/ })).toHaveLength(4);
    await user.click(screen.getByTestId('ask-TAX_INVOICE_FIRST'));
    await waitFor(() => expect(onAnswered).toHaveBeenCalledWith('TAX_INVOICE_FIRST'));
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({ path: '/v1/customers/c1', body: { documentsPreference: 'TAX_INVOICE_FIRST' }, ifMatch: '3' });
    expect(onClose).toHaveBeenCalled();
  });

  it('says it in formal Arabic', () => {
    setup('ar');
    expect(screen.getByText(/كيف تُصدر المستندات لـ/)).toBeInTheDocument();
  });

  it('keeps the choices and says so when the save fails, and "Not now" saves nothing', async () => {
    const { calls, onAnswered, onClose, user } = setup('en', () => json({ error: { code: 'INTERNAL', message: 'x', requestId: 'r' } }, 500));
    await user.click(screen.getByTestId('ask-NO_DOCUMENT'));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't save your choice");
    expect(onAnswered).not.toHaveBeenCalled();
    expect(screen.getByTestId('ask-ON_PAYMENT')).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Not now' }));
    expect(onClose).toHaveBeenCalled();
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
  });
});
