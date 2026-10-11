import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClientPicker } from '../ClientPicker';

const fetchMock = vi.fn();

function ok(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function renderPicker(value = '') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onChange = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <ClientPicker profileId="org-1" value={value} onChange={onChange} placeholder="Search client..." />
    </QueryClientProvider>,
  );
  return { onChange };
}

beforeEach(() => {
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

  it('never offers a "create new" option for unmatched text', async () => {
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
});
