import { useId, useState } from 'react';
import { useLanguage } from '../../../lib/i18n/core';
import { SegmentedControl } from '../../../components/ui/SegmentedControl';
import { Switch } from '../../../components/ui/Switch';
import { PERIODS, type Period } from '../../data/reports';

/**
 * Reports' one control row (MUT-175, DR1, DR27, DS4): Week | Month | Year on
 * the shared SegmentedControl (Year stays locked before stage 3, and a tap or
 * an arrow onto it says when it unlocks, visibly), the All-profiles Switch
 * when there are 2+ readable profiles, and ‹ › in reading order: the glyphs
 * are bidi-mirrored by the browser in Arabic, so no CSS flip (review).
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
  const switchLabel = useId();
  const [lockedTried, setLockedTried] = useState(false);
  const yearHint = yearLockedUntil ? t(`${K}.period.yearLocked`, { month: yearLockedUntil }) : undefined;
  const options = PERIODS.map((p) => ({ value: p, label: t(`${K}.period.${p}`), ...(p === 'year' && yearHint ? { disabled: true, hint: yearHint } : {}) }));
  return (
    <div className="hp-report-controls-wrap">
      <div className="hp-report-controls">
        <SegmentedControl options={options} value={period} onChange={onPeriod} onDisabledChoice={() => setLockedTried(true)} ariaLabel={t(`${K}.period.label`)} className="hp-report-periods" />
        <div className="hp-report-controls-end">
          {allProfiles !== null && (
            <label className="hp-report-switch press">
              <span id={switchLabel}>{t(`${K}.scope.switch`)}</span>
              <Switch checked={allProfiles} onChange={onAllProfiles} labelledBy={switchLabel} />
            </label>
          )}
          <button type="button" className="hp-step press" aria-label={t(`${K}.step.previous.${period}`)} disabled={!canPrevious} onClick={() => onStep(-1)}>
            <span aria-hidden="true">‹</span>
          </button>
          <button type="button" className="hp-step press" aria-label={t(`${K}.step.next.${period}`)} disabled={!canNext} onClick={() => onStep(1)}>
            <span aria-hidden="true">›</span>
          </button>
        </div>
      </div>
      <p className="hp-report-note hp-report-hint" aria-live="polite">
        {lockedTried && yearHint}
      </p>
    </div>
  );
}
