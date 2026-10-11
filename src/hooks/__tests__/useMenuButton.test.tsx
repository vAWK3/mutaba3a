/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useMenuButton } from '../useMenuButton';

function TestMenu({ onPick = vi.fn() }: { onPick?: (item: string) => void }) {
  const menu = useMenuButton();
  return (
    <div>
      <button type="button">before</button>
      <button type="button" {...menu.buttonProps}>
        open
      </button>
      {menu.isOpen && (
        <div {...menu.menuProps}>
          {['one', 'two', 'three'].map((item) => (
            <button
              key={item}
              type="button"
              role="menuitem"
              onClick={() => {
                menu.close();
                onPick(item);
              }}
            >
              {item}
            </button>
          ))}
        </div>
      )}
      <button type="button">outside</button>
    </div>
  );
}

const trigger = () => screen.getByRole('button', { name: 'open' });
const item = (name: string) => screen.getByRole('menuitem', { name });

describe('useMenuButton (MUT-15)', () => {
  it('wires the button to the menu for assistive technology', () => {
    render(<TestMenu />);
    expect(trigger()).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger());
    const menu = screen.getByRole('menu');
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    expect(trigger()).toHaveAttribute('aria-controls', menu.id);
  });

  it('focuses the first item when the menu opens', () => {
    render(<TestMenu />);
    fireEvent.click(trigger());
    expect(item('one')).toHaveFocus();
  });

  it('moves with the arrow keys and wraps at both ends', () => {
    render(<TestMenu />);
    fireEvent.click(trigger());
    const menu = screen.getByRole('menu');

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(item('two')).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(item('one')).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(item('three')).toHaveFocus();
  });

  it('jumps with Home and End', () => {
    render(<TestMenu />);
    fireEvent.click(trigger());
    const menu = screen.getByRole('menu');

    fireEvent.keyDown(menu, { key: 'End' });
    expect(item('three')).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(item('one')).toHaveFocus();
  });

  it('opens from the button with ArrowDown (first item) and ArrowUp (last item)', () => {
    render(<TestMenu />);
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    expect(item('one')).toHaveFocus();

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    fireEvent.keyDown(trigger(), { key: 'ArrowUp' });
    expect(item('three')).toHaveFocus();
  });

  it('closes on Escape and gives focus back to the button', () => {
    render(<TestMenu />);
    fireEvent.click(trigger());
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it('closes on Escape pressed while the button itself has focus', () => {
    render(<TestMenu />);
    fireEvent.click(trigger());
    trigger().focus();
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it('closes when Tab moves focus out of the menu', () => {
    render(<TestMenu />);
    fireEvent.click(trigger());
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Tab' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on a click outside, and not on a click inside', () => {
    render(<TestMenu />);
    fireEvent.click(trigger());
    fireEvent.mouseDown(screen.getByRole('menu'));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole('button', { name: 'outside' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('toggles closed when the button is clicked again', () => {
    render(<TestMenu />);
    fireEvent.click(trigger());
    fireEvent.mouseDown(trigger());
    fireEvent.click(trigger());
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('runs the picked item and closes without stealing focus back', () => {
    const onPick = vi.fn();
    render(<TestMenu onPick={onPick} />);
    fireEvent.click(trigger());
    fireEvent.click(item('two'));

    expect(onPick).toHaveBeenCalledWith('two');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger()).not.toHaveFocus();
  });
});
