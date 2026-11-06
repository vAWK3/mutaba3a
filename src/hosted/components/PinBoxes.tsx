/* eslint-disable react-refresh/only-export-components */
import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react';

/**
 * MUT-562 (SL2): a share link's PIN, one digit per box. Four boxes that grow to eight as the person types (a PIN is
 * 4–8 digits, MUT-560); a paste fills them; Arabic-Indic and Eastern Arabic-Indic digits read as 0–9, as the server
 * reads them. Digits run left to right in both languages, so the boxes sit in an LTR group; the group has one label.
 */

export const PIN_MIN = 4;
export const PIN_MAX = 8;

/** Western digits only: ٠–٩ (U+0660) and ۰–۹ (U+06F0) become 0–9; anything else is dropped. */
export function pinDigits(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code >= 0x30 && code <= 0x39) out += char;
    else if (code >= 0x660 && code <= 0x669) out += String(code - 0x660);
    else if (code >= 0x6f0 && code <= 0x6f9) out += String(code - 0x6f0);
  }
  return out;
}

/** How many boxes show: four, then one more empty box while there's room, up to eight. */
export function boxCount(length: number): number {
  return Math.min(PIN_MAX, Math.max(PIN_MIN, length < PIN_MIN ? PIN_MIN : length + 1));
}

interface PinBoxesProps {
  value: string;
  onChange: (value: string) => void;
  /** The group's one label ("Enter the PIN you were given"); each box is "{label}, {n}". */
  label: string;
  /** Pressing Enter in any box. */
  onSubmit?: () => void;
  invalid?: boolean;
  disabled?: boolean;
  describedBy?: string;
  autoFocus?: boolean;
}

export function PinBoxes({ value, onChange, label, onSubmit, invalid = false, disabled = false, describedBy, autoFocus = false }: PinBoxesProps) {
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const count = boxCount(value.length);
  const focusBox = (index: number) => {
    // After the render that adds the box
    queueMicrotask(() => boxes.current[Math.max(0, Math.min(index, PIN_MAX - 1))]?.focus());
  };

  function typeAt(index: number, typed: string) {
    const digits = pinDigits(typed);
    if (!digits) return;
    const next = (value.slice(0, index) + digits).slice(0, PIN_MAX);
    onChange(next);
    focusBox(next.length);
  }

  function onKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      onSubmit?.();
      return;
    }
    if (event.key !== 'Backspace') return;
    event.preventDefault();
    // A filled box clears itself; an empty one clears the one before and moves there
    const at = index < value.length ? index : index - 1;
    if (at < 0) return;
    onChange(value.slice(0, at));
    focusBox(at);
  }

  function onPaste(index: number, event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    typeAt(index, event.clipboardData.getData('text'));
  }

  return (
    <div className={`hp-pin${invalid ? ' hp-pin-invalid' : ''}`} role="group" aria-label={label} aria-describedby={describedBy} dir="ltr">
      {Array.from({ length: count }, (_, index) => (
        <input
          key={index}
          ref={(element) => {
            boxes.current[index] = element;
          }}
          className="hp-pin-box"
          type="text"
          inputMode="numeric"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          maxLength={PIN_MAX}
          aria-label={`${label}, ${index + 1}`}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          autoFocus={autoFocus && index === 0}
          value={value[index] ?? ''}
          // Typing into a box past the end lands at the end: the PIN has no gaps
          onChange={(event) => {
            const typed = pinDigits(event.target.value);
            // A filled box takes what was typed over its digit (its text is selected on focus; if not, the new one)
            typeAt(Math.min(index, value.length), value[index] && typed.length > 1 ? typed.slice(1) : typed);
          }}
          onKeyDown={(event) => onKeyDown(index, event)}
          onPaste={(event) => onPaste(Math.min(index, value.length), event)}
          onFocus={(event) => {
            if (index > value.length) boxes.current[value.length]?.focus();
            else event.target.select();
          }}
        />
      ))}
    </div>
  );
}
