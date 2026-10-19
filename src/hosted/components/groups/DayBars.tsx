import { Fragment, useRef, useState, type KeyboardEvent } from 'react';
import type { Bar, Position } from '../../data/expenseGroups';
import { useSpringScale } from './useSpringScale';

/**
 * A group's spend per day (or week), hand-built (MUT-268 18A): one button per
 * bar (20A) in a labelled group with a roving tab stop; ←/→ follow the
 * reading direction (mirrored in RTL), Home/End jump to the ends, and Enter or
 * a click asks the page to show that day's expenses. Members outside the dates
 * get their own bars past a "⋯" gap (6A, 15A), so the bars always add up to the
 * headline. The tooltip shows the value at once, on hover and on focus (craft 5).
 */

export interface DayBarsProps {
  bars: Bar[];
  /** The group's accessible name ("JOD per day. Arrow keys move between days."). */
  label: string;
  /** Each bar's spoken and tooltip text. */
  describe: (bar: Bar) => string;
  /** The micro axis label under a bar (day of month), or null for none. */
  axisLabel: (bar: Bar, index: number) => string | null;
  gapLabel: (position: Exclude<Position, 'in'>) => string;
  /** Bars whose day had spend only in another currency (20A's dot). */
  hasOther: (bar: Bar) => boolean;
  selected?: string;
  onJump: (bar: Bar) => void;
  reducedMotion: boolean;
}

/** Bars this close to an end flip their tooltip inward (craft 5). */
const EDGE_BARS = 3;

export function DayBars({ bars, label, describe, axisLabel, gapLabel, hasOther, selected, onJump, reducedMotion }: DayBarsProps) {
  const [focusKey, setFocusKey] = useState<string | undefined>(undefined);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const current = bars.findIndex((b) => b.key === (focusKey ?? selected));
  const tabStop = current >= 0 ? current : bars.findIndex((b) => b.position === 'in') >= 0 ? bars.findIndex((b) => b.position === 'in') : 0;

  function move(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const rtl = event.currentTarget.closest('[dir]')?.getAttribute('dir') === 'rtl';
    const step = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 }[event.key];
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? bars.length - 1 : step === undefined ? -1 : Math.min(bars.length - 1, Math.max(0, index + step));
    if (target < 0) return;
    event.preventDefault();
    const bar = bars[target]!;
    setFocusKey(bar.key);
    buttons.current.get(bar.key)?.focus();
  }

  return (
    <div className="hp-daybars" role="group" aria-label={label}>
      {bars.map((bar, index) => {
        const previous = bars[index - 1];
        const gap = previous && previous.position !== bar.position ? (bar.position === 'in' ? previous.position : bar.position) : null;
        const edge = index < EDGE_BARS ? 'start' : index >= bars.length - EDGE_BARS ? 'end' : 'middle';
        return (
          <Fragment key={bar.key}>
            {gap && gap !== 'in' && (
              <span className="hp-daybars-gap" aria-hidden="true">
                ⋯ {gapLabel(gap)}
              </span>
            )}
            <DayBar
              bar={bar}
              text={describe(bar)}
              axis={axisLabel(bar, index)}
              other={hasOther(bar)}
              edge={edge}
              tabbable={index === tabStop}
              selected={bar.key === selected}
              reducedMotion={reducedMotion}
              register={(element) => {
                if (element) buttons.current.set(bar.key, element);
                else buttons.current.delete(bar.key);
              }}
              onKeyDown={(event) => move(event, index)}
              onFocus={() => setFocusKey(bar.key)}
              onJump={() => onJump(bar)}
            />
          </Fragment>
        );
      })}
    </div>
  );
}

interface DayBarProps {
  bar: Bar;
  text: string;
  axis: string | null;
  other: boolean;
  edge: 'start' | 'middle' | 'end';
  tabbable: boolean;
  selected: boolean;
  reducedMotion: boolean;
  register: (element: HTMLButtonElement | null) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onFocus: () => void;
  onJump: () => void;
}

function DayBar({ bar, text, axis, other, edge, tabbable, selected, reducedMotion, register, onKeyDown, onFocus, onJump }: DayBarProps) {
  const fill = useRef<HTMLSpanElement>(null);
  useSpringScale(fill, bar.max === 0 ? 0 : bar.minor / bar.max, 'y', reducedMotion);
  const classes = [
    'hp-daybar',
    'press',
    `hp-daybar-${bar.position}`,
    bar.minor === 0 && 'hp-daybar-zero',
    other && 'hp-daybar-other',
    selected && 'hp-daybar-sel',
    `hp-tip-${edge}`,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button ref={register} type="button" className={classes} tabIndex={tabbable ? 0 : -1} aria-label={text} onKeyDown={onKeyDown} onFocus={onFocus} onClick={onJump}>
      <span className="hp-daybar-track" aria-hidden="true">
        <span ref={fill} className="hp-daybar-fill" />
      </span>
      <span className="hp-daybar-tip" aria-hidden="true">
        {text}
      </span>
      {axis && (
        <span className="hp-daybar-x" aria-hidden="true">
          {axis}
        </span>
      )}
    </button>
  );
}
