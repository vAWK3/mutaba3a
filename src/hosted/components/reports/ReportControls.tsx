import { useRef, type KeyboardEvent } from 'react';
import { useLanguage } from '../../../lib/i18n/core';
import { PERIODS, type Period } from '../../data/reports';

/**
 * Reports' one control row (MUT-175, DR1, DR27, DS4): Week | Month | Year as a
 * radiogroup (arrows move and choose; Year stays locked before stage 3 and says
 * when it unlocks), the All-profiles switch when there are 2+ readable
 * profiles, and ‹ › in reading order (mirrored in Arabic) within the bounds.
 */

const K = 'hosted.reports';

export interface ReportControlsProps {
  period: Period;
  onPeriod: (period: Period) => void;
  /** The month Year unlocks in ("Unlocks in …"), or null when Year is open. */
  yearLockedUntil: string | null;
  canPrevious: boolean;
  canNext: boolean;
  onStep: (direction: -1 | 1) => void;
  /** Null hides the switch (fewer than 2 readable profiles). */
  allProfiles: boolean | null;
  onAllProfiles: (on: boolean) => void;
}

export function ReportControls({ period, onPeriod, yearLockedUntil, canPrevious, canNext, onStep, allProfiles, onAllProfiles }: ReportControlsProps) {
  const { t } = useLanguage();
  const radios = useRef(new Map<Period, HTMLButtonElement>());
  const open = PERIODS.filter((p) => p !== 'year' || yearLockedUntil === null);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const rtl = event.currentTarget.closest('[dir]')?.getAttribute('dir') === 'rtl';
    const step = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1, ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = open[(open.indexOf(period) + step + open.length) % open.length]!;
    onPeriod(next);
    radios.current.get(next)?.focus();
  }

  return (
    <div className="hp-report-controls">
      <div className="hp-segmented" role="radiogroup" aria-label={t(`${K}.period.label`)}>
        {PERIODS.map((p) => {
          const locked = p === 'year' && yearLockedUntil !== null;
          return (
            <button
              key={p}
              ref={(element) => {
                if (element) radios.current.set(p, element);
                else radios.current.delete(p);
              }}
              type="button"
              role="radio"
              aria-checked={p === period}
              aria-disabled={locked || undefined}
              aria-description={locked ? t(`${K}.period.yearLocked`, { month: yearLockedUntil! }) : undefined}
              title={locked ? t(`${K}.period.yearLocked`, { month: yearLockedUntil! }) : undefined}
              tabIndex={p === period ? 0 : -1}
              className={`hp-segment press ${p === period ? 'hp-segment-on' : ''}`}
              onClick={() => !locked && onPeriod(p)}
              onKeyDown={onKeyDown}
            >
              {t(`${K}.period.${p}`)}
            </button>
          );
        })}
      </div>
      <div className="hp-report-controls-end">
        {allProfiles !== null && (
          <button type="button" role="switch" aria-checked={allProfiles} className="hp-switch press" onClick={() => onAllProfiles(!allProfiles)}>
            <span className="hp-switch-track" aria-hidden="true">
              <span className="hp-switch-thumb" />
            </span>
            {t(`${K}.scope.switch`)}
          </button>
        )}
        <button type="button" className="hp-step press" aria-label={t(`${K}.step.previous.${period}`)} disabled={!canPrevious} onClick={() => onStep(-1)}>
          <span className="hp-step-icon" aria-hidden="true">
            ‹
          </span>
        </button>
        <button type="button" className="hp-step press" aria-label={t(`${K}.step.next.${period}`)} disabled={!canNext} onClick={() => onStep(1)}>
          <span className="hp-step-icon" aria-hidden="true">
            ›
          </span>
        </button>
      </div>
    </div>
  );
}
