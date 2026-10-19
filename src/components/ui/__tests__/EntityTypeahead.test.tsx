import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
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

// Controlled like every real picker: the parent keeps the typed text and passes it back
function renderTypeahead(props: Partial<React.ComponentProps<typeof EntityTypeahead>> = {}) {
  const { inputValue: initialValue = '', onInputChange = vi.fn(), ...rest } = props;
  function Harness() {
    const [value, setValue] = useState(initialValue);
    return (
      <EntityTypeahead
        options={mockOptions}
        onSelect={vi.fn()}
        placeholder="Search..."
        createLabel="Create new"
        {...rest}
        inputValue={value}
        onInputChange={(next) => {
          setValue(next);
          onInputChange(next);
        }}
      />
    );
  }
  return render(<Harness />);
}

function ControlledInForm({ onSelect }: { onSelect: (option: TypeaheadOption) => void }) {
  const [value, setValue] = useState('');
  return <EntityTypeahead options={mockOptions} inputValue={value} onInputChange={setValue} onSelect={onSelect} />;
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

    // MUT-5 review: with nothing typed the field is empty or shows a picked
    // value, so Enter belongs to the form even while the list is showing.
    it('lets Enter through when nothing was typed, even with one option listed', () => {
      const onSelect = vi.fn();
      const singleOption = [mockOptions[0]];
      renderTypeahead({ options: singleOption, onSelect });
      const input = screen.getByRole('combobox');
      fireEvent.focus(input);
      expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(true);
      expect(onSelect).not.toHaveBeenCalled();
    });

    it('opens dropdown on ArrowDown when closed', () => {
      renderTypeahead();
      const input = screen.getByRole('combobox');
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    it('closes on Tab without picking anything', () => {
      const onSelect = vi.fn();
      renderTypeahead({ onSelect });
      const input = screen.getByRole('combobox');
      fireEvent.change(input, { target: { value: 'a' } });
      fireEvent.keyDown(input, { key: 'Tab' });
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      expect(onSelect).not.toHaveBeenCalled();
    });
  });

  // MUT-5: one keyboard model for every picker (Client, Project, Vendor, hosted pickers)
  describe('keyboard contract (MUT-5)', () => {
    it('highlights the first option as soon as the user types', () => {
      renderTypeahead();
      const input = screen.getByRole('combobox');
      fireEvent.change(input, { target: { value: 'a' } });
      expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    });

    it('drops the highlight when the input is cleared', () => {
      function Controlled() {
        const [value, setValue] = useState('');
        return <EntityTypeahead options={mockOptions} inputValue={value} onInputChange={setValue} onSelect={vi.fn()} />;
      }
      render(<Controlled />);
      const input = screen.getByRole('combobox');
      fireEvent.change(input, { target: { value: 'a' } });
      fireEvent.change(input, { target: { value: '' } });
      for (const option of screen.getAllByRole('option')) {
        expect(option).toHaveAttribute('aria-selected', 'false');
      }
    });

    it('picks the first match on Enter right after typing', () => {
      const onSelect = vi.fn();
      renderTypeahead({ onSelect });
      const input = screen.getByRole('combobox');
      fireEvent.change(input, { target: { value: 'a' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onSelect).toHaveBeenCalledWith(mockOptions[0]);
    });

    it('picks the create option on Enter when it is the only one', () => {
      const onSelect = vi.fn();
      const createOnly: TypeaheadOption[] = [{ id: 'new', label: 'Newco', isNew: true }];
      renderTypeahead({ options: createOnly, onSelect });
      const input = screen.getByRole('combobox');
      fireEvent.change(input, { target: { value: 'Newco' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onSelect).toHaveBeenCalledWith(createOnly[0]);
    });

    it('lets Enter through on a closed list, so the surrounding form submits', async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
      const onSelect = vi.fn();
      render(
        <form onSubmit={onSubmit}>
          <ControlledInForm onSelect={onSelect} />
          <button type="submit">Save</button>
        </form>
      );
      const input = screen.getByRole('combobox');
      await user.click(input);
      await user.keyboard('A');
      await user.keyboard('{Enter}'); // picks the highlighted match and closes the list
      expect(onSelect).toHaveBeenCalledWith(mockOptions[0]);
      expect(onSubmit).not.toHaveBeenCalled();

      await user.keyboard('{Enter}'); // list closed: Enter belongs to the form
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('does not swallow Enter on a closed list', () => {
      renderTypeahead();
      const input = screen.getByRole('combobox');
      // fireEvent returns false when a handler called preventDefault()
      expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(true);
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('treats an open list with no options as closed', () => {
      renderTypeahead({ options: [] });
      const input = screen.getByRole('combobox');
      fireEvent.focus(input);
      expect(input).toHaveAttribute('aria-expanded', 'false');
      expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(true);
    });

    it('keeps Escape inside an open list so a surrounding drawer stays open', () => {
      const documentKeydown = vi.fn();
      document.addEventListener('keydown', documentKeydown);
      try {
        renderTypeahead();
        const input = screen.getByRole('combobox');
        fireEvent.focus(input);
        fireEvent.keyDown(input, { key: 'Escape' });
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
        expect(documentKeydown).not.toHaveBeenCalled();

        // Closed list: Escape is the drawer's again
        fireEvent.keyDown(input, { key: 'Escape' });
        expect(documentKeydown).toHaveBeenCalledTimes(1);
      } finally {
        document.removeEventListener('keydown', documentKeydown);
      }
    });
  });

  // MUT-5 review: Enter never submits a form past something unresolved
  describe('Enter safety (MUT-5 review)', () => {
    function Controlled(props: {
      options: TypeaheadOption[];
      onSelect?: (option: TypeaheadOption) => void | Promise<unknown>;
      autoHighlight?: (options: TypeaheadOption[], typed: string) => number;
    }) {
      const [value, setValue] = useState('');
      return (
        <EntityTypeahead
          options={props.options}
          inputValue={value}
          onInputChange={setValue}
          autoHighlight={props.autoHighlight}
          onSelect={(option) => {
            setValue(option.label);
            return props.onSelect?.(option);
          }}
        />
      );
    }

    it('highlights a prefix match, not the first substring match', () => {
      const options: TypeaheadOption[] = [
        { id: 'c1', label: 'Joanna', isNew: false },
        { id: 'new', label: 'Ann', isNew: true },
      ];
      const onSelect = vi.fn();
      render(<Controlled options={options} onSelect={onSelect} />);
      const input = screen.getByRole('combobox');
      fireEvent.change(input, { target: { value: 'Ann' } });
      expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onSelect).toHaveBeenCalledWith(options[1]);
    });

    it('highlights the only option of a select-only list even as a substring match', () => {
      const options: TypeaheadOption[] = [{ id: 'c1', label: 'Acme', isNew: false }];
      render(<Controlled options={options} />);
      const input = screen.getByRole('combobox');
      fireEvent.change(input, { target: { value: 'cme' } });
      expect(screen.getByRole('option')).toHaveAttribute('aria-selected', 'true');
    });

    it('holds Enter while typed text matches nothing, instead of submitting it away', () => {
      const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
      render(
        <form onSubmit={onSubmit}>
          <Controlled options={[]} />
        </form>
      );
      const input = screen.getByRole('combobox');
      fireEvent.change(input, { target: { value: 'Nobody' } });
      expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(false);
    });

    it('holds Enter after Escape while the typed text is still unpicked', () => {
      render(<Controlled options={mockOptions} />);
      const input = screen.getByRole('combobox');
      fireEvent.change(input, { target: { value: 'zz' } });
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(false);
    });

    it('holds Enter and reports busy while a pick is still being saved', async () => {
      let finish!: () => void;
      const pending = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const createOnly: TypeaheadOption[] = [{ id: 'new', label: 'Newco', isNew: true }];
      render(<Controlled options={createOnly} onSelect={() => pending} />);
      const input = screen.getByRole('combobox');
      fireEvent.change(input, { target: { value: 'Newco' } });
      fireEvent.keyDown(input, { key: 'Enter' }); // picks "create Newco"
      expect(input).toHaveAttribute('aria-busy', 'true');
      expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(false);

      await act(async () => {
        finish();
        await pending;
      });
      expect(input).not.toHaveAttribute('aria-busy');
      expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(true);
    });

    it('submits the form once a pick that held Enter has been saved', async () => {
      let finish!: () => void;
      const pending = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
      const createOnly: TypeaheadOption[] = [{ id: 'new', label: 'Newco', isNew: true }];
      render(
        <form onSubmit={onSubmit}>
          <Controlled options={createOnly} onSelect={() => pending} />
        </form>
      );
      const input = screen.getByRole('combobox');
      input.focus();
      fireEvent.change(input, { target: { value: 'Newco' } });
      fireEvent.keyDown(input, { key: 'Enter' }); // picks "create Newco"
      fireEvent.keyDown(input, { key: 'Enter' }); // held while it saves
      expect(onSubmit).not.toHaveBeenCalled();

      await act(async () => {
        finish();
        await pending;
      });
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it('drops a held Enter when the user types again before the pick is saved', async () => {
      let finish!: () => void;
      const pending = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
      const createOnly: TypeaheadOption[] = [{ id: 'new', label: 'Newco', isNew: true }];
      render(
        <form onSubmit={onSubmit}>
          <Controlled options={createOnly} onSelect={() => pending} />
        </form>
      );
      const input = screen.getByRole('combobox');
      input.focus();
      fireEvent.change(input, { target: { value: 'Newco' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      fireEvent.keyDown(input, { key: 'Enter' });
      fireEvent.change(input, { target: { value: 'Newcom' } });

      await act(async () => {
        finish();
        await pending;
      });
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('does not submit a held Enter when the pick fails, and offers the typed text again', async () => {
      let fail!: () => void;
      const pending = new Promise<boolean>((resolve) => {
        fail = () => resolve(false);
      });
      const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
      const onSelect = vi.fn(() => pending);
      const createOnly: TypeaheadOption[] = [{ id: 'new', label: 'Newco', isNew: true }];
      render(
        <form onSubmit={onSubmit}>
          <Controlled options={createOnly} onSelect={onSelect} />
        </form>
      );
      const input = screen.getByRole('combobox');
      input.focus();
      fireEvent.change(input, { target: { value: 'Newco' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      fireEvent.keyDown(input, { key: 'Enter' });

      await act(async () => {
        fail();
        await pending;
      });
      expect(onSubmit).not.toHaveBeenCalled();
      // The name is unpicked again: Enter reopens the list on "create Newco", and the next Enter retries
      expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(false);
      expect(screen.getByRole('option')).toHaveAttribute('aria-selected', 'true');
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onSelect).toHaveBeenCalledTimes(2);
    });

    it('highlights nothing in a box a failed pick emptied', async () => {
      const options: TypeaheadOption[] = [
        { id: 'p1', label: 'Website redesign', isNew: false },
        { id: 'new', label: 'Website', isNew: true },
      ];
      function EmptiesOnFailure() {
        const [value, setValue] = useState('');
        return (
          <EntityTypeahead
            options={options}
            inputValue={value}
            onInputChange={setValue}
            onSelect={async () => {
              setValue('');
              return false;
            }}
          />
        );
      }
      render(<EmptiesOnFailure />);
      const input = screen.getByRole('combobox');
      fireEvent.change(input, { target: { value: 'Website' } });
      fireEvent.click(screen.getAllByRole('option')[1]); // "create Website", which fails
      await act(async () => {});

      fireEvent.focus(input);
      expect(screen.getAllByRole('option').some((o) => o.getAttribute('aria-selected') === 'true')).toBe(false);
      expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(true);
    });

    it('picks on the second Enter after Escape closed the list', () => {
      const onSelect = vi.fn();
      render(<Controlled options={mockOptions} onSelect={onSelect} />);
      const input = screen.getByRole('combobox');
      fireEvent.change(input, { target: { value: 'Be' } });
      fireEvent.keyDown(input, { key: 'Escape' });

      expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(false); // reopens on the match
      expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onSelect).toHaveBeenCalledWith(mockOptions[1]);
    });

    it('lets the consumer choose which option the typed text highlights', () => {
      const options: TypeaheadOption[] = [
        { id: 'v1', label: 'Amazon Web Services', isNew: false },
        { id: 'v2', label: 'Awsome Designs', isNew: false },
      ];
      const onSelect = vi.fn();
      render(<Controlled options={options} onSelect={onSelect} autoHighlight={() => 0} />);
      const input = screen.getByRole('combobox');
      fireEvent.change(input, { target: { value: 'aws' } });
      expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onSelect).toHaveBeenCalledWith(options[0]);
    });

    it('lets Enter through after tabbing into a field that lists options but has nothing typed', () => {
      render(<Controlled options={mockOptions} />);
      const input = screen.getByRole('combobox');
      fireEvent.focus(input);
      expect(screen.getByRole('listbox')).toBeInTheDocument();
      expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(true);
    });

    it('tells assistive tech which option Enter will pick', () => {
      render(<Controlled options={mockOptions} />);
      const input = screen.getByRole('combobox');
      fireEvent.change(input, { target: { value: 'Be' } });
      const listbox = screen.getByRole('listbox');
      const highlighted = screen.getAllByRole('option')[1];
      expect(input).toHaveAttribute('aria-controls', listbox.id);
      expect(highlighted.id).toBeTruthy();
      expect(input).toHaveAttribute('aria-activedescendant', highlighted.id);
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

  // MUT-318 Apple design review (A1–A3) and design review 5A
  describe('saving and cues (MUT-318)', () => {
    function Saving(props: { onSelect: (option: TypeaheadOption) => Promise<unknown>; flashSignal?: number; describedBy?: string }) {
      const [value, setValue] = useState('');
      return (
        <EntityTypeahead
          options={[{ id: 'new', label: 'Newco', isNew: true }]}
          inputValue={value}
          onInputChange={setValue}
          onSelect={(option) => {
            setValue(option.label);
            return props.onSelect(option);
          }}
          flashSignal={props.flashSignal}
          describedBy={props.describedBy}
        />
      );
    }

    function deferred<T>() {
      let settle!: (value: T) => void;
      const promise = new Promise<T>((resolve) => {
        settle = resolve;
      });
      return { promise, settle };
    }

    it('keeps the input focused and read-only while a pick is saving, not disabled (A1)', async () => {
      const save = deferred<void>();
      render(<Saving onSelect={() => save.promise} />);
      const input = screen.getByRole('combobox');
      input.focus();
      fireEvent.change(input, { target: { value: 'Newco' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(input).toHaveAttribute('readonly');
      expect(input).not.toBeDisabled();
      expect(document.activeElement).toBe(input);

      await act(async () => {
        save.settle();
        await save.promise;
      });
      expect(input).not.toHaveAttribute('readonly');
      expect(document.activeElement).toBe(input);
    });

    it('pulses the border once a create is saved, and not when it fails (A2)', async () => {
      const ok = deferred<void>();
      const { container, unmount } = render(<Saving onSelect={() => ok.promise} />);
      let input = screen.getByRole('combobox');
      fireEvent.change(input, { target: { value: 'Newco' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(container.querySelector('.entity-typeahead')).not.toHaveClass('create-success');
      await act(async () => {
        ok.settle();
        await ok.promise;
      });
      expect(container.querySelector('.entity-typeahead')).toHaveClass('create-success');
      unmount();

      const refused = deferred<boolean>();
      const second = render(<Saving onSelect={() => refused.promise} />);
      input = screen.getByRole('combobox');
      fireEvent.change(input, { target: { value: 'Newco' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      await act(async () => {
        refused.settle(false);
        await refused.promise;
      });
      expect(second.container.querySelector('.entity-typeahead')).not.toHaveClass('create-success');
    });

    it('plays the cascade flash when flashSignal changes, never on mount (A3)', () => {
      const { container, rerender } = render(<Saving onSelect={() => Promise.resolve()} flashSignal={0} />);
      const root = container.querySelector('.entity-typeahead');
      expect(root).not.toHaveClass('cascade-flash');
      rerender(<Saving onSelect={() => Promise.resolve()} flashSignal={1} />);
      expect(root).toHaveClass('cascade-flash');
    });

    it('points aria-describedby at the hint it is given (5A)', () => {
      render(<Saving onSelect={() => Promise.resolve()} describedBy="matter-hint" />);
      expect(screen.getByRole('combobox')).toHaveAttribute('aria-describedby', 'matter-hint');
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
