import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProjectPicker } from '../ProjectPicker';

const fetchMock = vi.fn();

function ok(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function renderPicker(value = '') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onChange = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <ProjectPicker profileId="org-1" value={value} onChange={onChange} placeholder="Search matter..." />
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
        { id: 'p1', name: 'Lease dispute' },
        { id: 'p2', name: 'Contract review' },
      ],
      nextCursor: null,
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('ProjectPicker', () => {
  it('lists directory projects and selects one', async () => {
    const user = userEvent.setup();
    const { onChange } = renderPicker();
    const input = await screen.findByPlaceholderText('Search matter...');
    await user.click(input);
    const option = await screen.findByText('Contract review');
    await user.click(option);
    expect(onChange).toHaveBeenCalledWith('p2');
  });

  it('never offers a "create new" option for unmatched text', async () => {
    const user = userEvent.setup();
    renderPicker();
    const input = await screen.findByPlaceholderText('Search matter...');
    await user.click(input);
    await waitFor(() => expect(screen.getByText('Lease dispute')).toBeInTheDocument());
    await user.type(input, 'Brand New Matter');
    expect(screen.queryByText(/create/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Brand New Matter')).not.toBeInTheDocument();
  });

  it('prefills the display name from an existing value', async () => {
    renderPicker('p1');
    expect(await screen.findByDisplayValue('Lease dispute')).toBeInTheDocument();
  });
});
