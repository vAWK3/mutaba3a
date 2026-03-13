import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Input, Textarea, Select } from '../Input';

describe('Input', () => {
  describe('basic rendering', () => {
    it('should render an input element', () => {
      render(<Input />);
      expect(screen.getByRole('textbox')).toBeInTheDocument();
    });

    it('should have input class', () => {
      render(<Input />);
      expect(screen.getByRole('textbox')).toHaveClass('input');
    });
  });

  describe('label', () => {
    it('should render label when provided', () => {
      render(<Input label="Email" />);
      expect(screen.getByText('Email')).toBeInTheDocument();
    });

    it('should associate label with input', () => {
      render(<Input label="Email" />);
      const input = screen.getByRole('textbox');
      const label = screen.getByText('Email');
      expect(input).toHaveAttribute('id');
      expect(label).toHaveAttribute('for', input.getAttribute('id'));
    });

    it('should generate id from label text', () => {
      render(<Input label="User Name" />);
      const input = screen.getByRole('textbox');
      expect(input).toHaveAttribute('id', 'input-user-name');
    });

    it('should use provided id over generated', () => {
      render(<Input id="custom-id" label="Email" />);
      expect(screen.getByRole('textbox')).toHaveAttribute('id', 'custom-id');
    });
  });

  describe('error state', () => {
    it('should render error message', () => {
      render(<Input error="Invalid email" />);
      expect(screen.getByText('Invalid email')).toBeInTheDocument();
    });

    it('should have error class', () => {
      render(<Input error="Invalid" />);
      expect(screen.getByRole('textbox')).toHaveClass('input-error');
    });

    it('should have role="alert" on error message', () => {
      render(<Input error="Invalid" />);
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('should set aria-invalid', () => {
      render(<Input error="Invalid" />);
      expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
    });

    it('should reference error with aria-describedby', () => {
      render(<Input id="email" error="Invalid" />);
      const input = screen.getByRole('textbox');
      expect(input).toHaveAttribute('aria-describedby', 'email-error');
    });
  });

  describe('hint', () => {
    it('should render hint when provided', () => {
      render(<Input hint="Enter your email address" />);
      expect(screen.getByText('Enter your email address')).toBeInTheDocument();
    });

    it('should not render hint when error is present', () => {
      render(<Input hint="Hint text" error="Error text" />);
      expect(screen.queryByText('Hint text')).not.toBeInTheDocument();
      expect(screen.getByText('Error text')).toBeInTheDocument();
    });

    it('should reference hint with aria-describedby', () => {
      render(<Input id="email" hint="Your email" />);
      const input = screen.getByRole('textbox');
      expect(input).toHaveAttribute('aria-describedby', 'email-hint');
    });
  });

  describe('props forwarding', () => {
    it('should forward type prop', () => {
      const { container } = render(<Input type="password" />);
      const input = container.querySelector('input[type="password"]');
      expect(input).toBeInTheDocument();
    });

    it('should forward value and onChange', () => {
      const onChange = vi.fn();
      render(<Input value="test" onChange={onChange} />);

      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'new' } });
      expect(onChange).toHaveBeenCalled();
    });

    it('should forward placeholder', () => {
      render(<Input placeholder="Enter text" />);
      expect(screen.getByPlaceholderText('Enter text')).toBeInTheDocument();
    });

    it('should forward disabled', () => {
      render(<Input disabled />);
      expect(screen.getByRole('textbox')).toBeDisabled();
    });

    it('should forward className', () => {
      render(<Input className="custom" />);
      expect(screen.getByRole('textbox')).toHaveClass('custom');
    });
  });
});

describe('Textarea', () => {
  describe('basic rendering', () => {
    it('should render a textarea element', () => {
      render(<Textarea />);
      expect(screen.getByRole('textbox')).toBeInTheDocument();
      expect(screen.getByRole('textbox').tagName).toBe('TEXTAREA');
    });

    it('should have textarea class', () => {
      render(<Textarea />);
      expect(screen.getByRole('textbox')).toHaveClass('textarea');
    });
  });

  describe('label', () => {
    it('should render label when provided', () => {
      render(<Textarea label="Description" />);
      expect(screen.getByText('Description')).toBeInTheDocument();
    });

    it('should generate id with textarea prefix', () => {
      render(<Textarea label="Notes" />);
      expect(screen.getByRole('textbox')).toHaveAttribute('id', 'textarea-notes');
    });
  });

  describe('error state', () => {
    it('should render error message', () => {
      render(<Textarea error="Required field" />);
      expect(screen.getByText('Required field')).toBeInTheDocument();
    });

    it('should have error class', () => {
      render(<Textarea error="Required" />);
      expect(screen.getByRole('textbox')).toHaveClass('input-error');
    });
  });

  describe('hint', () => {
    it('should render hint when provided', () => {
      render(<Textarea hint="Enter description" />);
      expect(screen.getByText('Enter description')).toBeInTheDocument();
    });
  });
});

describe('Select', () => {
  describe('basic rendering', () => {
    it('should render a select element', () => {
      render(
        <Select>
          <option value="1">Option 1</option>
        </Select>
      );
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    it('should have select class', () => {
      render(
        <Select>
          <option value="1">Option 1</option>
        </Select>
      );
      expect(screen.getByRole('combobox')).toHaveClass('select');
    });

    it('should render children options', () => {
      render(
        <Select>
          <option value="1">Option 1</option>
          <option value="2">Option 2</option>
        </Select>
      );
      expect(screen.getByRole('option', { name: 'Option 1' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Option 2' })).toBeInTheDocument();
    });
  });

  describe('label', () => {
    it('should render label when provided', () => {
      render(
        <Select label="Category">
          <option value="1">Option 1</option>
        </Select>
      );
      expect(screen.getByText('Category')).toBeInTheDocument();
    });

    it('should generate id with select prefix', () => {
      render(
        <Select label="Status">
          <option value="1">Option 1</option>
        </Select>
      );
      expect(screen.getByRole('combobox')).toHaveAttribute('id', 'select-status');
    });
  });

  describe('error state', () => {
    it('should render error message', () => {
      render(
        <Select error="Please select an option">
          <option value="1">Option 1</option>
        </Select>
      );
      expect(screen.getByText('Please select an option')).toBeInTheDocument();
    });

    it('should have error class', () => {
      render(
        <Select error="Required">
          <option value="1">Option 1</option>
        </Select>
      );
      expect(screen.getByRole('combobox')).toHaveClass('input-error');
    });
  });

  describe('hint', () => {
    it('should render hint when provided', () => {
      render(
        <Select hint="Choose one">
          <option value="1">Option 1</option>
        </Select>
      );
      expect(screen.getByText('Choose one')).toBeInTheDocument();
    });
  });

  describe('onChange', () => {
    it('should call onChange when selection changes', () => {
      const onChange = vi.fn();
      render(
        <Select onChange={onChange}>
          <option value="1">Option 1</option>
          <option value="2">Option 2</option>
        </Select>
      );

      fireEvent.change(screen.getByRole('combobox'), { target: { value: '2' } });
      expect(onChange).toHaveBeenCalled();
    });
  });
});
