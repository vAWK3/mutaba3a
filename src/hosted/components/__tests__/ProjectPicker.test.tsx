import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProjectPicker, type ProjectPickerProps } from '../ProjectPicker';
import { ToastProvider } from '../Toast';
import { HostedLanguageProvider, PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';

const fetchMock = vi.fn();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const CUSTOMERS = [
  { id: 'c1', name: 'Haddad & Partners' },
  { id: 'c2', name: 'Nablus Textiles' },
];
const PROJECTS = [
  { id: 'p1', name: 'Lease dispute', customerId: 'c1' },
  { id: 'p2', name: 'Contract review', customerId: 'c1' },
  { id: 'p3', name: 'Retainer', customerId: 'c1' },
  { id: 'p4', name: 'Retainer', customerId: 'c2' },
];

/** GET /v1/customers and /v1/projects (filtered by ?customerId=) answer from the lists; POST /v1/projects answers `create`. */
function routeFetch(create: () => Response = () => json({}, 500)) {
  fetchMock.mockImplementation((input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), 'http://portal.test');
    if ((init.method ?? 'GET') === 'POST') return Promise.resolve(create());
    if (url.pathname === '/v1/customers') return Promise.resolve(json({ items: CUSTOMERS, nextCursor: null }));
    const customerId = url.searchParams.get('customerId');
    return Promise.resolve(json({ items: PROJECTS.filter((p) => !customerId || p.customerId === customerId), nextCursor: null }));
  });
}

const posts = () => fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST') as Array<[string, RequestInit]>;

function renderPicker(props: Partial<ProjectPickerProps> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const onChange = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <HostedLanguageProvider>
        <ToastProvider>
          <ProjectPicker profileId="org-1" value="" onChange={onChange} placeholder="Search matter..." {...props} />
        </ToastProvider>
      </HostedLanguageProvider>
    </QueryClientProvider>,
  );
  return { onChange, queryClient };
}

async function typeInPicker(text: string) {
  const user = userEvent.setup();
  const input = await screen.findByPlaceholderText('Search matter...');
  await user.click(input);
  await user.type(input, text);
  return { user, input };
}

beforeEach(() => {
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  routeFetch();
});
afterEach(() => vi.unstubAllGlobals());

