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
