import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TruncatedTitle } from '../TruncatedTitle';

const LONG = 'Brand identity, logo suite and launch assets for the spring campaign';
// Longer than the tooltip's hover grace period, so a hide would have happened
const PAST_GRACE_MS = 400;

/** jsdom has no layout: make the title's text report that it is cut. */
function makeCut(button: HTMLElement, cut = true) {
  const text = button.querySelector<HTMLElement>('.truncated-title-text')!;
  Object.defineProperty(text, 'scrollWidth', { configurable: true, value: cut ? 480 : 120 });
  Object.defineProperty(text, 'clientWidth', { configurable: true, value: 120 });
}

function placeAt(button: HTMLElement, rect: { left: number; right: number; top: number; bottom: number }) {
  button.getBoundingClientRect = () =>
    ({ ...rect, x: rect.left, y: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top, toJSON: () => rect }) as DOMRect;
}

const tooltip = () => document.body.querySelector<HTMLElement>('.truncated-title-tooltip');

function renderInRow(onOpen = vi.fn(), onRowClick = vi.fn(), title = LONG) {
  render(
    <table>
      <tbody>
        <tr onClick={onRowClick}>
          <td>
            <TruncatedTitle title={title} onOpen={onOpen} />
          </td>
        </tr>
      </tbody>
    </table>
  );
  return { button: screen.getByRole('button', { name: title }), onOpen, onRowClick };
}

describe('TruncatedTitle (MUT-62)', () => {
  afterEach(() => {
    document.documentElement.dir = '';
  });

  describe('the title', () => {
    it('is a button named by the full title, laid out by its own text direction', () => {
      const { button } = renderInRow();

      expect(button).toHaveAttribute('type', 'button');
      expect(button.querySelector('.truncated-title-text')).toHaveAttribute('dir', 'auto');
    });

    it('opens the record once on click, without the row also handling the click', async () => {
      const user = userEvent.setup();
      const { button, onOpen, onRowClick } = renderInRow();

      await user.click(button);

      expect(onOpen).toHaveBeenCalledTimes(1);
      expect(onRowClick).not.toHaveBeenCalled();
    });

    it('opens the record from the keyboard', async () => {
      const user = userEvent.setup();
      const { onOpen } = renderInRow();

      await user.tab();
      await user.keyboard('{Enter}');

      expect(onOpen).toHaveBeenCalledTimes(1);
    });
  });

  describe('when the title is cut', () => {
    it('shows the full title on hover and hides it after the pointer leaves', async () => {
      const user = userEvent.setup();
      const { button } = renderInRow();
      makeCut(button);

      await user.hover(button);
      expect(tooltip()).toHaveTextContent(LONG);
      expect(tooltip()).toHaveAttribute('aria-hidden', 'true');

      await user.unhover(button);
      await waitFor(() => expect(tooltip()).toBeNull());
    });

    it('stays while the pointer moves onto the tooltip', async () => {
      const user = userEvent.setup();
      const { button } = renderInRow();
      makeCut(button);

      await user.hover(button);
      await user.unhover(button);
      await user.hover(tooltip()!);
      await act(() => new Promise((resolve) => setTimeout(resolve, PAST_GRACE_MS)));

      expect(tooltip()).toHaveTextContent(LONG);
    });

    it('shows the full title on keyboard focus; Escape hides it', async () => {
      const user = userEvent.setup();
      const { button } = renderInRow();
      makeCut(button);

      await user.tab();
      expect(button).toHaveFocus();
      expect(tooltip()).toHaveTextContent(LONG);

      await user.keyboard('{Escape}');
      expect(tooltip()).toBeNull();
      expect(button).toHaveFocus();
    });

    it('hides the tooltip when focus leaves', async () => {
      const user = userEvent.setup();
      const { button } = renderInRow();
      makeCut(button);

      await user.tab();
      expect(tooltip()).not.toBeNull();

      await user.tab();
      expect(tooltip()).toBeNull();
    });

    it('hides the tooltip when the page scrolls', async () => {
      const user = userEvent.setup();
      const { button } = renderInRow();
      makeCut(button);

      await user.hover(button);
      expect(tooltip()).not.toBeNull();

      act(() => {
        window.dispatchEvent(new Event('scroll'));
      });
      expect(tooltip()).toBeNull();
    });

    it('lays the tooltip in Arabic or Latin by the title text', async () => {
      const user = userEvent.setup();
      const { button } = renderInRow(vi.fn(), vi.fn(), 'هوية بصرية كاملة لمقهى في رام الله مع قائمة طعام ولافتات');
      makeCut(button);

      await user.hover(button);
      expect(tooltip()).toHaveAttribute('dir', 'auto');
    });
  });

  describe('where the tooltip goes', () => {
    const rect = { left: 100, right: 300, top: 50, bottom: 70 };

    it('opens below the title at its left edge in a left-to-right page', async () => {
      const user = userEvent.setup();
      const { button } = renderInRow();
      makeCut(button);
      placeAt(button, rect);

      await user.hover(button);

      expect(parseFloat(tooltip()!.style.top)).toBeGreaterThanOrEqual(rect.bottom);
      expect(tooltip()!.style.left).toBe(`${rect.left}px`);
      expect(tooltip()!.style.right).toBe('');
    });

    it('opens at the title right edge in a right-to-left page', async () => {
      document.documentElement.dir = 'rtl';
      const user = userEvent.setup();
      const { button } = renderInRow();
      makeCut(button);
      placeAt(button, rect);

      await user.hover(button);

      expect(tooltip()!.style.right).toBe(`${window.innerWidth - rect.right}px`);
      expect(tooltip()!.style.left).toBe('');
    });
  });

  describe('when the whole title fits', () => {
    it('shows no tooltip on hover or focus', async () => {
      const user = userEvent.setup();
      const { button } = renderInRow(vi.fn(), vi.fn(), 'Site audit');
      makeCut(button, false);

      await user.hover(button);
      expect(tooltip()).toBeNull();

      await user.tab();
      expect(button).toHaveFocus();
      expect(tooltip()).toBeNull();
    });
  });
});
