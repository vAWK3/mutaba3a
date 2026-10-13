import { useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import './SegmentedControl.css';

export interface SegmentedControlOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  options: SegmentedControlOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name when there is no visible label element. */
  ariaLabel?: string;
  /** id of the element that labels the group (the settings row label). */
  labelledBy?: string;
  className?: string;
}

/**
 * A single-select radiogroup with a sliding highlight, for a small fixed set
 * of mutually exclusive choices (Settings > Preferences: language, theme).
 * The thumb animates on the brand's toggle spring (--ease-spring,
 * --duration-toggle, both zeroed under prefers-reduced-motion in theme.css)
 * — critically damped, no overshoot, since this is a flat state switch, not
 * a flick gesture (MUT-139).
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  labelledBy,
  className,
}: SegmentedControlProps<T>) {
  const groupRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);

  // Measuring the selected option's DOM geometry requires a laid-out DOM — not
  // available at render time — so this moves the thumb by mutating its style
  // directly (TruncatedTitle's pattern), never through setState, which is
  // what react-hooks/set-state-in-effect actually polices.
  useLayoutEffect(() => {
    const el = groupRef.current?.querySelector<HTMLElement>('[data-selected="true"]');
    const thumb = thumbRef.current;
    if (el && thumb) {
      thumb.style.transform = `translateX(${el.offsetLeft}px)`;
      thumb.style.width = `${el.offsetWidth}px`;
    }
  }, [value, options]);

  const selectedIndex = options.findIndex((opt) => opt.value === value);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (selectedIndex + 1) % options.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (selectedIndex - 1 + options.length) % options.length;
    }
    if (nextIndex !== null) {
      event.preventDefault();
      onChange(options[nextIndex].value);
    }
  };

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={ariaLabel}
      aria-labelledby={labelledBy}
      className={['segmented-control', className].filter(Boolean).join(' ')}
    >
      <span ref={thumbRef} className="segmented-control-thumb" aria-hidden="true" />
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            data-selected={selected || undefined}
            tabIndex={selected ? 0 : -1}
            className="segmented-control-option"
            onClick={() => {
              if (!selected) onChange(option.value);
            }}
            onKeyDown={handleKeyDown}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
