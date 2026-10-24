import { Fragment, useId, type ReactNode } from 'react';
import { getLocale, useLanguage } from '../../../lib/i18n/core';
import { useTp } from '../../../lib/i18n/plural';
import type { Language } from '../../../lib/i18n/types';
import type { Currency } from '../../api/client';
import type { Insight, InsightPart, InsightValue } from '../../data/reportInsights';
import { formatMinor, formatMonth } from '../../format/reportFormat';
import { LockIcon } from '../Icons';

/**
 * "Lately" (MUT-175, DR16/DR19/DR20): up to three plain sentences, the key
 * figures in the number face, normal ink, no icons or colour. When a rate is
 * missing they speak of one currency and say so (D3). The teaser, when there
 * is one, is the block's last line (DR3). Each value is its own <bdi>, so a
 * name or an amount reads whole in either direction (ADR-101).
 */

const K = 'hosted.reports';
const PERCENT = 100;
/** Marks a value's place in a translated sentence; no translation contains it. */
const MARK = '\u0001';
const MARKED = new RegExp(`(${MARK}\\d+${MARK})`);

export interface Teaser {
  text: string;
  /** DS5: "See insights across all profiles", which turns the switch on. */
  onSeeAll?: () => void;
}

function valueNode(v: InsightValue, unit: Currency, language: Language, today: string): ReactNode {
  if (v.kind === 'money') return <bdi className="hp-insight-figure">{formatMinor(v.minor, unit, language)}</bdi>;
  if (v.kind === 'percent') return <bdi className="hp-insight-figure">{new Intl.NumberFormat(getLocale(language), { style: 'percent' }).format(v.value / PERCENT)}</bdi>;
  if (v.kind === 'month') return formatMonth(v.month, language, today);
  return <bdi>{v.text}</bdi>;
}

export function InsightList({ insights, unit, singleCurrency, today, teaser }: { insights: readonly Insight[]; unit: Currency; singleCurrency: boolean; today: string; teaser: Teaser | null }) {
  const { t, language } = useLanguage();
  const tp = useTp();
  const heading = useId();
  const sentence = (part: InsightPart): ReactNode[] => {
    const entries = Object.entries(part.values).map(([name, value], i) => ({ name, value, mark: `${MARK}${i}${MARK}` }));
    const byMark = new Map(entries.map((e) => [e.mark, e.value]));
    const marks = Object.fromEntries(entries.map((e) => [e.name, e.mark]));
    const text = part.count === undefined ? t(`${K}.${part.key}`, marks) : tp(`${K}.${part.key}`, part.count, marks);
    return text.split(MARKED).map((piece, i) => {
      const value = byMark.get(piece);
      return value ? <Fragment key={i}>{valueNode(value, unit, language, today)}</Fragment> : piece;
    });
  };
  return (
    <section className="hp-report-section" aria-labelledby={heading}>
      <h2 id={heading}>{t(`${K}.insights.heading`)}</h2>
      {singleCurrency && <p className="hp-muted hp-report-note">{t(`${K}.insights.singleCurrency`, { currency: unit })}</p>}
      <ul className="hp-insights">
        {insights.map((insight) => (
          <li key={insight.id} className="hp-insight">
            {insight.parts.map((part, i) => (
              <Fragment key={part.key}>
                {i > 0 && ' '}
                {sentence(part)}
              </Fragment>
            ))}
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
