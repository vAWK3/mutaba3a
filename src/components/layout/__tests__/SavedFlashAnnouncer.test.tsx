import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import { renderWithProviders, screen } from '../../../test/utils';
import { SavedFlashAnnouncer } from '../SavedFlashAnnouncer';
import { useSavedFlashStore, type SavedFlash } from '../../../lib/savedFlashStore';
import { useProfileStore } from '../../../lib/profileStore';
import { useToastStore } from '../../../lib/toastStore';

const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}));

function income(overrides: Partial<SavedFlash> = {}): SavedFlash {
  return {
    kind: 'income',
    ids: ['tx-1'],
    clientId: 'client-1',
    clientName: 'Furniture Co.',
    profileId: 'profile-1',
    ...overrides,
  };
}

describe('SavedFlashAnnouncer', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    act(() => {
      useSavedFlashStore.getState().clear();
      useToastStore.setState({ toasts: [] });
      useProfileStore.getState().reset();
    });
  });

  it('renders nothing while unresolved', () => {
    act(() => useSavedFlashStore.getState().markSaved(income()));
    renderWithProviders(<SavedFlashAnnouncer />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('announces "Saved" politely once the row is claimed, and raises no message', async () => {
    act(() => {
      useSavedFlashStore.getState().markSaved(income());
      useSavedFlashStore.getState().registerList('list-a');
      useSavedFlashStore.getState().reportSettled('list-a', ['tx-1'], true);
    });
    renderWithProviders(<SavedFlashAnnouncer />);

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved'));
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('raises the message with Show when nothing claims the row', async () => {
    act(() => useSavedFlashStore.getState().markSaved(income()));
    renderWithProviders(<SavedFlashAnnouncer />);
    act(() => {
      useSavedFlashStore.getState().registerList('list-a');
      useSavedFlashStore.getState().registerList('list-b');
      useSavedFlashStore.getState().reportSettled('list-a', ['other'], true);
      useSavedFlashStore.getState().reportSettled('list-b', ['other-2'], true);
    });

    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
    expect(useToastStore.getState().toasts[0].message).toContain('Furniture Co.');
    expect(useToastStore.getState().toasts[0].action?.label).toBe('Show');
  });

  it('Show switches the active profile, navigates, and re-arms so the original message cannot fire twice', async () => {
    act(() => useProfileStore.getState().setActiveProfile('some-other-profile'));
    act(() => useSavedFlashStore.getState().markSaved(income()));
    renderWithProviders(<SavedFlashAnnouncer />);
    act(() => {
      useSavedFlashStore.getState().registerList('list-a');
      useSavedFlashStore.getState().registerList('list-b');
      useSavedFlashStore.getState().reportSettled('list-a', ['other'], true);
      useSavedFlashStore.getState().reportSettled('list-b', ['other-2'], true);
    });

    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
    const toast = useToastStore.getState().toasts[0];

    act(() => toast.action?.onClick());

    expect(useProfileStore.getState().activeProfileId).toBe('profile-1');
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/clients/$clientId', params: { clientId: 'client-1' } });
    expect(useSavedFlashStore.getState().pending?.messaged).toBe(true);
  });

  it('never shows the original message twice for the same save', async () => {
    act(() => {
      useSavedFlashStore.getState().markSaved(income());
      useSavedFlashStore.getState().registerList('list-a');
      useSavedFlashStore.getState().reportSettled('list-a', ['other'], true);
    });
    renderWithProviders(<SavedFlashAnnouncer />);
    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));

    act(() => useToastStore.setState({ toasts: [] }));
    // re-report the same unclaimed state again (e.g. a re-render) -- must not re-toast
    act(() => useSavedFlashStore.getState().reportSettled('list-a', ['other'], true));

    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});
