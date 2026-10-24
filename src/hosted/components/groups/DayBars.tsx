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
 *
 * MUT-175 (D1, opt-in): `second` draws a second fill per bar (Reports' spent
 * beside received), and `future` days are drawn faint, outside the tab order and
 * the accessibility tree, and skipped by the arrows (DR13). Without them the
 * chart is exactly the expense groups' one (D5's contract tests).
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
  /** MUT-175: a second series' minor units for a bar, scaled by the same `max`. */
  second?: (bar: Bar) => number;
  /** MUT-175: days after today, drawn faint and never focusable. */
  future?: (bar: Bar) => boolean;
}

/** Bars this close to an end flip their tooltip inward (craft 5). */
const EDGE_BARS = 3;

export function DayBars({ bars, label, describe, axisLabel, gapLabel, hasOther, selected, onJump, reducedMotion, second, future }: DayBarsProps) {
  const [focusKey, setFocusKey] = useState<string | undefined>(undefined);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const isFuture = (bar: Bar) => future?.(bar) ?? false;
  /** The last bar the arrows and End may reach: future days are never focusable. */
  const lastReachable = bars.reduce((last, bar, index) => (isFuture(bar) ? last : index), 0);
  const current = bars.findIndex((b) => b.key === (focusKey ?? selected));
  const tabStop = current >= 0 ? current : bars.findIndex((b) => b.position === 'in') >= 0 ? bars.findIndex((b) => b.position === 'in') : 0;

  function move(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const rtl = event.currentTarget.closest('[dir]')?.getAttribute('dir') === 'rtl';
    const step = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 }[event.key];
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? lastReachable : step === undefined ? -1 : Math.min(lastReachable, Math.max(0, index + step));
    if (target < 0) return;
    event.preventDefault();
    const bar = bars[target]!;
    setFocusKey(bar.key);
    buttons.current.get(bar.key)?.focus();
  }

  return (
    <div className={second ? 'hp-daybars hp-daybars-pair' : 'hp-daybars'} role="group" aria-label={label}>
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
            {isFuture(bar) ? (
              <FutureBar bar={bar} axis={axisLabel(bar, index)} />
            ) : (
              <DayBar
                bar={bar}
                second={second?.(bar)}
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
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

interface DayBarProps {
  bar: Bar;
  second: number | undefined;
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

function DayBar({ bar, second, text, axis, other, edge, tabbable, selected, reducedMotion, register, onKeyDown, onFocus, onJump }: DayBarProps) {
  const fill = useRef<HTMLSpanElement>(null);
  useSpringScale(fill, bar.max === 0 ? 0 : bar.minor / bar.max, 'y', reducedMotion);
  const classes = [
    'hp-daybar',
    'press',
    `hp-daybar-${bar.position}`,
    bar.minor === 0 && (second ?? 0) === 0 && 'hp-daybar-zero',
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
        {second !== undefined && <SecondFill bar={bar} minor={second} reducedMotion={reducedMotion} />}
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

/** MUT-175: the second series' fill, scaled like the first. */
function SecondFill({ bar, minor, reducedMotion }: { bar: Bar; minor: number; reducedMotion: boolean }) {
  const fill = useRef<HTMLSpanElement>(null);
  useSpringScale(fill, bar.max === 0 ? 0 : minor / bar.max, 'y', reducedMotion);
  return <span ref={fill} className="hp-daybar-fill hp-daybar-fill-2" />;
}

/** MUT-175 (DR13): a day still to come — no fill, faint, not focusable, no tooltip. */
function FutureBar({ bar, axis }: { bar: Bar; axis: string | null }) {
  return (
    <span className={`hp-daybar hp-daybar-${bar.position} hp-daybar-future`} aria-hidden="true">
      <span className="hp-daybar-track" />
      {axis && <span className="hp-daybar-x">{axis}</span>}
    </span>
  );
}
