import { useState, useRef, useEffect, useCallback, useId } from 'react';
import { cn } from '../../lib/utils';
import { defaultAutoHighlight } from './typeaheadHighlight';
import './EntityTypeahead.css';

export interface TypeaheadOption<T = unknown> {
  id: string;
  label: string;
  isNew: boolean;
  item?: T;
  secondary?: string;
}

export interface EntityTypeaheadProps<T = unknown> {
  options: TypeaheadOption<T>[];
  inputValue: string;
  onInputChange: (value: string) => void;
  /**
   * May return a promise (e.g. creating the record); Enter waits until it
   * settles. Resolving to false means the pick failed and the typed text is
   * still unpicked.
   */
  onSelect: (option: TypeaheadOption<T>) => void | Promise<unknown>;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  createLabel?: string;
  /** Called when the input loses focus, before the list closes */
  onBlur?: () => void;
  /** Which option typed text highlights, when the default rule doesn't fit the options */
  autoHighlight?: (options: TypeaheadOption<T>[], typed: string) => number;
}

export function EntityTypeahead<T = unknown>({
  options,
  inputValue,
  onInputChange,
  onSelect,
  placeholder,
  disabled,
  className,
  createLabel,
  onBlur,
  autoHighlight = defaultAutoHighlight,
}: EntityTypeaheadProps<T>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const listboxId = useId();
  const [isOpen, setIsOpen] = useState(false);
  // 'auto' follows the typed text (autoHighlight); a number is an explicit arrow/mouse choice
  const [highlight, setHighlight] = useState<number | 'auto'>(-1);
  const [typedText, setTypedText] = useState('');
  // Text the user typed that no pick has resolved yet; Enter must not submit it away
  const [typedUnresolved, setTypedUnresolved] = useState(false);
  // A pick whose onSelect is still running (e.g. creating the client); Enter waits
  const [selecting, setSelecting] = useState(false);
  const selectingRef = useRef(false);
  // Enter pressed while that pick was saving: once it is saved, it submits the form
  const enterHeldRef = useRef(false);

  // Handle click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // The list is only "open" for the keyboard when something is actually shown.
  const isListVisible = isOpen && options.length > 0;
  // An empty box highlights nothing, even if the last typed text would (a failed pick may have emptied it)
  const autoIndex = inputValue.trim() ? autoHighlight(options, typedText) : -1;
  const highlightedIndex = highlight === 'auto' ? autoIndex : highlight;
  const optionId = (index: number) => `${listboxId}-option-${index}`;

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const typed = e.target.value;
    enterHeldRef.current = false;
    onInputChange(typed);
    setIsOpen(true);
    setTypedText(typed);
    const hasText = typed.trim() !== '';
    setHighlight(hasText ? 'auto' : -1);
    setTypedUnresolved(hasText);
  };

  const handleSelectOption = useCallback(
    (option: TypeaheadOption<T>) => {
      const result = onSelect(option);
      setIsOpen(false);
      setHighlight(-1);
      setTypedUnresolved(false);
      if (!(result instanceof Promise)) return;

      selectingRef.current = true;
      setSelecting(true);
      const settle = (picked: boolean) => {
        selectingRef.current = false;
        setSelecting(false);
        const enterHeld = enterHeldRef.current;
        enterHeldRef.current = false;
        if (!picked) {
          // The text is unpicked again; Enter offers the same option once more
          setTypedText(option.label);
          setTypedUnresolved(true);
          setHighlight('auto');
          return;
        }
        const input = inputRef.current;
        if (enterHeld && input && document.activeElement === input) {
          input.form?.requestSubmit();
        }
      };
      result.then(
        (value) => settle(value !== false),
        () => settle(false)
      );
    },
    [onSelect]
  );

  // Enter picks the highlighted option. Otherwise it is held while a pick is
  // still being saved (and submits once it is) or while typed text is
  // unpicked; with the field empty or showing a picked value it reaches the
  // surrounding form.
  const handleEnter = (e: React.KeyboardEvent) => {
    if (selectingRef.current) {
      e.preventDefault();
      enterHeldRef.current = true;
      return;
    }
    if (isListVisible && highlightedIndex >= 0 && highlightedIndex < options.length) {
      e.preventDefault();
      handleSelectOption(options[highlightedIndex]);
      return;
    }
    if (typedUnresolved && inputValue.trim() !== '') {
      e.preventDefault();
      setIsOpen(true);
      setHighlight('auto');
      return;
    }
    setIsOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleEnter(e);
      return;
    }
    enterHeldRef.current = false;
    if (!isListVisible) {
      // Escape is left alone so it reaches the surrounding drawer.
      if (e.key === 'ArrowDown') {
        setIsOpen(true);
        e.preventDefault();
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlight(highlightedIndex < options.length - 1 ? highlightedIndex + 1 : highlightedIndex);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlight(highlightedIndex > 0 ? highlightedIndex - 1 : highlightedIndex);
        break;
      case 'Escape':
        // Close the list only; without this a drawer's Escape handler also fires and discards the form.
        e.stopPropagation();
        setIsOpen(false);
        setHighlight(-1);
        break;
      case 'Tab':
        setIsOpen(false);
        break;
    }
  };

  const handleFocus = () => {
    setIsOpen(true);
  };

  const handleBlur = () => {
    onBlur?.();
    // Delay to allow click on dropdown option
    setTimeout(() => {
      if (!dropdownRef.current?.contains(document.activeElement)) {
        setIsOpen(false);
      }
    }, 150);
  };

  return (
    <div className={cn('entity-typeahead', className)}>
      <input
        ref={inputRef}
        type="text"
        className="input"
        value={inputValue}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        role="combobox"
        aria-expanded={isListVisible}
        aria-haspopup="listbox"
        aria-autocomplete="list"
        aria-controls={isListVisible ? listboxId : undefined}
        aria-activedescendant={
          isListVisible && highlightedIndex >= 0 ? optionId(highlightedIndex) : undefined
        }
        aria-busy={selecting || undefined}
      />

      {isListVisible && (
        <div
          ref={dropdownRef}
          id={listboxId}
          className="entity-typeahead-dropdown"
          role="listbox"
        >
          {options.map((option, index) => (
            <button
              key={option.id}
              id={optionId(index)}
              type="button"
              className={cn(
                'entity-typeahead-option',
                highlightedIndex === index && 'highlighted',
                option.isNew && 'is-new'
              )}
              onClick={() => handleSelectOption(option)}
              onMouseEnter={() => setHighlight(index)}
              role="option"
              aria-selected={highlightedIndex === index}
            >
              {option.isNew ? (
                <>
                  <span className="entity-typeahead-create-label">
                    {createLabel || '+'}:
                  </span>
                  <span className="entity-typeahead-name">{option.label}</span>
                </>
              ) : (
                <>
                  <span className="entity-typeahead-name">{option.label}</span>
                  {option.secondary && (
                    <span className="entity-typeahead-secondary">
                      {option.secondary}
                    </span>
                  )}
                </>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
