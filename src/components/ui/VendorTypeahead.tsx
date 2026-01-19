import { useState, useRef, useEffect, useCallback } from 'react';
import { useVendors, useFindOrCreateVendor } from '../../hooks/useExpenseQueries';
import { normalizeVendor, vendorSimilarity } from '../../lib/vendorNormalization';
import { useT } from '../../lib/i18n';
import { cn } from '../../lib/utils';
import type { Vendor } from '../../types';
import './VendorTypeahead.css';

export interface VendorTypeaheadProps {
  profileId: string;
  value: string;
  vendorId?: string;
  onChange: (value: string, vendorId?: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

interface VendorOption {
  id: string;
  name: string;
  isNew: boolean;
  similarity?: number;
}

export function VendorTypeahead({
  profileId,
  value,
  onChange,
  placeholder,
  disabled,
  className,
}: VendorTypeaheadProps) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const { data: vendors = [] } = useVendors(profileId);
  const findOrCreateMutation = useFindOrCreateVendor();

  // Filter and score vendors based on input
  const options: VendorOption[] = (() => {
    if (!inputValue.trim()) {
      // Show all vendors when input is empty
      return vendors.map((v) => ({
        id: v.id,
        name: v.canonicalName,
        isNew: false,
      }));
    }

    const normalizedInput = normalizeVendor(inputValue);
    const scored: Array<{ vendor: Vendor; score: number }> = [];

    for (const vendor of vendors) {
      // Check canonical name
      const canonicalScore = vendorSimilarity(inputValue, vendor.canonicalName);
      let bestScore = canonicalScore;

      // Check aliases
      for (const alias of vendor.aliases) {
        const aliasScore = vendorSimilarity(inputValue, alias);
        if (aliasScore > bestScore) {
          bestScore = aliasScore;
        }
      }

      // Include if there's any match
      if (bestScore > 0.3 || vendor.canonicalName.toLowerCase().includes(normalizedInput)) {
        scored.push({ vendor, score: bestScore });
      }
    }

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    const results: VendorOption[] = scored.map(({ vendor, score }) => ({
      id: vendor.id,
      name: vendor.canonicalName,
      isNew: false,
      similarity: score,
    }));

    // Add "Create new" option if no exact match
    const hasExactMatch = scored.some((s) => s.score >= 0.95);
    if (!hasExactMatch && inputValue.trim()) {
      results.push({
        id: 'new',
        name: inputValue.trim(),
        isNew: true,
      });
    }

    return results;
  })();

  // Sync input value with external value prop
  useEffect(() => {
    if (value !== inputValue) {
      setInputValue(value);
    }
  }, [value]);

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

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    setIsOpen(true);
    setHighlightedIndex(-1);
    // Only update the raw value, not the vendorId
    onChange(newValue, undefined);
  };

  const handleSelectOption = useCallback(
    async (option: VendorOption) => {
      if (option.isNew) {
        // Create new vendor
        try {
          const newVendor = await findOrCreateMutation.mutateAsync({
            profileId,
            rawVendor: option.name,
          });
          setInputValue(newVendor.canonicalName);
          onChange(newVendor.canonicalName, newVendor.id);
        } catch {
          // If creation fails, just use the raw value
          setInputValue(option.name);
          onChange(option.name, undefined);
        }
      } else {
        setInputValue(option.name);
        onChange(option.name, option.id);
      }
      setIsOpen(false);
      setHighlightedIndex(-1);
    },
    [findOrCreateMutation, onChange, profileId]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
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
    <div className={cn('vendor-typeahead', className)}>
      <input
        ref={inputRef}
        type="text"
        className="input"
        value={inputValue}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder={placeholder || t('drawer.expense.vendorPlaceholder')}
        disabled={disabled}
        autoComplete="off"
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-autocomplete="list"
      />

      {isOpen && options.length > 0 && (
        <div
          ref={dropdownRef}
          className="vendor-typeahead-dropdown"
          role="listbox"
        >
          {options.map((option, index) => (
            <button
              key={option.id}
              type="button"
              className={cn(
                'vendor-typeahead-option',
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
                  <span className="vendor-typeahead-create-label">
                    {t('vendor.createNew')}:
                  </span>
                  <span className="vendor-typeahead-name">{option.name}</span>
                </>
              ) : (
                <>
                  <span className="vendor-typeahead-name">{option.name}</span>
                  {option.similarity && option.similarity < 1 && (
                    <span className="vendor-typeahead-score">
                      {Math.round(option.similarity * 100)}%
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
