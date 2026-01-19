import { useCallback, useRef, type KeyboardEvent } from 'react';
import { StepperInput } from '../../../components/ui/StepperInput';
import type { Currency } from '../../../types';
import './LineItemsTable.css';

export interface LineItem {
  name: string;
  quantity: number;
  rateMinor: number;
  discountMinor: number;
  taxExempt: boolean;
}

export interface LineItemsTableProps {
  items: LineItem[];
  currency: Currency;
  onChange: (items: LineItem[]) => void;
  disabled?: boolean;
}

const CURRENCY_SYMBOLS: Record<Currency, string> = {
  USD: '$',
  ILS: '₪',
};

// Calculate item total in minor units
function calculateItemTotal(item: LineItem): number {
  return item.quantity * item.rateMinor - item.discountMinor;
}

// Format minor amount to display string
function formatMinorAmount(minor: number, currency: Currency): string {
  const symbol = CURRENCY_SYMBOLS[currency];
  const major = minor / 100;
  return `${symbol}${major.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Format rate for display (major units)
function formatRate(rateMinor: number): string {
  return (rateMinor / 100).toFixed(2);
}

// Parse rate from input (convert to minor)
function parseRate(input: string): number {
  const parsed = parseFloat(input);
  if (isNaN(parsed)) return 0;
  return Math.round(parsed * 100);
}

export function LineItemsTable({ items, currency, onChange, disabled = false }: LineItemsTableProps) {
  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  const createEmptyItem = (): LineItem => ({
    name: '',
    quantity: 1,
    rateMinor: 0,
    discountMinor: 0,
    taxExempt: false,
  });

  const updateItem = useCallback(
    (index: number, updates: Partial<LineItem>) => {
      const newItems = [...items];
      newItems[index] = { ...newItems[index], ...updates };
      onChange(newItems);
    },
    [items, onChange]
  );

  const addItem = useCallback(() => {
    onChange([...items, createEmptyItem()]);
    // Focus the name input of the new row after render
    setTimeout(() => {
      const newIndex = items.length;
      const nameInput = inputRefs.current.get(`name-${newIndex}`);
      nameInput?.focus();
    }, 0);
  }, [items, onChange]);

  const removeItem = useCallback(
    (index: number) => {
      if (items.length <= 1) return;
      const newItems = items.filter((_, i) => i !== index);
      onChange(newItems);
    },
    [items, onChange]
  );

  const duplicateItem = useCallback(
    (index: number) => {
      const newItems = [...items];
      const duplicated = { ...items[index] };
      newItems.splice(index + 1, 0, duplicated);
      onChange(newItems);
    },
    [items, onChange]
  );

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>, index: number, field: string) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        // If on the last row, add a new item
        if (index === items.length - 1) {
          addItem();
        } else {
          // Move to the same field on the next row
          const nextInput = inputRefs.current.get(`${field}-${index + 1}`);
          nextInput?.focus();
        }
      } else if (e.key === 'Tab' && !e.shiftKey && field === 'rate' && index === items.length - 1) {
        // Tab from last rate field adds new item
        e.preventDefault();
        addItem();
      } else if (e.key === 'ArrowDown' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        const nextInput = inputRefs.current.get(`${field}-${Math.min(index + 1, items.length - 1)}`);
        nextInput?.focus();
      } else if (e.key === 'ArrowUp' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        const prevInput = inputRefs.current.get(`${field}-${Math.max(index - 1, 0)}`);
        prevInput?.focus();
      }
    },
    [items.length, addItem]
  );

  const setInputRef = useCallback((key: string, el: HTMLInputElement | null) => {
    if (el) {
      inputRefs.current.set(key, el);
    } else {
      inputRefs.current.delete(key);
    }
  }, []);

  // Calculate subtotal
  const subtotal = items.reduce((sum, item) => sum + calculateItemTotal(item), 0);

  return (
    <div className="line-items-table">
      {/* Header */}
      <div className="line-items-header">
        <div className="line-items-col line-items-col-name">Item</div>
        <div className="line-items-col line-items-col-qty">Qty</div>
        <div className="line-items-col line-items-col-rate">Rate</div>
        <div className="line-items-col line-items-col-total">Total</div>
        <div className="line-items-col line-items-col-actions" />
      </div>

      {/* Items */}
      <div className="line-items-body">
        {items.map((item, index) => (
          <div key={index} className="line-items-row">
            <div className="line-items-col line-items-col-name">
              <input
                ref={(el) => setInputRef(`name-${index}`, el)}
                type="text"
                className="line-items-input"
                placeholder="Item description"
                value={item.name}
                onChange={(e) => updateItem(index, { name: e.target.value })}
                onKeyDown={(e) => handleKeyDown(e, index, 'name')}
                disabled={disabled}
              />
            </div>
            <div className="line-items-col line-items-col-qty">
              <StepperInput
                value={item.quantity}
                onChange={(quantity) => updateItem(index, { quantity })}
                step={0.5}
                min={0.01}
                disabled={disabled}
              />
            </div>
            <div className="line-items-col line-items-col-rate">
              <StepperInput
                value={item.rateMinor}
                onChange={(rateMinor) => updateItem(index, { rateMinor })}
                step={1000} // $10 or ₪10
                min={0}
                formatDisplay={(v) => formatRate(v)}
                parseInput={parseRate}
                disabled={disabled}
              />
            </div>
            <div className="line-items-col line-items-col-total">
              <span className="line-items-total-value">
                {formatMinorAmount(calculateItemTotal(item), currency)}
              </span>
            </div>
            <div className="line-items-col line-items-col-actions">
              {!disabled && (
                <>
                  <button
                    type="button"
                    className="line-items-action-btn"
                    onClick={() => duplicateItem(index)}
                    title="Duplicate item"
                    aria-label="Duplicate item"
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                      <rect x="4" y="4" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                      <path d="M2 10V2.5C2 2.22386 2.22386 2 2.5 2H10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="line-items-action-btn line-items-action-btn-danger"
                    onClick={() => removeItem(index)}
                    title="Remove item"
                    aria-label="Remove item"
                    disabled={items.length <= 1}
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                      <path d="M2 4H12M5 4V2.5C5 2.22386 5.22386 2 5.5 2H8.5C8.77614 2 9 2.22386 9 2.5V4M11 4V11.5C11 11.7761 10.7761 12 10.5 12H3.5C3.22386 12 3 11.7761 3 11.5V4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Add Row */}
      {!disabled && (
        <button type="button" className="line-items-add-row" onClick={addItem}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M7 2V12M2 7H12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span>Add line item</span>
        </button>
      )}

      {/* Footer with subtotal */}
      <div className="line-items-footer">
        <div className="line-items-subtotal">
          <span className="line-items-subtotal-label">Subtotal</span>
          <span className="line-items-subtotal-value">{formatMinorAmount(subtotal, currency)}</span>
        </div>
      </div>
    </div>
  );
}
