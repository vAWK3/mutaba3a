import { StrictMode, useState, type ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { DrawerFrame } from '../DrawerFrame';

const WIDTH = 480;
const SETTLE = { timeout: 2000 };

// jsdom lays nothing out, so a panel has no width and the frame skips motion
// (D11). These tests give `.drawer` a width to exercise the springs.
function giveDrawersLayout() {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('drawer') ? WIDTH : 0;
  });
}

const matchMedia = window.matchMedia as Mock;
const defaultMatchMedia = matchMedia.getMockImplementation();

function preferReducedMotion() {
  matchMedia.mockImplementation((query: string) => ({
    ...defaultMatchMedia!(query),
    matches: query.includes('prefers-reduced-motion'),
  }));
}

afterEach(() => {
  vi.restoreAllMocks();
  matchMedia.mockImplementation(defaultMatchMedia!);
  document.documentElement.removeAttribute('dir');
});

function Harness({
  onClose,
  initiallyOpen = true,
  children,
}: {
  onClose: () => void;
  initiallyOpen?: boolean;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <input aria-label="Elsewhere" />
      {open && (
        <DrawerFrame
          title="New Income"
          closeLabel="Close"
          onClose={() => {
            onClose();
            setOpen(false);
          }}
          footer={<button type="button">Save</button>}
        >
          {children ?? <p>Amount</p>}
        </DrawerFrame>
      )}
    </>
  );
}

const livePanel = () => document.querySelector<HTMLElement>('.drawer:not([aria-hidden])');
const liveOverlay = () => document.querySelector<HTMLElement>('.drawer-overlay:not([aria-hidden])');
const snapshotPanel = () => document.querySelector<HTMLElement>('.drawer[aria-hidden="true"]');

function translateOf(el: HTMLElement): number {
  const match = /translateX\((-?[\d.]+)px\)/.exec(el.style.transform);
  return match ? Number(match[1]) : 0;
}

async function waitForRest() {
  await waitFor(() => {
    expect(livePanel()!.style.transform).toBe('');
    expect(livePanel()!.style.opacity).toBe('');
  }, SETTLE);
}

const sleep = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

const pointer = (x: number, y = 200) => ({ clientX: x, clientY: y, pointerId: 1, isPrimary: true, button: 0 });

/** Press at `from`, move through `path` at once, pause so the release is slow, then release at the last point. */
async function slowDrag(target: HTMLElement, from: number, path: Array<[number, number?]>) {
  fireEvent.pointerDown(target, pointer(from));
  for (const [x, y] of path) fireEvent.pointerMove(livePanel()!, pointer(x, y));
  await sleep(150);
  const [lastX, lastY] = path[path.length - 1];
  fireEvent.pointerUp(livePanel()!, pointer(lastX, lastY));
}