describe('ProjectPicker', () => {
  it('lists directory projects and selects one', async () => {
    const user = userEvent.setup();
    const { onChange } = renderPicker({ customerId: 'c1' });
    const input = await screen.findByPlaceholderText('Search matter...');
    await user.click(input);
    await user.click(await screen.findByText('Contract review'));
    expect(onChange).toHaveBeenCalledWith('p2');
  });

  it('never offers Add matter where the person may not add matters', async () => {
    renderPicker({ customerId: 'c1', currency: 'ILS' });
    await typeInPicker('Brand New Matter');
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByRole('option', { name: /Add matter/ })).toBeNull();
    expect(screen.queryByText('Brand New Matter', { selector: '.entity-typeahead-name' })).toBeNull();
  });

  it('prefills the display name from an existing value', async () => {
    renderPicker({ value: 'p1', customerId: 'c1' });
    expect(await screen.findByDisplayValue('Lease dispute')).toBeInTheDocument();
  });

  describe('Add «name» (MUT-318)', () => {
    it('offers to add a typed name the client has no matter for, and creates it under the client in the drawer currency', async () => {
      routeFetch(() => json({ id: 'p9', name: 'Menu design', customerId: 'c1' }, 201));
      const { onChange } = renderPicker({ customerId: 'c1', currency: 'JOD', canCreate: true });
      const { user, input } = await typeInPicker('Menu design');

      await user.click(await screen.findByRole('option', { name: /Add matter.*Menu design/ }));

      await waitFor(() => expect(onChange).toHaveBeenCalledWith('p9'));
      const [[url, init]] = posts();
      expect(url).toBe('/v1/projects');
      expect(JSON.parse(String(init.body))).toEqual({ customerId: 'c1', name: 'Menu design', currency: 'JOD' });
      expect(new Headers(init.headers).get('Idempotency-Key')).toBeTruthy();
      expect(new Headers(init.headers).get('X-Mutaba3a-Profile')).toBe('org-1');
      expect(input).toHaveValue('Menu design');
    });

    it('does not offer to add a name the client already has (any case), but does for another client\'s name', async () => {
      renderPicker({ customerId: 'c2', currency: 'ILS', canCreate: true });
      const { user, input } = await typeInPicker('retainer');
      expect(await screen.findByRole('option', { name: 'Retainer' })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: /Add matter/ })).toBeNull();

      await user.clear(input);
      await user.type(input, 'Lease dispute'); // c1's matter, not c2's
      expect(await screen.findByRole('option', { name: /Add matter.*Lease dispute/ })).toBeInTheDocument();
    });

    it('with no client chosen, offers no Add row and says why, in the input\'s description (5A)', async () => {
      renderPicker({ currency: 'ILS', canCreate: true });
      const input = await screen.findByPlaceholderText('Search matter...');
      const hintId = input.getAttribute('aria-describedby');
      expect(hintId).toBeTruthy();
      const hint = document.getElementById(hintId!)!;
      expect(hint).toHaveAttribute('aria-live', 'polite');
      expect(hint).toHaveTextContent('');

      await typeInPicker('Menu design');

      expect(hint).toHaveTextContent('Choose a client first to add a matter.');
      expect(screen.queryByRole('option', { name: /Add matter/ })).toBeNull();
    });

    it('shows no hint where the person may not add matters', async () => {
      renderPicker({ currency: 'ILS' });
      await typeInPicker('Menu design');
      expect(screen.queryByText('Choose a client first to add a matter.')).toBeNull();
    });

    it('with no client chosen, names each matter\'s client; with one chosen, does not (1A)', async () => {
      renderPicker();
      const user = userEvent.setup();
      await user.click(await screen.findByPlaceholderText('Search matter...'));
      const rows = await screen.findAllByRole('option', { name: /Retainer/ });
      expect(rows.map((row) => row.textContent)).toEqual(['RetainerHaddad & Partners', 'RetainerNablus Textiles']);
    });

    it('lists only the chosen client\'s matters, without client names', async () => {
      renderPicker({ customerId: 'c2' });
      const user = userEvent.setup();
      await user.click(await screen.findByPlaceholderText('Search matter...'));
      const rows = await screen.findAllByRole('option');
      expect(rows.map((row) => row.textContent)).toEqual(['Retainer']);
    });

    it('a refused create keeps the typed name unpicked, clears the value and says so', async () => {
      routeFetch(() => json({ error: { code: 'VALIDATION_FAILED', message: 'nope' } }, 422));
      const { onChange } = renderPicker({ customerId: 'c1', currency: 'ILS', canCreate: true });
      const { user, input } = await typeInPicker('Menu design');

      await user.click(await screen.findByRole('option', { name: /Add matter.*Menu design/ }));

      expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't add the matter. Try again.");
      expect(onChange).toHaveBeenLastCalledWith('');
      expect(input).toHaveValue('Menu design');
    });

    it('keeps the input enabled and focused while the matter is being added (A1)', async () => {
      let answer!: (response: Response) => void;
      routeFetch();
      fetchMock.mockImplementation((input: RequestInfo | URL, init: RequestInit = {}) => {
        if ((init.method ?? 'GET') === 'POST') return new Promise<Response>((resolve) => (answer = resolve));
        const url = new URL(String(input), 'http://portal.test');
        if (url.pathname === '/v1/customers') return Promise.resolve(json({ items: CUSTOMERS, nextCursor: null }));
        return Promise.resolve(json({ items: PROJECTS.filter((p) => p.customerId === 'c1'), nextCursor: null }));
      });
      renderPicker({ customerId: 'c1', currency: 'ILS', canCreate: true });
      const { user, input } = await typeInPicker('Menu design');
      await user.keyboard('{Enter}');

      await waitFor(() => expect(posts()).toHaveLength(1));
      expect(input).not.toBeDisabled();
      expect(input).toHaveAttribute('readonly');
      expect(document.activeElement).toBe(input);
      answer(json({ id: 'p9', name: 'Menu design', customerId: 'c1' }, 201));
      await waitFor(() => expect(input).not.toHaveAttribute('readonly'));
    });

    it('a new matter is in every matter list for the next pick, and in the summaries', async () => {
      routeFetch(() => json({ id: 'p9', name: 'Menu design', customerId: 'c1' }, 201));
      const { queryClient } = renderPicker({ customerId: 'c1', currency: 'ILS', canCreate: true });
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
      const { user } = await typeInPicker('Menu design');
      await user.click(await screen.findByRole('option', { name: /Add matter.*Menu design/ }));

      await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['p', 'org-1', 'directory', 'projects'] }));
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['p', 'org-1', 'summary'] });
    });
  });
});
