import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ToastContainer } from '../ToastContainer';
import { useToastStore } from '../../../lib/toastStore';

// The app-wide toast container. MUT-82 (D11): a toast's timer waits while the
// pointer is over it or focus is inside it, so an Undo can't vanish under the
// person reaching for it, and resumes with the time that was left.
const DURATION = 5000;

function show(action?: { label: string; onClick: () => void }) {
  act(() => {
    useToastStore.getState().addToast({ message: 'Recorded $100', duration: DURATION, action });
  });
}

const toast = () => (screen.queryByText('Recorded $100')?.closest<HTMLElement>('.toast') ?? null);
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

describe('ToastContainer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
    useToastStore.setState({ toasts: [] });
  });

  it('removes a toast after its duration', () => {
    render(<ToastContainer />);
    show();

    advance(DURATION - 1);
    expect(toast()).not.toBeNull();
    advance(1);
    expect(toast()).toBeNull();
  });

  it('waits while the pointer is over the toast, then gives back the time that was left', () => {
    render(<ToastContainer />);
    show();

    advance(3000);
    fireEvent.mouseEnter(toast()!);
    advance(60_000);
    expect(toast()).not.toBeNull();

    fireEvent.mouseLeave(toast()!);
    advance(1999);
    expect(toast()).not.toBeNull();
    advance(1);
    expect(toast()).toBeNull();
  });

  it('waits while focus is inside the toast', () => {
    render(<ToastContainer />);
    show({ label: 'Undo', onClick: vi.fn() });

    advance(1000);
    act(() => screen.getByRole('button', { name: 'Undo' }).focus());
    advance(60_000);
    expect(toast()).not.toBeNull();

    act(() => screen.getByRole('button', { name: 'Undo' }).blur());
    advance(DURATION - 1000 - 1);
    expect(toast()).not.toBeNull();
    advance(1);
    expect(toast()).toBeNull();
  });

  it('keeps waiting while either the pointer or focus is still on it', () => {
    render(<ToastContainer />);
    show({ label: 'Undo', onClick: vi.fn() });

    fireEvent.mouseEnter(toast()!);
    act(() => screen.getByRole('button', { name: 'Undo' }).focus());
    fireEvent.mouseLeave(toast()!);
    advance(60_000);

    expect(toast()).not.toBeNull();
  });

  it('runs the action once and removes the toast', () => {
    const onClick = vi.fn();
    render(<ToastContainer />);
    show({ label: 'Undo', onClick });

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(toast()).toBeNull();
  });

  it('renders an icon when the toast carries one (MUT-338)', () => {
    render(<ToastContainer />);
    act(() => {
      useToastStore.getState().addToast({
        message: 'Recorded $100',
        duration: DURATION,
        icon: <span data-testid="save-feedback-icon" />,
      });
    });

    expect(toast()!.querySelector('[data-testid="save-feedback-icon"]')).not.toBeNull();
  });

  it('renders no icon wrapper when the toast carries none', () => {
    render(<ToastContainer />);
    show();

    expect(toast()!.querySelector('.toast-icon')).toBeNull();
  });
});
