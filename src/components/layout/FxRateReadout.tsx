import { useId, useLayoutEffect, useRef } from 'react';
import { useFxRate, type UseFxRateResult } from '../../hooks/useFxRate';
import { useMenuButton } from '../../hooks/useMenuButton';
import { useT, useLanguage, getLocale } from '../../lib/i18n';
import { cn, formatDate, formatRelativeDate } from '../../lib/utils';
import { nudgeInside, POPOVER_EDGE_MARGIN } from './popoverPosition';
import './FxRateReadout.css';

/**
 * The top bar's exchange rate (MUT-79, decision A1): a quiet `$1 = ₪3.06`
 * that opens a small dialog with the dollar and euro rates, where each came
 * from, the rates' date and a Refresh. It replaces the floating FxRateBanner,
 * so nothing covers the page.
 */

const QUOTE_SYMBOL = '₪';
const NO_RATE = '—';
const READOUT_DECIMALS = 2;
const DETAIL_DECIMALS = 4;

/** `$1 = ₪3.06` in the reader's digits; a dash when there is no rate. */
function formatRateLine(baseSymbol: string, rate: number | null, decimals: number, locale: string): string {
  const one = new Intl.NumberFormat(locale).format(1);
  const value =
    rate === null
      ? NO_RATE
      : new Intl.NumberFormat(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(rate);
  return `${baseSymbol}${one} = ${QUOTE_SYMBOL}${value}`;
}

export function FxRateReadout() {
  const t = useT();
  const locale = getLocale(useLanguage().language);
  const popover = useMenuButton({ kind: 'dialog' });
  const titleId = useId();
  const usd = useFxRate('USD', 'ILS');
  const eur = useFxRate('EUR', 'ILS');

  const pairs: { key: string; symbol: string; fx: UseFxRateResult }[] = [
    { key: 'USD', symbol: '$', fx: usd },
    { key: 'EUR', symbol: '€', fx: eur },
  ];
  const readout = formatRateLine('$', usd.rate, READOUT_DECIMALS, locale);
  const isLoading = usd.isLoading || eur.isLoading;
  const hasRate = usd.source !== 'none';

  // Keep the panel inside <main> (which clips it) on a narrow window, before paint
  const rootRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const panel = rootRef.current?.querySelector<HTMLElement>('.fx-popover');
    const bounds = panel?.closest('main');
    if (!panel || !bounds) return;
    const dx = nudgeInside(panel.getBoundingClientRect(), bounds.getBoundingClientRect(), POPOVER_EDGE_MARGIN);
    panel.style.translate = dx === 0 ? '' : `${dx}px 0`;
  }, [popover.isOpen]);

  const refresh = () => {
    usd.refetch();
    eur.refetch();
  };

  return (
    <div ref={rootRef} className="fx-readout">
      <button
        {...popover.buttonProps}
        type="button"
        className="fx-readout-button"
        aria-label={t('fx.readoutLabel', { rate: readout })}
      >
        <bdi dir="ltr" className="fx-formula">{readout}</bdi>
        <ChevronIcon />
      </button>
      {popover.isOpen && (
        <div {...popover.menuProps} className="fx-popover" aria-labelledby={titleId}>
          <h2 id={titleId} className="fx-popover-title">
            {t('fx.title')}
          </h2>
          <dl className="fx-popover-rates">
            {pairs.map(({ key, symbol, fx }) => (
              <div key={key} className="fx-popover-rate">
                <dt>
                  <bdi dir="ltr" className="fx-formula">{formatRateLine(symbol, fx.rate, DETAIL_DECIMALS, locale)}</bdi>
                </dt>
                <dd className={cn('fx-popover-source', `source-${fx.source}`)}>{t(`fx.${fx.source}`)}</dd>
              </div>
            ))}
          </dl>
          {hasRate && usd.rateDate && (
            <p className="fx-popover-meta">
              {t('fx.rateDate', { date: formatDate(`${usd.rateDate}T00:00:00`, locale) })}
            </p>
          )}
          {hasRate && usd.lastUpdated && (
            <p className="fx-popover-meta">{t('fx.updated', { time: formatRelativeDate(usd.lastUpdated, t) })}</p>
          )}
          <button type="button" className="btn btn-secondary btn-sm fx-popover-refresh" onClick={refresh} disabled={isLoading}>
            <RefreshIcon spinning={isLoading} />
            {t('fx.refresh')}
          </button>
        </div>
      )}
    </div>
  );
}

function ChevronIcon() {
  return (
    <svg className="fx-readout-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
    </svg>
  );
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      className={cn('fx-popover-refresh-icon', spinning && 'spinning')}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
      />
    </svg>
  );
}
