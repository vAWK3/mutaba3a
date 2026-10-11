import { useState, useRef, useEffect, useCallback, useId } from 'react';
import { cn } from '../../lib/utils';
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
  /** May return a promise (e.g. creating the record); Enter waits until it settles. */
  onSelect: (option: TypeaheadOption<T>) => void | Promise<unknown>;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  createLabel?: string;
  /** Called when the input loses focus, before the list closes */
  onBlur?: () => void;
}

/**
 * The option Enter would pick for typed text: the first existing option whose
 * label starts with it, else the create option, else the only option of a
 * select-only list. Never a mere substring match, so typing a new "Ann" while
 * "Joanna" exists offers to create Ann rather than picking Joanna.
 */
function autoHighlight<T>(options: TypeaheadOption<T>[], typed: string): number {
  const query = typed.trim().toLowerCase();
  if (!query) return -1;
  const prefix = options.findIndex((o) => !o.isNew && o.label.toLowerCase().startsWith(query));
  if (prefix >= 0) return prefix;
  const create = options.findIndex((o) => o.isNew);
  if (create >= 0) return create;
  return options.length === 1 ? 0 : -1;
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
  const highlightedIndex = highlight === 'auto' ? autoHighlight(options, typedText) : highlight;
  const optionId = (index: number) => `${listboxId}-option-${index}`;

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const typed = e.target.value;
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
      if (result instanceof Promise) {
        selectingRef.current = true;
        setSelecting(true);
        const settle = () => {
          selectingRef.current = false;
          setSelecting(false);
        };
        result.then(settle, settle);
      }
    },
    [onSelect]
  );

  // Enter picks the highlighted option. Otherwise it is held while a pick is
  // still being saved or while typed text is unpicked; with the field empty
  // or showing a picked value it reaches the surrounding form.
  const handleEnter = (e: React.KeyboardEvent) => {
    if (selectingRef.current) {
      e.preventDefault();
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
      return;
    }
    setIsOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleEnter(e);
      return;
    }
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
