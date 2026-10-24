import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { VendorPicker } from '../VendorPicker';
import { HostedLanguageProvider, PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';
import type { VendorSuggestion } from '../../api/client';

/** MUT-254: the vendor field is free text; the profile's vendors are suggestions only. */
const fetchMock = vi.fn();

const vendor = (over: Partial<VendorSuggestion>): VendorSuggestion => ({ id: 'v1', name: 'Super Deal', matchedName: 'Super Deal', registrationNo: null, phone: null, email: null, lastCategoryId: null, ...over });
const ok = (items: VendorSuggestion[]) => new Response(JSON.stringify({ items }), { status: 200, headers: { 'Content-Type': 'application/json' } });
const queries = () => fetchMock.mock.calls.map(([input]) => new URL(String(input), 'http://localhost').searchParams.get('q'));

function renderPicker() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onChange = vi.fn();
  const onPick = vi.fn();
  function Harness() {
    const [value, setValue] = useState('');
    return (
      <form onSubmit={(e) => e.preventDefault()}>
        <VendorPicker profileId="org-1" value={value} onChange={(next) => { setValue(next); onChange(next); }} onPick={onPick} placeholder="Vendor" />
      </form>
    );
  }
  render(
    <QueryClientProvider client={queryClient}>
      <HostedLanguageProvider>
        <Harness />
      </HostedLanguageProvider>
    </QueryClientProvider>,
  );
  return { onChange, onPick };
}

beforeEach(() => {
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('VendorPicker', () => {
  it('suggests the most recently used on an empty box; picking one fills its name and tells the drawer', async () => {
    const recent = vendor({ id: 'v2', name: 'Yellow Cab', matchedName: 'Yellow Cab', lastCategoryId: 'cat-travel' });
    fetchMock.mockImplementation(() => Promise.resolve(ok([recent])));
    const user = userEvent.setup();
    const { onChange, onPick } = renderPicker();
    await user.click(await screen.findByPlaceholderText('Vendor'));
    await user.click(await screen.findByText('Yellow Cab'));
    expect(onChange).toHaveBeenLastCalledWith('Yellow Cab');
    expect(onPick).toHaveBeenCalledWith(recent);
    // An empty box sends no q: the most recently used.
    expect(queries()[0]).toBeNull();
  });

  it('keeps typed text as a new vendor: Enter never swaps it for a suggestion that merely starts with it', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(ok([vendor({})])));
    const user = userEvent.setup();
    const { onChange, onPick } = renderPicker();
    const input = await screen.findByPlaceholderText('Vendor');
    await user.type(input, 'Super');
    expect(await screen.findByText(/New vendor/)).toBeTruthy();
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenLastCalledWith('Super');
    expect(onPick).not.toHaveBeenCalled();
    expect((input as HTMLInputElement).value).toBe('Super');
  });

  it('asks the server with what was typed, in any script, and shows which alias matched', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(ok([vendor({ id: 'v3', name: 'مخبز الأقصى', matchedName: 'Al Aqsa Bakery' })])));
    const user = userEvent.setup();
    renderPicker();
    await user.type(await screen.findByPlaceholderText('Vendor'), 'مخبز');
    await waitFor(() => expect(queries()).toContain('مخبز'));
    expect(await screen.findByText('Matched “Al Aqsa Bakery”')).toBeTruthy();
  });
});
