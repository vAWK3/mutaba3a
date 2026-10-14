import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderWithProviders, screen, userEvent, createMockBusinessProfile } from '../../../test/utils';
import type { MalafatSuggestions } from '../../../lib/malafatSuggestions';
import { useMalafatMomentStore } from '../../../lib/malafatMomentStore';
import { useDemoStore } from '../../../demo/demoStore';
import { useSampleSessionStore } from '../../../demo/sampleSessionStore';
import en from '../../../lib/i18n/translations/en.json';
import ar from '../../../lib/i18n/translations/ar.json';
import { MalafatEntry } from '../MalafatEntry';

const state = vi.hoisted(() => ({
  suggestions: { on: true, dismissed: [] } as MalafatSuggestions | null,
  profiles: [] as ReturnType<typeof createMockBusinessProfile>[],
  retire: vi.fn(),
  setOn: vi.fn(),
}));

vi.mock('../../../lib/useMalafatSuggestions', () => ({
  useMalafatSuggestions: () => state.suggestions,
  useDismissMalafatMoment: () => ({ mutate: state.retire }),
  useSetMalafatSuggestionsOn: () => ({ mutate: state.setOn, isPending: false }),
}));
vi.mock('../../../hooks/useQueries', () => ({
  useBusinessProfiles: () => ({ data: state.profiles }),
}));

const T = en.settings.profile.malafat;

beforeEach(() => {
  localStorage.setItem('mutaba3a-language', 'en');
  state.suggestions = { on: true, dismissed: [] };
  state.profiles = [createMockBusinessProfile({ id: 'p1' })];
  state.retire.mockReset();
  state.setOn.mockReset();
  useMalafatMomentStore.getState().reset();
  useDemoStore.setState({ isActive: false });
  useSampleSessionStore.setState({ status: 'none' });
});

/** Settings › Businesses' "Mutaba3a + Malafat" row (S1) and, right after a second business is added, its note (C1). MUT-190. */
describe('MalafatEntry', () => {
  it('always shows the row with one link to Malafat\'s contact page, tagged for Settings', () => {
    renderWithProviders(<MalafatEntry />);
    expect(screen.getByText(T.title)).toBeInTheDocument();
    expect(screen.getByText(T.text)).toBeInTheDocument();
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName(`${T.cta} ${en.common.opensInNewTab}`);
    expect(links[0].getAttribute('href')).toContain('/en/contact?topic=mutaba3a&utm_source=mutaba3a&utm_medium=web-local');
    expect(links[0].getAttribute('href')).toContain('utm_content=settings');
  });

  it('keeps the row when suggestions are off, and the switch says so', async () => {
    state.suggestions = { on: false, dismissed: [] };
    renderWithProviders(<MalafatEntry />);
    expect(screen.getByText(T.text)).toBeInTheDocument();
    const toggle = screen.getByRole('switch', { name: T.switchLabel });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(toggle);
    expect(state.setOn).toHaveBeenCalledWith(true);
  });

  it('turns its line into the business-added note after a second business is added, with the one link tagged for it', () => {
    state.profiles = [createMockBusinessProfile({ id: 'p1' }), createMockBusinessProfile({ id: 'p2' })];
    act(() => useMalafatMomentStore.getState().markBusinessAdded());
    renderWithProviders(<MalafatEntry />);
    expect(screen.getByRole('group', { name: T.noteLabel })).toHaveTextContent(T.businessAdded);
    expect(screen.queryByText(T.text)).toBeNull();
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toContain('utm_content=business-profile');
  });

  it('retires the note for good on dismiss, clears it, and puts focus on the row\'s link', async () => {
    state.profiles = [createMockBusinessProfile({ id: 'p1' }), createMockBusinessProfile({ id: 'p2' })];
    act(() => useMalafatMomentStore.getState().markBusinessAdded());
    renderWithProviders(<MalafatEntry />);
    await userEvent.click(screen.getByRole('button', { name: T.dismiss }));
    expect(state.retire).toHaveBeenCalledWith('business-profile');
    expect(useMalafatMomentStore.getState().businessAdded).toBe(false);
    expect(screen.getByText(T.text)).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveFocus();
  });

  it('shows no note for a single business, when off, or once dismissed', () => {
    act(() => useMalafatMomentStore.getState().markBusinessAdded());
    const { unmount } = renderWithProviders(<MalafatEntry />);
    expect(screen.queryByRole('group', { name: T.noteLabel })).toBeNull();
    unmount();
    state.profiles = [createMockBusinessProfile({ id: 'p1' }), createMockBusinessProfile({ id: 'p2' })];
    state.suggestions = { on: true, dismissed: ['business-profile'] };
    renderWithProviders(<MalafatEntry />);
    expect(screen.queryByRole('group', { name: T.noteLabel })).toBeNull();
  });

  it('shows no note inside sample or demo data, whatever the flag says', () => {
    state.profiles = [createMockBusinessProfile({ id: 'p1' }), createMockBusinessProfile({ id: 'p2' })];
    act(() => useMalafatMomentStore.getState().markBusinessAdded());
    useDemoStore.setState({ isActive: true });
    renderWithProviders(<MalafatEntry />);
    expect(screen.queryByRole('group', { name: T.noteLabel })).toBeNull();
  });

  it('keeps focus on the switch while the change is written (no native disabled mid-press)', async () => {
    renderWithProviders(<MalafatEntry />);
    const toggle = screen.getByRole('switch', { name: T.switchLabel });
    toggle.focus();
    await userEvent.keyboard(' ');
    expect(state.setOn).toHaveBeenCalledWith(false);
    expect(toggle).not.toBeDisabled();
    expect(toggle).toHaveFocus();
  });

  it('reads in Arabic', () => {
    localStorage.setItem('mutaba3a-language', 'ar');
    renderWithProviders(<MalafatEntry />);
    expect(screen.getByText(ar.settings.profile.malafat.text)).toBeInTheDocument();
    expect(screen.getByRole('link').getAttribute('href')).toContain('/ar/contact');
  });
});
