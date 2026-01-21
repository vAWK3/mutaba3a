/**
 * UnifiedAmount Component
 * Displays multi-currency amounts with proper conversion and breakdown.
 * Shows unified total (converted) plus raw per-currency amounts.
 */

import { useMemo } from 'react';
import { useFxRate } from '../../hooks/useFxRate';
import { getUnifiedTotalWithEur } from '../../lib/fx';
import { formatAmount, cn } from '../../lib/utils';
import { useLanguage, getLocale, useT } from '../../lib/i18n';
import type { Currency } from '../../types';

export interface UnifiedAmountProps {
  /** Amount in USD minor units (cents) */
  usdAmountMinor: number;
  /** Amount in ILS minor units (agorot) */
  ilsAmountMinor: number;
  /** Amount in EUR minor units (cents) */
  eurAmountMinor?: number;
  /** Target currency for unified display (default: ILS) */
  unifiedCurrency?: Currency;
  /** Visual variant: 'table' shows just the total with hover tooltip for breakdown */
  variant?: 'default' | 'compact' | 'kpi' | 'table';
  /** Semantic type for color styling */
  type?: 'income' | 'expense' | 'net' | 'neutral';
  /** Show rate source indicator */
  showSource?: boolean;
  /** Additional CSS class */
  className?: string;
}

