import { type KeyboardEvent } from 'react';
import './Switch.css';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** id of the element that labels the switch (the settings row label). */
  labelledBy?: string;
  /** Accessible name when there is no visible label element. */
  ariaLabel?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}

/**
 * An on/off switch: `<button role="switch">`, toggled by click, Space or
 * Enter. Uses logical properties so the knob travels in the reading direction
 * (mirrors in RTL). First used by Settings › Advanced features (MUT-12).
 */
export function Switch({ checked, onChange, labelledBy, ariaLabel, disabled = false, id, className }: SwitchProps) {
  const toggle = () => {
    if (!disabled) onChange(!checked);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      toggle();
    }
  };

  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-labelledby={labelledBy}
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      className={['switch', checked ? 'switch-on' : 'switch-off', className].filter(Boolean).join(' ')}
      onClick={toggle}
      onKeyDown={handleKeyDown}
    >
      <span className="switch-knob" aria-hidden="true" />
    </button>
  );
}
