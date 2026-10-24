import { useId, useLayoutEffect, useRef, type FocusEvent, type ReactNode } from 'react';
import { animate } from 'motion';
import { getLocale, useLanguage } from '../../../lib/i18n/core';
import { parseAmountToMinor } from '../../../lib/utils';
import type { Currency } from '../../api/client';
import { convertMoney, type Money, type Unit } from '../../data/reports';
import { minorToDecimal } from '../../format/currencies';
import { DecimalAmount } from '../../format/DecimalAmount';
import { formatDay } from '../../format/dates';
import { formatWhole } from '../../format/reportFormat';
import { usePopover } from '../../shell/usePopover';

/**
 * Reports' hero (MUT-175, DR2/DR4/DR9/DR21/DR28): Received as the anchor
 * figure, Spent and Kept beside it, all in whole units. With other currencies
 * converted, the figures carry ≈ and open the exact amount per currency with
 * the rate line (B5); with a rate missing, each currency stands on its own
 * line instead (D3). Figures count up on first load and morph after; the
 * moving digits are hidden from screen readers, which read the final value.
 */

const FIRST_COUNT_S = 0.6;
const MORPH_S = 0.4;
const RATE_DIGITS = 4;
/** The brand's spring curve (--m-ease-spring) as a cubic bezier. */
const SPRING_EASE = [0.2, 0.8, 0.2, 1] as const;

export function CountUp({ minor, currency, reducedMotion }: { minor: number; currency: Currency; reducedMotion: boolean }) {
  const { language } = useLanguage();
  const digits = useRef<HTMLSpanElement>(null);
  const shown = useRef<number | null>(null);
  useLayoutEffect(() => {
    const element = digits.current;
    if (!element) return;
    const paint = (value: number) => {
      element.textContent = formatWhole(Math.round(value), currency, language);
    };
    const from = shown.current;
    shown.current = minor;
    if (reducedMotion || from === minor || document.hidden) return paint(minor);
    const controls = animate(from ?? 0, minor, { duration: from === null ? FIRST_COUNT_S : MORPH_S, ease: from === null ? 'easeOut' : [...SPRING_EASE], onUpdate: paint });
    return () => controls.stop();
  }, [minor, currency, language, reducedMotion]);
  return (
    <>
      <span ref={digits} className="hp-countup" aria-hidden="true" />
      <span className="sr-only">{formatWhole(minor, currency, language)}</span>
    </>
  );
}

export interface HeroFiguresProps {
  received: Money;
  spent: Money;
  unit: Unit;
  caption: string;
  reducedMotion: boolean;
}

export function HeroFigures({ received, spent, unit, caption, reducedMotion }: HeroFiguresProps) {
  const { t } = useLanguage();
  const currencies = [...new Set([...received.keys(), ...spent.keys()])].filter((c) => (received.get(c) ?? 0) !== 0 || (spent.get(c) ?? 0) !== 0).sort();
  const converted = unit.rates ? { received: convertMoney(received, unit.rates), spent: convertMoney(spent, unit.rates) } : null;
  const approximate = Boolean(converted) && currencies.some((c) => c !== unit.currency);

  if (unit.singleCurrency) {
    // D3 / DR9: a rate is missing, so each currency is its own line
    return (
      <section className="hp-report-hero" aria-label={t('hosted.reports.title')}>
        <p className="hp-report-caption">{caption}</p>
        {currencies.map((currency) => (
          <Figures key={currency} received={received.get(currency) ?? 0} spent={spent.get(currency) ?? 0} currency={currency} approximate={false} reducedMotion={reducedMotion} />
        ))}
      </section>
    );
  }

  const minorIn = (value: { total: string } | null | undefined, money: Money) => (value ? parseAmountToMinor(value.total, unit.currency) : (money.get(unit.currency) ?? 0));
  return (
    <section className="hp-report-hero" aria-label={t('hosted.reports.title')}>
      <Figures
        received={minorIn(converted?.received, received)}
        spent={minorIn(converted?.spent, spent)}
        currency={unit.currency}
        approximate={approximate}
        reducedMotion={reducedMotion}
        breakdown={approximate && unit.rates ? { received, spent, currencies, rateDate: unit.rates.rateDate, rates: unit.rates.rates, base: unit.currency } : undefined}
      />
      <p className="hp-report-caption">{caption}</p>
    </section>
  );
}

interface Breakdown {
  received: Money;
  spent: Money;
  currencies: Currency[];
  rateDate: string;
  rates: ReadonlyArray<{ currency: Currency; rate: number; derived?: boolean }>;
  base: Currency;
}