export function UnifiedAmount({
  usdAmountMinor,
  ilsAmountMinor,
  eurAmountMinor = 0,
  unifiedCurrency = 'ILS',
  variant = 'default',
  type = 'neutral',
  showSource = true,
  className,
}: UnifiedAmountProps) {
  const { rate: usdRate, source: usdSource } = useFxRate('USD', 'ILS');
  const { rate: eurRate, source: eurSource } = useFxRate('EUR', 'ILS');
  const { language } = useLanguage();
  const locale = getLocale(language);
  const t = useT();

  // Combined source status (use worst case for indicator)
  const source = usdSource === 'none' || eurSource === 'none' ? 'none' :
    usdSource === 'cached' || eurSource === 'cached' ? 'cached' : 'live';

  // Calculate unified total with EUR support
  const unifiedTotal = useMemo(() => {
    return getUnifiedTotalWithEur(usdAmountMinor, ilsAmountMinor, eurAmountMinor, usdRate, eurRate);
  }, [usdAmountMinor, ilsAmountMinor, eurAmountMinor, usdRate, eurRate]);

  // Determine color class based on type and value
  const getColorClass = () => {
    if (type === 'income') return 'amount-positive';
    if (type === 'expense') return 'amount-negative';
    if (type === 'net') {
      if (unifiedTotal !== null) {
        return unifiedTotal >= 0 ? 'amount-positive' : 'amount-negative';
      }
      // Fallback: check if combined raw amounts are positive
      const rawNet = usdAmountMinor + ilsAmountMinor + eurAmountMinor;
      return rawNet >= 0 ? 'amount-positive' : 'amount-negative';
    }
    return '';
  };

  const colorClass = getColorClass();

  // Build fallback text with all currencies that have values
  const buildFallbackText = () => {
    const parts: string[] = [];
    if (usdAmountMinor !== 0) parts.push(formatAmount(usdAmountMinor, 'USD', locale));
    if (ilsAmountMinor !== 0) parts.push(formatAmount(ilsAmountMinor, 'ILS', locale));
    if (eurAmountMinor !== 0) parts.push(formatAmount(eurAmountMinor, 'EUR', locale));
    return parts.length > 0 ? parts.join(' + ') : formatAmount(0, 'ILS', locale);
  };

  // Compact variant: single line with smaller breakdown
  if (variant === 'compact') {
    return (
      <span className={cn('unified-amount-compact', colorClass, className)}>
        {unifiedTotal !== null ? (
          <>
            <span className="unified-total">
              {formatAmount(unifiedTotal, unifiedCurrency, locale)}
            </span>
            {showSource && source !== 'live' && (
              <span className={cn('fx-indicator', `source-${source}`)} title={t(`fx.${source}`)}>
                *
              </span>
            )}
          </>
        ) : (
          <span className="unified-fallback">
            {buildFallbackText()}
          </span>
        )}
      </span>
    );
  }

  // Table variant: shows unified total with hover tooltip showing breakdown
  if (variant === 'table') {
    // Build tooltip with all currencies that have values
    const tooltipParts: string[] = [];
    if (usdAmountMinor !== 0) tooltipParts.push(`USD: ${formatAmount(usdAmountMinor, 'USD', locale)}`);
    if (ilsAmountMinor !== 0) tooltipParts.push(`ILS: ${formatAmount(ilsAmountMinor, 'ILS', locale)}`);
    if (eurAmountMinor !== 0) tooltipParts.push(`EUR: ${formatAmount(eurAmountMinor, 'EUR', locale)}`);
    const tooltipText = tooltipParts.length > 0 ? tooltipParts.join(' + ') : '-';

    if (unifiedTotal !== null) {
      return (
        <span
          className={cn(colorClass, className)}
          title={tooltipText}
          style={{ cursor: 'help' }}
        >
          {formatAmount(unifiedTotal, unifiedCurrency, locale)}
        </span>
      );
    }

    // Fallback when no FX rate available
    return (
      <span className={cn(colorClass, className)} title={tooltipText}>
        {buildFallbackText()}
      </span>
    );
  }

  // KPI variant: larger unified number with breakdown below
  if (variant === 'kpi') {
    return (
      <div className={cn('unified-amount-kpi', className)}>
        {unifiedTotal !== null ? (
          <div className={cn('unified-total', colorClass)}>
            {formatAmount(unifiedTotal, unifiedCurrency, locale)}
            {showSource && (
              <span className={cn('fx-source-badge', `source-${source}`)}>
                {t(`fx.${source}`)}
              </span>
            )}
          </div>
        ) : (
          <div className={cn('unified-total', colorClass)}>—</div>
        )}
        <div className="unified-breakdown">
          {usdAmountMinor !== 0 && (
            <>
              <span className="breakdown-item">
                <span className="breakdown-currency">USD:</span>{' '}
                {formatAmount(usdAmountMinor, 'USD', locale)}
              </span>
              {(ilsAmountMinor !== 0 || eurAmountMinor !== 0) && <span className="breakdown-separator">+</span>}
            </>
          )}
          {ilsAmountMinor !== 0 && (
            <>
              <span className="breakdown-item">
                <span className="breakdown-currency">ILS:</span>{' '}
                {formatAmount(ilsAmountMinor, 'ILS', locale)}
              </span>
              {eurAmountMinor !== 0 && <span className="breakdown-separator">+</span>}
            </>
          )}
          {eurAmountMinor !== 0 && (
            <span className="breakdown-item">
              <span className="breakdown-currency">EUR:</span>{' '}
              {formatAmount(eurAmountMinor, 'EUR', locale)}
            </span>
          )}
          {usdAmountMinor === 0 && ilsAmountMinor === 0 && eurAmountMinor === 0 && (
            <span className="breakdown-item text-muted">-</span>
          )}
        </div>
      </div>
    );
  }

  // Default variant: unified total with breakdown
  return (
    <div className={cn('unified-amount', className)}>
      {unifiedTotal !== null && (
        <div className={cn('unified-total', colorClass)}>
          {formatAmount(unifiedTotal, unifiedCurrency, locale)}
          {showSource && (
            <span className={cn('fx-source-badge', `source-${source}`)}>
              {t(`fx.${source}`)}
            </span>
          )}
        </div>
      )}
      <div className="unified-breakdown">
        {usdAmountMinor !== 0 && (
          <>
            <span className="breakdown-item">
              {formatAmount(usdAmountMinor, 'USD', locale)}
            </span>
            {(ilsAmountMinor !== 0 || eurAmountMinor !== 0) && <span className="breakdown-separator">+</span>}
          </>
        )}
        {ilsAmountMinor !== 0 && (
          <>
            <span className="breakdown-item">
              {formatAmount(ilsAmountMinor, 'ILS', locale)}
            </span>
            {eurAmountMinor !== 0 && <span className="breakdown-separator">+</span>}
          </>
        )}
        {eurAmountMinor !== 0 && (
          <span className="breakdown-item">
            {formatAmount(eurAmountMinor, 'EUR', locale)}
          </span>
        )}
        {usdAmountMinor === 0 && ilsAmountMinor === 0 && eurAmountMinor === 0 && (
          <span className="breakdown-item text-muted">-</span>
        )}
      </div>
    </div>
  );
}
