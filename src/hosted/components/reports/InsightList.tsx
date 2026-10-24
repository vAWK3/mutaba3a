import { useId } from 'react';
import { getLocale, useLanguage } from '../../../lib/i18n/core';
import { useTp } from '../../../lib/i18n/plural';
import { isolate, isolateAmount } from '../../../lib/utils';
import type { Currency } from '../../api/client';
import type { Insight, InsightValue } from '../../data/reportInsights';
import { formatMinor, formatMonth } from '../../format/reportFormat';
import { LockIcon } from '../Icons';

/**
 * "Lately" (MUT-175, DR16/DR19/DR20): up to three plain sentences, the key
 * figures in the number face, normal ink, no icons or colour. When a rate is
 * missing they speak of one currency and say so (D3). The teaser, when there
 * is one, is the block's last line (DR3).
 */

const K = 'hosted.reports';
const PERCENT = 100;

export interface Teaser {
  text: string;
  /** DS5: "See insights across all profiles", which turns the switch on. */
  onSeeAll?: () => void;
}

export function InsightList({ insights, unit, singleCurrency, today, teaser }: { insights: readonly Insight[]; unit: Currency; singleCurrency: boolean; today: string; teaser: Teaser | null }) {
  const { t, language } = useLanguage();
  const tp = useTp();
  const heading = useId();
  const value = (v: InsightValue): string => {
    if (v.kind === 'money') return isolateAmount(formatMinor(v.minor, unit, language));
    if (v.kind === 'month') return formatMonth(v.month, language, today);
    if (v.kind === 'percent') return isolateAmount(new Intl.NumberFormat(getLocale(language), { style: 'percent' }).format(v.value / PERCENT));
    return isolate(v.text);
  };
  return (
    <section className="hp-report-section" aria-labelledby={heading}>
      <h2 id={heading}>{t(`${K}.insights.heading`)}</h2>
      {singleCurrency && <p className="hp-muted hp-report-note">{t(`${K}.insights.singleCurrency`, { currency: unit })}</p>}
      <ul className="hp-insights">
        {insights.map((insight) => (
          <li key={insight.id} className="hp-insight">
            {insight.parts
              .map((part) => {
                const vars = Object.fromEntries(Object.entries(part.values).map(([name, v]) => [name, value(v)]));
                return part.count === undefined ? t(`${K}.${part.key}`, vars) : tp(`${K}.${part.key}`, part.count, vars);
              })
              .join(' ')}
          </li>
        ))}
      </ul>
      {teaser && <TeaserCard teaser={teaser} />}
    </section>
  );
}

/** B8 / DR24: what unlocks next and when; dashed, a lock, one sentence, no dismiss. */
export function TeaserCard({ teaser }: { teaser: Teaser }) {
  const { t } = useLanguage();
  return (
    <div className="hp-teaser">
      <span className="hp-teaser-lock" aria-hidden="true">
        <LockIcon />
      </span>
      <p>{teaser.text}</p>
      {teaser.onSeeAll && (
        <button type="button" className="hp-link-button press" onClick={teaser.onSeeAll}>
          {t(`${K}.teaser.seeAll`)}
        </button>
      )}
    </div>
  );
}
