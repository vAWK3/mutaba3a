import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClientPicker } from '../ClientPicker';
import { ToastProvider } from '../Toast';
import { HostedLanguageProvider, PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';

const fetchMock = vi.fn();

function ok(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function renderPicker(value = '', canCreate = false) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const onChange = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <HostedLanguageProvider>
        <ToastProvider>
          <ClientPicker profileId="org-1" value={value} onChange={onChange} placeholder="Search client..." canCreate={canCreate} />
        </ToastProvider>
      </HostedLanguageProvider>
    </QueryClientProvider>,
  );
  return { onChange, queryClient };
}

/** The directory answers GET; POST /v1/customers answers with `create`. */
function routeFetch(create: () => Response) {
  fetchMock.mockImplementation((input: RequestInfo | URL, init: RequestInit = {}) => {
    if ((init.method ?? 'GET') === 'POST') return Promise.resolve(create());
    return Promise.resolve(ok({ items: [{ id: 'c1', name: 'Haddad & Partners' }], nextCursor: null }));
  });
}

const posts = () => fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST');

beforeEach(() => {
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(
    ok({
      items: [
        { id: 'c1', name: 'Haddad & Partners' },
        { id: 'c2', name: 'Nablus Textiles' },
      ],
      nextCursor: null,
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('ClientPicker', () => {
  it('lists directory clients and selects one', async () => {
    const user = userEvent.setup();
    const { onChange } = renderPicker();
    const input = await screen.findByPlaceholderText('Search client...');
    await user.click(input);
    const option = await screen.findByText('Nablus Textiles');
    await user.click(option);
    expect(onChange).toHaveBeenCalledWith('c2');
  });

  it('never offers a "create new" option where the person may not add clients', async () => {
    const user = userEvent.setup();
    renderPicker();
    const input = await screen.findByPlaceholderText('Search client...');
    await user.click(input);
    await waitFor(() => expect(screen.getByText('Haddad & Partners')).toBeInTheDocument());
    await user.type(input, 'Totally New Client Name');
    expect(screen.queryByText(/create/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Totally New Client Name')).not.toBeInTheDocument();
  });

  it('prefills the display name from an existing value', async () => {
    renderPicker('c1');
    expect(await screen.findByDisplayValue('Haddad & Partners')).toBeInTheDocument();
  });

  describe('Add «name» (MUT-286)', () => {
    it('offers to add a typed name no client has, and creates it on pick', async () => {
      routeFetch(() => new Response(JSON.stringify({ id: 'c9', name: 'Ramallah Bakery' }), { status: 201, headers: { 'Content-Type': 'application/json' } }));
      const user = userEvent.setup();
      const { onChange } = renderPicker('', true);
      const input = await screen.findByPlaceholderText('Search client...');
      await user.click(input);
      await user.type(input, 'Ramallah Bakery');

      await user.click(await screen.findByRole('option', { name: /Add client.*Ramallah Bakery/ }));

      await waitFor(() => expect(onChange).toHaveBeenCalledWith('c9'));
      const [[url, init]] = posts() as Array<[string, RequestInit]>;
      expect(url).toBe('/v1/customers');
      expect(JSON.parse(String(init.body))).toEqual({ name: 'Ramallah Bakery' });
      expect(new Headers(init.headers).get('Idempotency-Key')).toBeTruthy();
      expect(new Headers(init.headers).get('X-Mutaba3a-Profile')).toBe('org-1');
      expect(input).toHaveValue('Ramallah Bakery');
    });

    it('does not offer to add a name a client already has (any case)', async () => {
      routeFetch(() => ok({}));
      const user = userEvent.setup();
      renderPicker('', true);
      const input = await screen.findByPlaceholderText('Search client...');
      await user.click(input);
      await user.type(input, 'haddad & partners');
      expect(await screen.findByRole('option', { name: 'Haddad & Partners' })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: /Add client/ })).toBeNull();
    });

    it('a refused create keeps the typed name unpicked and says so', async () => {
      routeFetch(() => new Response(JSON.stringify({ error: { code: 'VALIDATION_FAILED', message: 'nope' } }), { status: 422, headers: { 'Content-Type': 'application/json' } }));
      const user = userEvent.setup();
      const { onChange } = renderPicker('', true);
      const input = await screen.findByPlaceholderText('Search client...');
      await user.click(input);
      await user.type(input, 'Ramallah Bakery');

      await user.click(await screen.findByRole('option', { name: /Add client.*Ramallah Bakery/ }));

      expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't add the client. Try again.");
      expect(onChange).not.toHaveBeenCalledWith(expect.stringMatching(/.+/));
      expect(input).toHaveValue('Ramallah Bakery');
    });

    it('a new client is in the directory for the next pick, and in the Clients summaries', async () => {
      routeFetch(() => new Response(JSON.stringify({ id: 'c9', name: 'Ramallah Bakery' }), { status: 201, headers: { 'Content-Type': 'application/json' } }));
      const user = userEvent.setup();
      const { queryClient } = renderPicker('', true);
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
      const input = await screen.findByPlaceholderText('Search client...');
      await user.click(input);
      await user.type(input, 'Ramallah Bakery');
      await user.click(await screen.findByRole('option', { name: /Add client.*Ramallah Bakery/ }));

      await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['p', 'org-1', 'directory', 'customers'] }));
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['p', 'org-1', 'summary'] });
    });
  });
});
