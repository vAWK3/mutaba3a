import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StepperInput } from '../StepperInput';

describe('StepperInput', () => {
  describe('basic rendering', () => {
    it('should render input with value', () => {
      render(<StepperInput value={5} onChange={() => {}} />);
      expect(screen.getByRole('textbox')).toHaveValue('5');
    });

    it('should render increment and decrement buttons', () => {
      render(<StepperInput value={5} onChange={() => {}} />);
      expect(screen.getByLabelText('Increase')).toBeInTheDocument();
      expect(screen.getByLabelText('Decrease')).toBeInTheDocument();
    });

    it('should render with placeholder', () => {
      render(<StepperInput value={0} onChange={() => {}} placeholder="Enter value" />);
      expect(screen.getByPlaceholderText('Enter value')).toBeInTheDocument();
    });
  });

  describe('label', () => {
    it('should render label when provided', () => {
      render(<StepperInput value={5} onChange={() => {}} label="Quantity" />);
      expect(screen.getByText('Quantity')).toBeInTheDocument();
    });

    it('should associate label with input', () => {
      render(<StepperInput value={5} onChange={() => {}} label="Quantity" />);
      const input = screen.getByRole('textbox');
      expect(input).toHaveAttribute('id', 'stepper-quantity');
    });

    it('should use custom id over generated', () => {
      render(<StepperInput value={5} onChange={() => {}} label="Quantity" id="custom-id" />);
      const input = screen.getByRole('textbox');
      expect(input).toHaveAttribute('id', 'custom-id');
    });
  });

  describe('error state', () => {
    it('should render error message', () => {
      render(<StepperInput value={5} onChange={() => {}} error="Invalid value" />);
      expect(screen.getByRole('alert')).toHaveTextContent('Invalid value');
    });

    it('should set aria-invalid when error present', () => {
      render(<StepperInput value={5} onChange={() => {}} error="Invalid" />);
      expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
    });

    it('should apply error class to group', () => {
      const { container } = render(<StepperInput value={5} onChange={() => {}} error="Invalid" />);
      expect(container.querySelector('.stepper-error')).toBeInTheDocument();
    });
  });

  describe('increment button', () => {
    it('should call onChange with incremented value', () => {
      const onChange = vi.fn();
      render(<StepperInput value={5} onChange={onChange} />);

      fireEvent.click(screen.getByLabelText('Increase'));
      expect(onChange).toHaveBeenCalledWith(6);
    });

    it('should use custom step', () => {
      const onChange = vi.fn();
      render(<StepperInput value={5} onChange={onChange} step={5} />);

      fireEvent.click(screen.getByLabelText('Increase'));
      expect(onChange).toHaveBeenCalledWith(10);
    });

    it('should respect max constraint', () => {
      const onChange = vi.fn();
      render(<StepperInput value={10} onChange={onChange} max={10} />);

      // Button should be disabled
      expect(screen.getByLabelText('Increase')).toBeDisabled();
    });

    it('should clamp to max when incrementing', () => {
      const onChange = vi.fn();
      render(<StepperInput value={8} onChange={onChange} max={10} step={5} />);

      fireEvent.click(screen.getByLabelText('Increase'));
      expect(onChange).toHaveBeenCalledWith(10);
    });

    it('should be disabled when component is disabled', () => {
      render(<StepperInput value={5} onChange={() => {}} disabled />);
      expect(screen.getByLabelText('Increase')).toBeDisabled();
    });
  });

  describe('decrement button', () => {
    it('should call onChange with decremented value', () => {
      const onChange = vi.fn();
      render(<StepperInput value={5} onChange={onChange} />);

      fireEvent.click(screen.getByLabelText('Decrease'));
      expect(onChange).toHaveBeenCalledWith(4);
    });

    it('should use custom step', () => {
      const onChange = vi.fn();
      render(<StepperInput value={10} onChange={onChange} step={5} />);

      fireEvent.click(screen.getByLabelText('Decrease'));
      expect(onChange).toHaveBeenCalledWith(5);
    });

    it('should respect min constraint', () => {
      const onChange = vi.fn();
      render(<StepperInput value={0} onChange={onChange} min={0} />);

      // Button should be disabled
      expect(screen.getByLabelText('Decrease')).toBeDisabled();
    });

    it('should clamp to min when decrementing', () => {
      const onChange = vi.fn();
      render(<StepperInput value={3} onChange={onChange} min={0} step={5} />);

      fireEvent.click(screen.getByLabelText('Decrease'));
      expect(onChange).toHaveBeenCalledWith(0);
    });

    it('should be disabled when component is disabled', () => {
      render(<StepperInput value={5} onChange={() => {}} disabled />);
      expect(screen.getByLabelText('Decrease')).toBeDisabled();
    });
  });

  describe('keyboard navigation', () => {
    it('should increment on ArrowUp', () => {
      const onChange = vi.fn();
      render(<StepperInput value={5} onChange={onChange} />);
      const input = screen.getByRole('textbox');

      fireEvent.keyDown(input, { key: 'ArrowUp' });
      expect(onChange).toHaveBeenCalledWith(6);
    });

    it('should decrement on ArrowDown', () => {
      const onChange = vi.fn();
      render(<StepperInput value={5} onChange={onChange} />);
      const input = screen.getByRole('textbox');

      fireEvent.keyDown(input, { key: 'ArrowDown' });
      expect(onChange).toHaveBeenCalledWith(4);
    });
  });

  describe('direct input', () => {
    it('should parse and update value on input change', () => {
      const onChange = vi.fn();
      render(<StepperInput value={5} onChange={onChange} />);

      fireEvent.change(screen.getByRole('textbox'), { target: { value: '10' } });
      expect(onChange).toHaveBeenCalledWith(10);
    });

    it('should handle empty input', () => {
      const onChange = vi.fn();
      render(<StepperInput value={5} onChange={onChange} min={0} />);

      fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
      expect(onChange).toHaveBeenCalledWith(0);
    });

    it('should handle minus sign input', () => {
      const onChange = vi.fn();
      render(<StepperInput value={5} onChange={onChange} min={-10} />);

      fireEvent.change(screen.getByRole('textbox'), { target: { value: '-' } });
      expect(onChange).toHaveBeenCalledWith(-10);
    });

    it('should clamp input to min/max', () => {
      const onChange = vi.fn();
      render(<StepperInput value={5} onChange={onChange} min={0} max={10} />);

      fireEvent.change(screen.getByRole('textbox'), { target: { value: '100' } });
      expect(onChange).toHaveBeenCalledWith(10);
    });

    it('should ignore invalid input', () => {
      const onChange = vi.fn();
      render(<StepperInput value={5} onChange={onChange} />);

      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'abc' } });
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe('custom formatters', () => {
    it('should use custom formatDisplay', () => {
      render(
        <StepperInput
          value={50}
          onChange={() => {}}
          formatDisplay={(v) => `${v}%`}
        />
      );
      expect(screen.getByRole('textbox')).toHaveValue('50%');
    });

    it('should use custom parseInput', () => {
      const onChange = vi.fn();
      render(
        <StepperInput
          value={50}
          onChange={onChange}
          parseInput={(s) => parseInt(s.replace('%', ''), 10)}
        />
      );

      fireEvent.change(screen.getByRole('textbox'), { target: { value: '75%' } });
      expect(onChange).toHaveBeenCalledWith(75);
    });
  });

  describe('disabled state', () => {
    it('should disable input when disabled', () => {
      render(<StepperInput value={5} onChange={() => {}} disabled />);
      expect(screen.getByRole('textbox')).toBeDisabled();
    });

    it('should not call onChange when disabled and clicking buttons', () => {
      const onChange = vi.fn();
      render(<StepperInput value={5} onChange={onChange} disabled />);

      // Buttons are disabled, clicking should not trigger onChange
      expect(screen.getByLabelText('Increase')).toBeDisabled();
      expect(screen.getByLabelText('Decrease')).toBeDisabled();
    });
  });

  describe('className', () => {
    it('should apply custom className to wrapper', () => {
      const { container } = render(
        <StepperInput value={5} onChange={() => {}} className="custom-stepper" />
      );
      expect(container.querySelector('.stepper-wrapper.custom-stepper')).toBeInTheDocument();
    });
  });

  describe('decimal values', () => {
    it('should handle decimal values', () => {
      const onChange = vi.fn();
      render(<StepperInput value={0.5} onChange={onChange} step={0.1} />);

      fireEvent.click(screen.getByLabelText('Increase'));
      expect(onChange).toHaveBeenCalledWith(0.6);
    });

    it('should parse decimal input', () => {
      const onChange = vi.fn();
      render(<StepperInput value={1} onChange={onChange} />);

      fireEvent.change(screen.getByRole('textbox'), { target: { value: '3.14' } });
      expect(onChange).toHaveBeenCalledWith(3.14);
    });
  });
});
