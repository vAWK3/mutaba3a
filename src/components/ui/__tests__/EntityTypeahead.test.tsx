import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EntityTypeahead, type TypeaheadOption } from '../EntityTypeahead';

const mockOptions: TypeaheadOption[] = [
  { id: '1', label: 'Alpha Project', isNew: false },
  { id: '2', label: 'Beta Corp', isNew: false },
  { id: '3', label: 'Charlie Inc', isNew: false, secondary: '85%' },
];

const mockOptionsWithNew: TypeaheadOption[] = [
  ...mockOptions,
  { id: 'new', label: 'New Item', isNew: true },
];

function renderTypeahead(props: Partial<React.ComponentProps<typeof EntityTypeahead>> = {}) {
  const defaultProps = {
    options: mockOptions,
    inputValue: '',
    onInputChange: vi.fn(),
    onSelect: vi.fn(),
    placeholder: 'Search...',
    createLabel: 'Create new',
  };
  return render(<EntityTypeahead {...defaultProps} {...props} />);
}

describe('EntityTypeahead', () => {
  describe('rendering', () => {
    it('renders input with ARIA attributes', () => {
      renderTypeahead();
      const input = screen.getByRole('combobox');
      expect(input).toBeInTheDocument();
      expect(input).toHaveAttribute('aria-haspopup', 'listbox');
      expect(input).toHaveAttribute('aria-autocomplete', 'list');
      expect(input).toHaveAttribute('aria-expanded', 'false');
    });

    it('renders with placeholder', () => {
      renderTypeahead({ placeholder: 'Type to search...' });
      expect(screen.getByPlaceholderText('Type to search...')).toBeInTheDocument();
    });

    it('renders with disabled state', () => {
      renderTypeahead({ disabled: true });
      expect(screen.getByRole('combobox')).toBeDisabled();
    });

    it('does not show dropdown when closed', () => {
      renderTypeahead();
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });
  });

  describe('dropdown open/close', () => {
    it('opens dropdown on focus', () => {
      renderTypeahead();
      fireEvent.focus(screen.getByRole('combobox'));
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    it('shows all options when open', () => {
      renderTypeahead();
      fireEvent.focus(screen.getByRole('combobox'));
      expect(screen.getAllByRole('option')).toHaveLength(3);
    });

    it('closes dropdown on Escape', () => {
      renderTypeahead();
      const input = screen.getByRole('combobox');
      fireEvent.focus(input);
      expect(screen.getByRole('listbox')).toBeInTheDocument();
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('sets aria-expanded when open', () => {
      renderTypeahead();
      const input = screen.getByRole('combobox');
      fireEvent.focus(input);
      expect(input).toHaveAttribute('aria-expanded', 'true');
    });
  });

  describe('keyboard navigation', () => {
    it('highlights next option on ArrowDown', () => {
      renderTypeahead();
      const input = screen.getByRole('combobox');
      fireEvent.focus(input);
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      const options = screen.getAllByRole('option');
      expect(options[0]).toHaveAttribute('aria-selected', 'true');
    });

    it('highlights previous option on ArrowUp', () => {
      renderTypeahead();
      const input = screen.getByRole('combobox');
      fireEvent.focus(input);
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'ArrowUp' });
      const options = screen.getAllByRole('option');
      expect(options[0]).toHaveAttribute('aria-selected', 'true');
    });

    it('does not go below last option', () => {
      renderTypeahead();
      const input = screen.getByRole('combobox');
      fireEvent.focus(input);
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'ArrowDown' }); // extra
      const options = screen.getAllByRole('option');
      expect(options[2]).toHaveAttribute('aria-selected', 'true');
    });

    it('does not go above first option', () => {
      renderTypeahead();
      const input = screen.getByRole('combobox');
      fireEvent.focus(input);
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'ArrowUp' }); // back to 0
      fireEvent.keyDown(input, { key: 'ArrowUp' }); // stays at 0
      const options = screen.getAllByRole('option');
      expect(options[0]).toHaveAttribute('aria-selected', 'true');
    });

    it('selects highlighted option on Enter', () => {
      const onSelect = vi.fn();
      renderTypeahead({ onSelect });
      const input = screen.getByRole('combobox');
      fireEvent.focus(input);
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onSelect).toHaveBeenCalledWith(mockOptions[0]);
    });

    it('selects only option on Enter when single option and none highlighted', () => {
      const onSelect = vi.fn();
      const singleOption = [mockOptions[0]];
      renderTypeahead({ options: singleOption, onSelect });
      const input = screen.getByRole('combobox');
      fireEvent.focus(input);
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onSelect).toHaveBeenCalledWith(singleOption[0]);
    });

    it('opens dropdown on ArrowDown when closed', () => {
      renderTypeahead();
      const input = screen.getByRole('combobox');
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });
  });

  describe('option selection', () => {
    it('calls onSelect when clicking an option', () => {
      const onSelect = vi.fn();
      renderTypeahead({ onSelect });
      fireEvent.focus(screen.getByRole('combobox'));
      fireEvent.click(screen.getAllByRole('option')[1]);
      expect(onSelect).toHaveBeenCalledWith(mockOptions[1]);
    });

    it('closes dropdown after selection', () => {
      renderTypeahead();
      fireEvent.focus(screen.getByRole('combobox'));
      fireEvent.click(screen.getAllByRole('option')[0]);
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });
  });

  describe('input change', () => {
    it('calls onInputChange when typing', async () => {
      const onInputChange = vi.fn();
      renderTypeahead({ onInputChange });
      const input = screen.getByRole('combobox');
      fireEvent.change(input, { target: { value: 'test' } });
      expect(onInputChange).toHaveBeenCalledWith('test');
    });

    it('opens dropdown when typing', () => {
      renderTypeahead();
      const input = screen.getByRole('combobox');
      fireEvent.change(input, { target: { value: 'a' } });
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });
  });

  describe('create new option', () => {
    it('renders create new option with label', () => {
      renderTypeahead({ options: mockOptionsWithNew, createLabel: 'Create new' });
      fireEvent.focus(screen.getByRole('combobox'));
      expect(screen.getByText('Create new:')).toBeInTheDocument();
      expect(screen.getByText('New Item')).toBeInTheDocument();
    });

    it('create new option has is-new class', () => {
      renderTypeahead({ options: mockOptionsWithNew });
      fireEvent.focus(screen.getByRole('combobox'));
      const options = screen.getAllByRole('option');
      const newOption = options[options.length - 1];
      expect(newOption).toHaveClass('is-new');
    });
  });

  describe('secondary text', () => {
    it('renders secondary text for options that have it', () => {
      renderTypeahead();
      fireEvent.focus(screen.getByRole('combobox'));
      expect(screen.getByText('85%')).toBeInTheDocument();
    });
  });

  describe('mouse interaction', () => {
    it('highlights option on mouse enter', () => {
      renderTypeahead();
      fireEvent.focus(screen.getByRole('combobox'));
      const options = screen.getAllByRole('option');
      fireEvent.mouseEnter(options[2]);
      expect(options[2]).toHaveClass('highlighted');
    });
  });

  describe('empty options', () => {
    it('does not show dropdown when no options', () => {
      renderTypeahead({ options: [] });
      fireEvent.focus(screen.getByRole('combobox'));
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });
  });
});
