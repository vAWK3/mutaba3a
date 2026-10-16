/**
 * MUT-24: "What's new" — opens once after an update with that update's notes,
 * in the chosen language, and stays dismissed. Real dictionaries.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { act } from '@testing-library/react';
import { renderWithProviders, screen, waitFor } from '../../../test/utils';
import { chooseLanguage } from '../../../test/language';
import { WhatsNewModal, WhatsNewController } from '../WhatsNewModal';
import { WHATS_NEW_SEEN_KEY, useWhatsNewStore, type ReleaseNotes } from '../../../lib/whatsNew';
import * as useQueries from '../../../hooks/useQueries';
import { useSampleSessionStore } from '../../../demo/sampleSessionStore';

const NOTES: ReleaseNotes = {
  '0.1.6': { en: ['Older change'], ar: ['تغيير أقدم'] },
  '0.1.7': { en: ['First change', 'Second change'], ar: ['التغيير الأول', 'التغيير الثاني'] },
};

function withProfiles(count: number, isLoading = false) {
  vi.spyOn(useQueries, 'useBusinessProfiles').mockReturnValue({
    data: isLoading ? undefined : Array.from({ length: count }, (_, i) => ({ id: `p-${i}` })),
    isLoading,
    isError: false,
  } as unknown as ReturnType<typeof useQueries.useBusinessProfiles>);
}

function renderShell(current = '0.1.7') {
  return renderWithProviders(
    <>
      <WhatsNewController notes={NOTES} current={current} />
      <WhatsNewModal current={current} />
    </>,
  );
}

describe('What’s new (MUT-24)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    act(() => useWhatsNewStore.getState().closeWhatsNew());
    useSampleSessionStore.setState({ status: 'none' } as Partial<ReturnType<typeof useSampleSessionStore.getState>>);
    withProfiles(1);
  });

  it('after an update, shows each new version’s notes, newest first', async () => {
    localStorage.setItem(WHATS_NEW_SEEN_KEY, '0.1.5');
    renderShell();
    const dialog = await screen.findByRole('dialog', { name: "What's new" });
    const items = [...dialog.querySelectorAll('li')].map((li) => li.textContent);
    expect(items).toEqual(['First change', 'Second change', 'Older change']);
    expect(dialog.textContent).toContain('Version 0.1.7');
    expect(dialog.textContent).toContain('Version 0.1.6');
  });

  it('“Got it” closes it and it stays closed on the next start', async () => {
    localStorage.setItem(WHATS_NEW_SEEN_KEY, '0.1.6');
    const { unmount } = renderShell();
    await userEvent.click(await screen.findByRole('button', { name: 'Got it' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(localStorage.getItem(WHATS_NEW_SEEN_KEY)).toBe('0.1.7');
    unmount();

    renderShell();
    await waitFor(() => expect(useQueries.useBusinessProfiles).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Escape dismisses it too', async () => {
    localStorage.setItem(WHATS_NEW_SEEN_KEY, '0.1.6');
    renderShell();
    await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(localStorage.getItem(WHATS_NEW_SEEN_KEY)).toBe('0.1.7');
  });

  it('shows nothing when this version’s notes were already seen', async () => {
    localStorage.setItem(WHATS_NEW_SEEN_KEY, '0.1.7');
    renderShell();
    await waitFor(() => expect(useQueries.useBusinessProfiles).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('waits while the welcome flow owns the screen (no business yet, or the sample is being set up)', async () => {
    localStorage.setItem(WHATS_NEW_SEEN_KEY, '0.1.6');
    withProfiles(0);
    const { unmount } = renderShell();
    await waitFor(() => expect(useQueries.useBusinessProfiles).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    unmount();

    withProfiles(1);
    useSampleSessionStore.setState({ status: 'preparing' } as Partial<ReturnType<typeof useSampleSessionStore.getState>>);
    renderShell();
    await waitFor(() => expect(useQueries.useBusinessProfiles).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('is in Arabic, right to left, with the version kept left to right', async () => {
    chooseLanguage('ar');
    localStorage.setItem(WHATS_NEW_SEEN_KEY, '0.1.6');
    renderShell();
    const dialog = await screen.findByRole('dialog', { name: 'ما الجديد' });
    expect([...dialog.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['التغيير الأول', 'التغيير الثاني']);
    expect(dialog.querySelector('bdi')).toHaveAttribute('dir', 'ltr');
    expect(dialog.querySelector('bdi')?.textContent).toBe('0.1.7');
    expect(screen.getByRole('button', { name: 'حسنًا' })).toBeInTheDocument();
  });
});
