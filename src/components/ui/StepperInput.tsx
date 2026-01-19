import { forwardRef, useCallback, type KeyboardEvent } from 'react';
import './StepperInput.css';

export interface StepperInputProps {
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  label?: string;
  error?: string;
  formatDisplay?: (value: number) => string;
  parseInput?: (input: string) => number;
  placeholder?: string;
  className?: string;
  id?: string;
}

export const StepperInput = forwardRef<HTMLInputElement, StepperInputProps>(
  (
    {
      value,
      onChange,
      step = 1,
      min = 0,
      max,
      disabled = false,
      label,
      error,
      formatDisplay,
      parseInput,
      placeholder,
      className = '',
      id,
    },
    ref
  ) => {
    const inputId = id || (label ? `stepper-${label.toLowerCase().replace(/\s+/g, '-')}` : undefined);
    const hasError = Boolean(error);

    const clamp = useCallback(
      (val: number) => {
        let clamped = val;
        if (min !== undefined) clamped = Math.max(min, clamped);
        if (max !== undefined) clamped = Math.min(max, clamped);
        return clamped;
      },
      [min, max]
    );

    const increment = useCallback(() => {
      if (disabled) return;
      const newValue = clamp(value + step);
      onChange(newValue);
    }, [value, step, clamp, onChange, disabled]);

    const decrement = useCallback(() => {
      if (disabled) return;
      const newValue = clamp(value - step);
      onChange(newValue);
    }, [value, step, clamp, onChange, disabled]);

    const handleInputChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const raw = e.target.value;
        if (raw === '' || raw === '-') {
          onChange(min ?? 0);
          return;
        }
        const parsed = parseInput ? parseInput(raw) : parseFloat(raw);
        if (!isNaN(parsed)) {
          onChange(clamp(parsed));
        }
      },
      [parseInput, clamp, onChange, min]
    );

    const handleKeyDown = useCallback(
      (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          increment();
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          decrement();
        }
      },
      [increment, decrement]
    );

    const displayValue = formatDisplay ? formatDisplay(value) : value.toString();

    return (
      <div className={`stepper-wrapper ${className}`}>
        {label && (
          <label htmlFor={inputId} className="stepper-label">
            {label}
          </label>
        )}
        <div className={`stepper-input-group ${hasError ? 'stepper-error' : ''}`}>
          <button
            type="button"
            className="stepper-btn stepper-btn-dec"
            onClick={decrement}
            disabled={disabled || (min !== undefined && value <= min)}
            aria-label="Decrease"
            tabIndex={-1}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M2.5 6H9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          <input
            ref={ref}
            type="text"
            inputMode="decimal"
            id={inputId}
            className="stepper-input"
            value={displayValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            placeholder={placeholder}
            aria-invalid={hasError}
            aria-describedby={error ? `${inputId}-error` : undefined}
          />
          <button
            type="button"
            className="stepper-btn stepper-btn-inc"
            onClick={increment}
            disabled={disabled || (max !== undefined && value >= max)}
            aria-label="Increase"
            tabIndex={-1}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M6 2.5V9.5M2.5 6H9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {error && (
          <p id={`${inputId}-error`} className="stepper-error-message" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }
);

StepperInput.displayName = 'StepperInput';
