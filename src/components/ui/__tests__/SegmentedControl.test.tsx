import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SegmentedControl } from '../SegmentedControl';

const OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'ar', label: 'العربية' },
];

describe('SegmentedControl', () => {
  it('renders a radiogroup with one radio per option, the current value checked', () => {
    render(
      <SegmentedControl options={OPTIONS} value="en" onChange={() => {}} ariaLabel="Language" />,
    );

    const group = screen.getByRole('radiogroup', { name: 'Language' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'English' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'العربية' })).toHaveAttribute('aria-checked', 'false');
  });

  it('calls onChange with the clicked option value', () => {
    const onChange = vi.fn();
    render(<SegmentedControl options={OPTIONS} value="en" onChange={onChange} ariaLabel="Language" />);

    fireEvent.click(screen.getByRole('radio', { name: 'العربية' }));

    expect(onChange).toHaveBeenCalledWith('ar');
  });

  it('does not call onChange when clicking the already-selected option', () => {
    const onChange = vi.fn();
    render(<SegmentedControl options={OPTIONS} value="en" onChange={onChange} ariaLabel="Language" />);

    fireEvent.click(screen.getByRole('radio', { name: 'English' }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('moves selection with arrow keys, wrapping at the ends', () => {
    const onChange = vi.fn();
    const three = [...OPTIONS, { value: 'fr', label: 'Français' }];
    render(<SegmentedControl options={three} value="en" onChange={onChange} ariaLabel="Language" />);

    const english = screen.getByRole('radio', { name: 'English' });
    fireEvent.keyDown(english, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('ar');

    fireEvent.keyDown(english, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenCalledWith('fr');
  });

  it('only one option is in the tab sequence (roving tabindex)', () => {
    render(<SegmentedControl options={OPTIONS} value="ar" onChange={() => {}} ariaLabel="Language" />);

    expect(screen.getByRole('radio', { name: 'English' })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('radio', { name: 'العربية' })).toHaveAttribute('tabindex', '0');
  });

  it('follows the reading direction in RTL and moves focus with the choice (MUT-175)', () => {
    const onChange = vi.fn();
    const three = [...OPTIONS, { value: 'fr', label: 'Français' }];
    render(
      <div dir="rtl">
        <SegmentedControl options={three} value="en" onChange={onChange} ariaLabel="Language" />
      </div>,
    );
    fireEvent.keyDown(screen.getByRole('radio', { name: 'English' }), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('ar');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'العربية' }));
  });

  it('keeps a disabled option reachable but never chooses it, reporting the attempt with its hint (MUT-175)', () => {
    const onChange = vi.fn();
    const onDisabledChoice = vi.fn();
    const withLocked = [...OPTIONS, { value: 'fr', label: 'Français', disabled: true, hint: 'Unlocks in December' }];
    render(<SegmentedControl options={withLocked} value="ar" onChange={onChange} onDisabledChoice={onDisabledChoice} ariaLabel="Language" />);
    const locked = screen.getByRole('radio', { name: 'Français' });
    expect(locked).toHaveAttribute('aria-disabled', 'true');
    expect(locked).toHaveAttribute('aria-description', 'Unlocks in December');
    fireEvent.click(locked);
    fireEvent.keyDown(screen.getByRole('radio', { name: 'العربية' }), { key: 'ArrowRight' });
    expect(onChange).not.toHaveBeenCalled();
    expect(onDisabledChoice).toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe(locked);
  });

  it('accepts labelledBy instead of an inline label', () => {
    render(
      <>
        <span id="lbl">Theme</span>
        <SegmentedControl options={OPTIONS} value="en" onChange={() => {}} labelledBy="lbl" />
      </>,
    );
    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeInTheDocument();
  });
});
