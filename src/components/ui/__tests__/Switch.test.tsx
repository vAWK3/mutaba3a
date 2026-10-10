import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Switch } from '../Switch';

describe('Switch', () => {
  it('renders as a switch whose aria-checked mirrors the value and is labelled by the given element', () => {
    render(
      <>
        <span id="lbl">Expenses</span>
        <Switch checked={false} onChange={() => {}} labelledBy="lbl" />
      </>,
    );
    const sw = screen.getByRole('switch', { name: 'Expenses' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(sw).toHaveClass('switch-off');
  });

  it('shows the on state', () => {
    render(<Switch checked={true} onChange={() => {}} ariaLabel="Projects" />);
    const sw = screen.getByRole('switch', { name: 'Projects' });
    expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(sw).toHaveClass('switch-on');
  });

  it('calls onChange with the flipped value on click, Space and Enter', () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} ariaLabel="Toggle" />);
    const sw = screen.getByRole('switch');

    fireEvent.click(sw);
    fireEvent.keyDown(sw, { key: ' ' });
    fireEvent.keyDown(sw, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledTimes(3);
    expect(onChange).toHaveBeenNthCalledWith(1, true);
    expect(onChange).toHaveBeenNthCalledWith(2, true);
    expect(onChange).toHaveBeenNthCalledWith(3, true);
  });

  it('ignores other keys', () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} ariaLabel="Toggle" />);
    fireEvent.keyDown(screen.getByRole('switch'), { key: 'a' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does nothing when disabled and says so', () => {
    const onChange = vi.fn();
    render(<Switch checked={true} onChange={onChange} ariaLabel="Toggle" disabled />);
    const sw = screen.getByRole('switch');
    expect(sw).toBeDisabled();
    expect(sw).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(sw);
    fireEvent.keyDown(sw, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
  });
});
