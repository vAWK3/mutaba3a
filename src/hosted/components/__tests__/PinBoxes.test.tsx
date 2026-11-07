import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PIN_MAX, PinBoxes, boxCount, pinDigits } from '../PinBoxes';

function Harness({ onSubmit }: { onSubmit?: () => void }) {
  const [value, setValue] = useState('');
  return (
    <>
      <PinBoxes value={value} onChange={setValue} label="Enter the PIN" onSubmit={onSubmit} />
      <output data-testid="value">{value}</output>
    </>
  );
}

const boxes = () => screen.getAllByRole('textbox');
const value = () => screen.getByTestId('value').textContent;

describe('pinDigits', () => {
  it('reads Arabic-Indic and Eastern Arabic-Indic digits as 0–9 and drops the rest', () => {
    expect(pinDigits('٤٨٢١')).toBe('4821');
    expect(pinDigits('۴۸۲۱')).toBe('4821');
    expect(pinDigits(' 48-21x')).toBe('4821');
  });

  it('shows four boxes, then one more while there is room, up to eight', () => {
    expect(boxCount(0)).toBe(4);
    expect(boxCount(3)).toBe(4);
    expect(boxCount(4)).toBe(5);
    expect(boxCount(PIN_MAX)).toBe(PIN_MAX);
  });
});

describe('PinBoxes', () => {
  it('is one labelled group of boxes, left to right in both languages', () => {
    render(<Harness />);
    const group = screen.getByRole('group', { name: 'Enter the PIN' });
    expect(group).toHaveAttribute('dir', 'ltr');
    expect(boxes()).toHaveLength(4);
    expect(boxes()[0]).toHaveAttribute('inputmode', 'numeric');
    expect(boxes()[0]).toHaveAttribute('autocomplete', 'one-time-code');
  });

  it('typing moves box to box and grows past four', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(boxes()[0]);
    await user.keyboard('48215');
    expect(value()).toBe('48215');
    expect(boxes()).toHaveLength(6);
  });

  it('accepts Arabic-Indic digits typed in', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(boxes()[0]);
    await user.keyboard('٤٨٢١');
    expect(value()).toBe('4821');
  });

  it('backspace clears back across boxes', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(boxes()[0]);
    await user.keyboard('482');
    await user.keyboard('{Backspace}{Backspace}');
    expect(value()).toBe('4');
  });

  it('a paste of six digits fills six boxes', () => {
    render(<Harness />);
    fireEvent.paste(boxes()[0], { clipboardData: { getData: () => '۱۲۳456' } });
    expect(value()).toBe('123456');
    expect(boxes()).toHaveLength(7);
  });

  it('Enter submits', async () => {
    const user = userEvent.setup();
    let submitted = 0;
    render(<Harness onSubmit={() => (submitted += 1)} />);
    await user.click(boxes()[0]);
    await user.keyboard('4821{Enter}');
    expect(submitted).toBe(1);
  });
});