describe('DrawerFrame', () => {
  describe('shell', () => {
    it('is a modal dialog named by its title, with a labelled close button', () => {
      render(<Harness onClose={vi.fn()} />);
      const dialog = screen.getByRole('dialog', { name: 'New Income' });
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    });

    it('calls onClose at once for Escape, the close button and the overlay', () => {
      const onClose = vi.fn();
      const { unmount } = render(<Harness onClose={onClose} />);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
      unmount();

      render(<Harness onClose={onClose} />);
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      expect(onClose).toHaveBeenCalledTimes(2);

      fireEvent.click(screen.getByRole('button', { name: 'Open' }));
      fireEvent.click(liveOverlay()!);
      expect(onClose).toHaveBeenCalledTimes(3);
    });
  });

  describe('without layout', () => {
    it('neither animates in nor leaves a snapshot behind', async () => {
      render(<Harness onClose={vi.fn()} />);
      expect(livePanel()!.style.transform).toBe('');
      expect(livePanel()!.style.opacity).toBe('');

      fireEvent.keyDown(document, { key: 'Escape' });
      await act(async () => {});

      expect(document.querySelector('.drawer')).toBeNull();
      expect(document.querySelector('.drawer-overlay')).toBeNull();
    });
  });

  describe('enter and exit', () => {
    beforeEach(giveDrawersLayout);

    it('springs in from the edge and comes to rest with no inline transform', async () => {
      render(<Harness onClose={vi.fn()} />);
      expect(translateOf(livePanel()!)).toBe(WIDTH + 32);
      expect(liveOverlay()!.style.opacity).toBe('0');
      await waitForRest();
      expect(liveOverlay()!.style.opacity).toBe('');
    });

    it('leaves along the same edge after the dialog has already closed', async () => {
      const onClose = vi.fn();
      render(<Harness onClose={onClose} />);
      await waitForRest();

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('dialog')).toBeNull();
      await waitFor(() => expect(snapshotPanel()).not.toBeNull());
      expect(snapshotPanel()).toHaveTextContent('New Income');
      await waitFor(() => expect(translateOf(snapshotPanel()!)).toBeGreaterThan(0));
      await waitFor(() => expect(snapshotPanel()).toBeNull(), SETTLE);
      expect(document.querySelector('.drawer-overlay')).toBeNull();
    });

    it('leaves toward the left edge in RTL', async () => {
      document.documentElement.dir = 'rtl';
      render(<Harness onClose={vi.fn()} />);
      expect(translateOf(livePanel()!)).toBe(-(WIDTH + 32));
      await waitForRest();

      fireEvent.keyDown(document, { key: 'Escape' });

      await waitFor(() => expect(translateOf(snapshotPanel()!)).toBeLessThan(0));
      await waitFor(() => expect(snapshotPanel()).toBeNull(), SETTLE);
    });

    it('leaves no snapshot behind under StrictMode', async () => {
      render(
        <StrictMode>
          <Harness onClose={vi.fn()} />
        </StrictMode>,
      );
      // The rehearsal unmount would attach its snapshot in a microtask.
      await act(async () => {});
      expect(snapshotPanel()).toBeNull();
      await waitForRest();
      expect(document.querySelectorAll('.drawer')).toHaveLength(1);
      expect(snapshotPanel()).toBeNull();
    });
  });

  describe('reduced motion', () => {
    beforeEach(() => {
      giveDrawersLayout();
      preferReducedMotion();
    });

    it('cross-fades in and out without moving', async () => {
      render(<Harness onClose={vi.fn()} />);
      expect(livePanel()!.style.transform).toBe('');
      expect(Number(livePanel()!.style.opacity)).toBeLessThan(1);
      await waitForRest();

      fireEvent.keyDown(document, { key: 'Escape' });

      await waitFor(() => expect(snapshotPanel()).not.toBeNull());
      await waitFor(() => expect(Number(snapshotPanel()!.style.opacity)).toBeLessThan(1));
      expect(snapshotPanel()!.style.transform).toBe('');
      await waitFor(() => expect(snapshotPanel()).toBeNull(), SETTLE);
    });
  });

  describe('drag', () => {
    beforeEach(giveDrawersLayout);

    it('dismisses a slow drag past half the width, calling onClose once it is off-screen', async () => {
      const onClose = vi.fn();
      render(<Harness onClose={onClose} />);
      await waitForRest();

      await slowDrag(livePanel()!, 100, [[105], [400]]);

      expect(onClose).not.toHaveBeenCalled();
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1), SETTLE);
      await act(async () => {});
      expect(snapshotPanel()).toBeNull();
    });

    it('springs back after a slow drag short of half', async () => {
      const onClose = vi.fn();
      render(<Harness onClose={onClose} />);
      await waitForRest();

      await slowDrag(livePanel()!, 100, [[105], [300]]);

      expect(translateOf(livePanel()!)).toBeGreaterThan(0);
      await waitForRest();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('follows the pointer 1:1 and dims the overlay by the same progress', async () => {
      render(<Harness onClose={vi.fn()} />);
      await waitForRest();

      fireEvent.pointerDown(livePanel()!, pointer(100));
      fireEvent.pointerMove(livePanel()!, pointer(112));
      fireEvent.pointerMove(livePanel()!, pointer(340));

      expect(translateOf(livePanel()!)).toBe(240);
      expect(Number(liveOverlay()!.style.opacity)).toBeCloseTo(0.5, 5);
      expect(livePanel()).toHaveClass('is-dragging');
    });

    it('leaves a vertical gesture to scrolling', async () => {
      render(<Harness onClose={vi.fn()} />);
      await waitForRest();

      fireEvent.pointerDown(livePanel()!, pointer(100, 100));
      fireEvent.pointerMove(livePanel()!, pointer(102, 130));
      fireEvent.pointerMove(livePanel()!, pointer(400, 130));

      expect(livePanel()!.style.transform).toBe('');
    });

    it('never starts from a text field', async () => {
      render(
        <Harness onClose={vi.fn()}>
          <input aria-label="Amount" />
        </Harness>,
      );
      await waitForRest();

      fireEvent.pointerDown(screen.getByLabelText('Amount'), pointer(100));
      fireEvent.pointerMove(livePanel()!, pointer(400));

      expect(livePanel()!.style.transform).toBe('');
    });

    it('dismisses by dragging left in RTL', async () => {
      document.documentElement.dir = 'rtl';
      const onClose = vi.fn();
      render(<Harness onClose={onClose} />);
      await waitForRest();

      await slowDrag(livePanel()!, 400, [[395], [100]]);

      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1), SETTLE);
    });

    it('can be caught mid-exit and pulled back open', async () => {
      const onClose = vi.fn();
      render(<Harness onClose={onClose} />);
      await waitForRest();

      await slowDrag(livePanel()!, 100, [[105], [400]]);
      // Caught while it is leaving: drag back past fully open and let go slowly.
      await slowDrag(livePanel()!, 400, [[395], [0]]);

      await waitForRest();
      await sleep(400);
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('focus', () => {
    it('moves focus into the dialog when no field takes it', async () => {
      render(<Harness onClose={vi.fn()} />);
      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('dialog')));
    });

    it("keeps a field's autoFocus", async () => {
      render(
        <Harness onClose={vi.fn()}>
          <input aria-label="Amount" autoFocus />
        </Harness>,
      );
      await act(async () => {});
      expect(document.activeElement).toBe(screen.getByLabelText('Amount'));
    });

    it('wraps Tab and Shift+Tab at the ends', () => {
      render(<Harness onClose={vi.fn()} />);
      const close = screen.getByRole('button', { name: 'Close' });
      const save = screen.getByRole('button', { name: 'Save' });

      save.focus();
      fireEvent.keyDown(save, { key: 'Tab' });
      expect(document.activeElement).toBe(close);

      fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
      expect(document.activeElement).toBe(save);
    });

    it('returns focus to the button that opened it', async () => {
      render(<Harness onClose={vi.fn()} initiallyOpen={false} />);
      const open = screen.getByRole('button', { name: 'Open' });
      open.focus();
      fireEvent.click(open);
      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('dialog')));

      fireEvent.keyDown(document, { key: 'Escape' });

      await waitFor(() => expect(document.activeElement).toBe(open));
    });

    it('does not take focus back from something that took it', async () => {
      render(<Harness onClose={() => screen.getByLabelText('Elsewhere').focus()} initiallyOpen={false} />);
      const open = screen.getByRole('button', { name: 'Open' });
      open.focus();
      fireEvent.click(open);
      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('dialog')));

      fireEvent.keyDown(document, { key: 'Escape' });
      await act(async () => {});

      expect(document.activeElement).toBe(screen.getByLabelText('Elsewhere'));
    });
  });
});