function Figures({ received, spent, currency, approximate, reducedMotion, breakdown }: { received: number; spent: number; currency: Currency; approximate: boolean; reducedMotion: boolean; breakdown?: Breakdown }) {
  const { t } = useLanguage();
  const kept = received - spent;
  const mark = approximate ? '≈ ' : '';
  return (
    <div className="hp-report-figures">
      <div className="hp-report-received">
        <span className="hp-report-label">{t('hosted.reports.hero.received')}</span>
        {breakdown ? (
          <BreakdownButton breakdown={breakdown}>
            {mark}
            <CountUp minor={received} currency={currency} reducedMotion={reducedMotion} />
          </BreakdownButton>
        ) : (
          <span className="hp-report-big">
            {mark}
            <CountUp minor={received} currency={currency} reducedMotion={reducedMotion} />
          </span>
        )}
      </div>
      <div className="hp-report-pair">
        <div>
          <span className="hp-report-label">{t('hosted.reports.hero.spent')}</span>
          <span className="hp-report-mid">
            {mark}
            <CountUp minor={spent} currency={currency} reducedMotion={reducedMotion} />
          </span>
        </div>
        <div>
          <span className="hp-report-label">{t('hosted.reports.hero.kept')}</span>
          <span className="hp-report-mid">
            {mark}
            <CountUp minor={kept} currency={currency} reducedMotion={reducedMotion} />
          </span>
          {kept < 0 && <span className="hp-report-note">{t('hosted.reports.hero.keptNegative')}</span>}
        </div>
      </div>
    </div>
  );
}

/** The ≈ figure as a ≥ 44px button: hover, focus or tap opens the exact amounts; Esc or an outside tap closes. */
function BreakdownButton({ breakdown, children }: { breakdown: Breakdown; children: ReactNode }) {
  const { t, language } = useLanguage();
  const { open, setOpen, close, buttonRef, panelRef } = usePopover();
  const closing = useRef(false);
  /** A click closes only what a click opened: on a mouse, hover has already opened it. */
  const openedByClick = useRef(false);
  const panelId = useId();
  const number = new Intl.NumberFormat(getLocale(language), { maximumFractionDigits: RATE_DIGITS });
  const rateLines = breakdown.currencies
    .filter((c) => c !== breakdown.base)
    .flatMap((c) => {
      const rate = breakdown.rates.find((r) => r.currency === c);
      if (!rate) return [];
      const line = t('hosted.groups.detail.rateLine', { from: c, rate: number.format(1 / rate.rate), to: breakdown.base });
      return [rate.derived ? `${line} (${t('hosted.groups.detail.peg')})` : line];
    });
  const onFocus = (event: FocusEvent<HTMLButtonElement>) => {
    // Focus coming back from Esc must not reopen what was just closed
    if (closing.current || !event.currentTarget.matches(':focus-visible')) return;
    setOpen(true);
  };
  const dismiss = () => {
    closing.current = true;
    openedByClick.current = false;
    close();
    closing.current = false;
  };
  const onClick = () => {
    if (open && openedByClick.current) return dismiss();
    openedByClick.current = true;
    setOpen(true);
  };
  return (
    <span className="hp-report-breakdown" onMouseLeave={() => open && !openedByClick.current && close(false)}>
      <button
        ref={buttonRef}
        type="button"
        className="hp-report-big hp-report-approx press"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-description={t('hosted.reports.hero.breakdownOpen')}
        onClick={onClick}
        onMouseEnter={() => setOpen(true)}
        onFocus={onFocus}
        onKeyDown={(event) => event.key === 'Escape' && open && dismiss()}
      >
        {children}
      </button>
      {open && (
        <div ref={panelRef} id={panelId} className="hp-popover hp-report-breakdown-panel" role="group" aria-label={t('hosted.reports.hero.breakdownTitle')}>
          <table className="hp-report-breakdown-table">
            <thead>
              <tr>
                <th scope="col">
                  <span className="sr-only">{t('hosted.reports.hero.breakdownTitle')}</span>
                </th>
                <th scope="col">{t('hosted.reports.hero.received')}</th>
                <th scope="col">{t('hosted.reports.hero.spent')}</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.currencies.map((c) => (
                <tr key={c}>
                  <th scope="row">{c}</th>
                  <td>
                    <DecimalAmount value={minorToDecimal(breakdown.received.get(c) ?? 0, c)} currency={c} />
                  </td>
                  <td>
                    <DecimalAmount value={minorToDecimal(breakdown.spent.get(c) ?? 0, c)} currency={c} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hp-popover-foot">{[...rateLines, t('hosted.reports.hero.rateFooter', { date: formatDay(breakdown.rateDate, language) })].join(' · ')}</p>
        </div>
      )}
    </span>
  );
}
