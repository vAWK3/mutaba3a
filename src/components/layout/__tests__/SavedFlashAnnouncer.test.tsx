import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../test/utils';
import { SavedFlashAnnouncer } from '../SavedFlashAnnouncer';
import { useSavedFlashStore, type SavedFlash } from '../../../lib/savedFlashStore';
import { useProfileStore } from '../../../lib/profileStore';
import { useToastStore } from '../../../lib/toastStore';

// Rendering + waitFor under full-suite CPU contention take longer than alone;
// the 5 s default turns that load into failures (TD-073).
vi.setConfig({ testTimeout: 15_000 });

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
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('raises a brief "Saved" toast with the animated icon once the row is claimed (MUT-338)', async () => {
    act(() => {
      useSavedFlashStore.getState().markSaved(income());
      useSavedFlashStore.getState().registerList('list-a');
      useSavedFlashStore.getState().reportSettled('list-a', ['tx-1'], true);
    });
    renderWithProviders(<SavedFlashAnnouncer />);

    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
    const toast = useToastStore.getState().toasts[0];
    expect(toast.message).toBe('Saved');
    expect(toast.icon).toBeTruthy();
    expect(toast.action).toBeUndefined();
  });

  it('never raises the claimed toast twice for the same save', async () => {
    act(() => {
      useSavedFlashStore.getState().markSaved(income());
      useSavedFlashStore.getState().registerList('list-a');
      useSavedFlashStore.getState().reportSettled('list-a', ['tx-1'], true);
    });
    const { rerender } = renderWithProviders(<SavedFlashAnnouncer />);
    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));

    // A re-render re-runs the effect (showToast is a new function each render),
    // so only the per-save guard keeps a second toast away
    act(() => useToastStore.setState({ toasts: [] }));
    rerender(<SavedFlashAnnouncer />);

    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('a claimed payment keeps its visually-hidden "Saved" and raises no toast (payments are outside MUT-338)', async () => {
    act(() => {
      useSavedFlashStore.getState().markSaved(income({ kind: 'payment' }));
      useSavedFlashStore.getState().registerList('list-a');
      useSavedFlashStore.getState().reportSettled('list-a', ['tx-1'], true);
    });
    const { container } = renderWithProviders(<SavedFlashAnnouncer />);

    await waitFor(() => expect(container.querySelector('.sr-only[role="status"]')?.textContent).toBe('Saved'));
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('an unclaimed payment message carries no save-feedback icon', async () => {
    act(() => useSavedFlashStore.getState().markSaved(income({ kind: 'payment' })));
    renderWithProviders(<SavedFlashAnnouncer />);
    act(() => {
      useSavedFlashStore.getState().registerList('list-a');
      useSavedFlashStore.getState().reportSettled('list-a', ['other'], true);
    });

    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
    expect(useToastStore.getState().toasts[0].action?.label).toBe('Show');
    expect(useToastStore.getState().toasts[0].icon).toBeUndefined();
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
    expect(useToastStore.getState().toasts[0].icon).toBeTruthy();
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

  it('Show changes the working business but keeps All businesses on (MUT-89, ADR-051)', async () => {
    act(() => {
      useProfileStore.getState().setActiveProfile('some-other-profile');
      useProfileStore.getState().setAllBusinesses(true);
    });
    act(() => useSavedFlashStore.getState().markSaved(income()));
    renderWithProviders(<SavedFlashAnnouncer />);
    act(() => {
      useSavedFlashStore.getState().registerList('list-a');
      useSavedFlashStore.getState().reportSettled('list-a', ['other'], true);
    });

    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
    act(() => useToastStore.getState().toasts[0].action?.onClick());

    expect(useProfileStore.getState()).toMatchObject({ activeProfileId: 'profile-1', allBusinesses: true });
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
