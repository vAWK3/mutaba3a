import { useState, useRef, useEffect, useCallback } from 'react';
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
  onSelect: (option: TypeaheadOption<T>) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  createLabel?: string;
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
}: EntityTypeaheadProps<T>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

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

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onInputChange(e.target.value);
    setIsOpen(true);
    // Typing highlights the first match so Enter picks it; clearing drops the highlight.
    setHighlightedIndex(e.target.value.trim() ? 0 : -1);
  };

  const handleSelectOption = useCallback(
    (option: TypeaheadOption<T>) => {
      onSelect(option);
      setIsOpen(false);
      setHighlightedIndex(-1);
    },
    [onSelect]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isListVisible) {
      // Enter and Escape are left alone so they reach the surrounding form or drawer.
      if (e.key === 'ArrowDown') {
        setIsOpen(true);
        e.preventDefault();
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev < options.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : prev));
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < options.length) {
          handleSelectOption(options[highlightedIndex]);
        } else if (options.length === 1) {
          handleSelectOption(options[0]);
        }
        break;
      case 'Escape':
        // Close the list only; without this a drawer's Escape handler also fires and discards the form.
        e.stopPropagation();
        setIsOpen(false);
        setHighlightedIndex(-1);
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
      />

      {isListVisible && (
        <div
          ref={dropdownRef}
          className="entity-typeahead-dropdown"
          role="listbox"
        >
          {options.map((option, index) => (
            <button
              key={option.id}
              type="button"
              className={cn(
                'entity-typeahead-option',
                highlightedIndex === index && 'highlighted',
                option.isNew && 'is-new'
              )}
              onClick={() => handleSelectOption(option)}
              onMouseEnter={() => setHighlightedIndex(index)}
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
