import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderWithProviders, screen, createMockBusinessProfile, createMockClient } from '../../../test/utils';
import type { MalafatSuggestions } from '../../../lib/malafatSuggestions';
import { useSampleSessionStore } from '../../../demo/sampleSessionStore';
import { useDemoStore } from '../../../demo/demoStore';
import en from '../../../lib/i18n/translations/en.json';
import ar from '../../../lib/i18n/translations/ar.json';
import { MalafatClientsSuggestion } from '../MalafatClientsSuggestion';

const state = vi.hoisted(() => ({
  suggestions: { on: true, dismissed: [] } as MalafatSuggestions | null,
  profiles: [] as ReturnType<typeof createMockBusinessProfile>[],
  activeProfileId: 'p1',
  clients: [] as ReturnType<typeof createMockClient>[],
  clientsLoaded: true,
  retire: vi.fn(),
}));

vi.mock('../../../lib/useMalafatSuggestions', () => ({
  useMalafatSuggestions: () => state.suggestions,
  useDismissMalafatMoment: () => ({ mutate: state.retire }),
}));
vi.mock('../../../hooks/useActiveProfile', () => ({
  useActiveProfile: () => ({ activeProfileId: state.activeProfileId, profiles: state.profiles, isLoading: false }),
}));
vi.mock('../../../hooks/useQueries', () => ({
  useClients: () => ({ data: state.clientsLoaded ? state.clients : undefined, isSuccess: state.clientsLoaded }),
}));

const clientsFor = (profileId: string, n: number) =>
  Array.from({ length: n }, (_, i) => createMockClient({ id: `${profileId}-c${i}`, profileId }));

beforeEach(() => {
  localStorage.setItem('mutaba3a-language', 'en');
  state.suggestions = { on: true, dismissed: [] };
  state.profiles = [createMockBusinessProfile({ id: 'p1' })];
  state.activeProfileId = 'p1';
  state.clients = clientsFor('p1', 3);
  state.clientsLoaded = true;
  state.retire.mockReset();
  useSampleSessionStore.setState({ status: 'none' });
  useDemoStore.setState({ isActive: false });
});

const card = () => screen.queryByRole('group', { name: en.clients.malafat.label });

/** The Clients page's one Malafat suggestion (MUT-190: C2 at the client threshold, else C3 with a second business). */
describe('MalafatClientsSuggestion', () => {
  it('suggests Malafat once the working business has ten clients, linking with the client-threshold tags', () => {
    state.clients = [...clientsFor('p1', 10), ...clientsFor('p2', 5)];
    renderWithProviders(<MalafatClientsSuggestion onGone={vi.fn()} />);
    expect(card()).toHaveTextContent(en.clients.malafat.clientThreshold);
    const href = screen.getByRole('link').getAttribute('href')!;
    expect(href).toContain('/en/contact?topic=mutaba3a');
    expect(href).toContain('utm_medium=web-local');
    expect(href).toContain('utm_content=client-threshold');
  });

  it('counts only the working business\'s clients', () => {
    state.clients = [...clientsFor('p1', 9), ...clientsFor('p2', 30)];
    renderWithProviders(<MalafatClientsSuggestion onGone={vi.fn()} />);
    expect(card()).toBeNull();
  });

  it('suggests it for a second business when under the threshold', () => {
    state.profiles = [createMockBusinessProfile({ id: 'p1' }), createMockBusinessProfile({ id: 'p2' })];
    renderWithProviders(<MalafatClientsSuggestion onGone={vi.fn()} />);
    expect(card()).toHaveTextContent(en.clients.malafat.secondBusiness);
    expect(screen.getByRole('link').getAttribute('href')).toContain('utm_content=second-business');
  });

  it('shows nothing while anything is still loading, so a dismissed card never flashes', () => {
    state.clients = clientsFor('p1', 12);
    state.suggestions = null;
    renderWithProviders(<MalafatClientsSuggestion onGone={vi.fn()} />);
    expect(card()).toBeNull();
    state.suggestions = { on: true, dismissed: [] };
    state.clientsLoaded = false;
    renderWithProviders(<MalafatClientsSuggestion onGone={vi.fn()} />);
    expect(card()).toBeNull();
  });

  it('shows nothing without a working business, when switched off, in the visitor sample, or in demo data', () => {
    state.clients = clientsFor('p1', 12);
    state.activeProfileId = '';
    const { unmount } = renderWithProviders(<MalafatClientsSuggestion onGone={vi.fn()} />);
    expect(card()).toBeNull();
    unmount();
    state.activeProfileId = 'p1';
    state.suggestions = { on: false, dismissed: [] };
    renderWithProviders(<MalafatClientsSuggestion onGone={vi.fn()} />).unmount();
    expect(card()).toBeNull();
    state.suggestions = { on: true, dismissed: [] };
    useSampleSessionStore.setState({ status: 'active' });
    renderWithProviders(<MalafatClientsSuggestion onGone={vi.fn()} />).unmount();
    expect(card()).toBeNull();
    useSampleSessionStore.setState({ status: 'none' });
    useDemoStore.setState({ isActive: true });
    renderWithProviders(<MalafatClientsSuggestion onGone={vi.fn()} />);
    expect(card()).toBeNull();
  });

  it('reads in Arabic', () => {
    localStorage.setItem('mutaba3a-language', 'ar');
    state.clients = clientsFor('p1', 10);
    renderWithProviders(<MalafatClientsSuggestion onGone={vi.fn()} />);
    expect(screen.getByRole('group', { name: ar.clients.malafat.label })).toHaveTextContent(ar.clients.malafat.clientThreshold);
    expect(screen.getByRole('link').getAttribute('href')).toContain('/ar/contact');
  });
});
