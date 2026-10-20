import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HostedLanguageProvider, PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';
import { BACKSTOP_MS, FLASH_MS, useSavedFlashStore, type SavedFlash } from '../../../lib/savedFlashStore';
import { NOTICE_MS, SavedNotice } from '../SavedNotice';

/** The portal's view of an unclaimed save (MUT-91, eng review D4/D5). */

const PROFILE = 'p-1';
const flash = (over: Partial<SavedFlash> = {}): SavedFlash => ({ kind: 'expense', ids: ['e-9'], profileId: PROFILE, ...over });

function unclaimed(f: SavedFlash) {
  act(() => {
    const store = useSavedFlashStore.getState();
    store.markSaved(f);
    store.registerList('list');
    store.reportSettled('list', ['e-1'], true);
  });
}

function notice(onShow = vi.fn(), preset: 'playful' | 'restrained' = 'playful') {
  const ui = (
    <HostedLanguageProvider>
      <SavedNotice kind="expense" message="Expense saved" profileId={PROFILE} onShow={onShow} preset={preset} />
    </HostedLanguageProvider>
  );
  return { onShow, ...render(ui) };
}

function scaleOf(el: Element): number {
  const match = /scale\(([-\d.]+)\)/.exec((el as HTMLElement).style.transform);
  return match ? Number(match[1]) : 0;
}

beforeEach(() => {
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
  act(() => useSavedFlashStore.getState().clear());
});
afterEach(() => vi.useRealTimers());

describe('SavedNotice', () => {
  it('shows the message with Show for an unclaimed save on this profile; Show anchors on the saved id once', async () => {
    const user = userEvent.setup();
    const { onShow } = notice();
    unclaimed(flash());
    expect(screen.getByRole('status')).toHaveTextContent('Expense saved');
    await user.click(screen.getByRole('button', { name: 'Show' }));
    expect(onShow).toHaveBeenCalledWith('e-9');
    expect(useSavedFlashStore.getState().pending?.messaged).toBe(true); // settled on click; the list re-arms once anchored
    expect(screen.queryByText('Expense saved')).not.toBeInTheDocument();
  });

  it('ignores a save from another profile or of another kind', () => {
    notice();
    unclaimed(flash({ profileId: 'p-2' }));
    expect(screen.queryByText('Expense saved')).not.toBeInTheDocument();
    unclaimed(flash({ kind: 'conversion' }));
    expect(screen.queryByText('Expense saved')).not.toBeInTheDocument();
  });

  it('shows a brief "Saved" flash with the animated icon when the list claimed it (MUT-338)', () => {
    notice();
    act(() => {
      const store = useSavedFlashStore.getState();
      store.registerList('list');
      store.markSaved(flash());
      store.reportSettled('list', ['e-9'], true);
    });
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
    expect(screen.getByRole('status').querySelector('[data-part]')).not.toBeNull();
    expect(screen.queryByText('Expense saved')).not.toBeInTheDocument();
  });

  it('hides the claimed flash after FLASH_MS', () => {
    vi.useFakeTimers();
    notice();
    act(() => {
      const store = useSavedFlashStore.getState();
      store.registerList('list');
      store.markSaved(flash());
      store.reportSettled('list', ['e-9'], true);
    });
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
    act(() => vi.advanceTimersByTime(FLASH_MS));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('plays the preset passed in - restrained does not overshoot past scale(1)', async () => {
    notice(vi.fn(), 'restrained');
    act(() => {
      const store = useSavedFlashStore.getState();
      store.registerList('list');
      store.markSaved(flash());
      store.reportSettled('list', ['e-9'], true);
    });
    const parts = Array.from(screen.getByRole('status').querySelectorAll('[data-part]'));
    expect(parts.length).toBeGreaterThan(0);
    await waitFor(() => parts.forEach((part) => expect(scaleOf(part)).toBe(1)), { timeout: 2000 });
  });

  it('hides after NOTICE_MS and does not come back on a remount', () => {
    vi.useFakeTimers();
    const first = notice();
    unclaimed(flash());
    expect(screen.getByText('Expense saved')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(NOTICE_MS));
    expect(screen.queryByText('Expense saved')).not.toBeInTheDocument();
    first.unmount();
    notice();
    expect(screen.queryByText('Expense saved')).not.toBeInTheDocument();
  });

  it('leaving the page while it shows settles it, so returning does not raise it again', () => {
    const first = notice();
    unclaimed(flash());
    expect(screen.getByText('Expense saved')).toBeInTheDocument();
    first.unmount();
    notice();
    expect(screen.queryByText('Expense saved')).not.toBeInTheDocument();
  });

  it('holds while hovered or focused and finishes its time afterwards (WCAG 2.2.1, like the app toast)', () => {
    vi.useFakeTimers();
    notice();
    unclaimed(flash());
    const box = screen.getByRole('status');
    act(() => vi.advanceTimersByTime(NOTICE_MS / 2));
    fireEvent.mouseEnter(box);
    act(() => vi.advanceTimersByTime(NOTICE_MS * 2));
    expect(screen.getByText('Expense saved')).toBeInTheDocument();
    fireEvent.mouseLeave(box);
    fireEvent.focus(screen.getByRole('button', { name: 'Show' }));
    act(() => vi.advanceTimersByTime(NOTICE_MS * 2));
    expect(screen.getByText('Expense saved')).toBeInTheDocument();
    fireEvent.blur(screen.getByRole('button', { name: 'Show' }));
    act(() => vi.advanceTimersByTime(NOTICE_MS / 2 - 10));
    expect(screen.getByText('Expense saved')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(20));
    expect(screen.queryByText('Expense saved')).not.toBeInTheDocument();
  });

  it('a save left behind before its list answered does not greet a later visit', () => {
    vi.useFakeTimers();
    const first = notice();
    act(() => {
      const store = useSavedFlashStore.getState();
      store.registerList('list');
      store.markSaved(flash());
      store.reportSettled('list', ['e-1'], false);
    });
    // Leave the page: the notice and the list unmount before the list settles.
    first.unmount();
    act(() => useSavedFlashStore.getState().deregisterList('list'));
    act(() => vi.advanceTimersByTime(BACKSTOP_MS));
    expect(useSavedFlashStore.getState().claimed).toBe(false);
    notice();
    expect(screen.queryByText('Expense saved')).not.toBeInTheDocument();
  });

  it('does not announce an old claimed save again on a later visit', () => {
    const first = notice();
    act(() => {
      const store = useSavedFlashStore.getState();
      store.registerList('list');
      store.markSaved(flash());
      store.reportSettled('list', ['e-9'], true);
    });
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
    first.unmount();
    notice();
    expect(screen.queryByRole('status')).toBeNull();
  });
});
