/**
 * UnifiedAmount Component
 * Displays multi-currency amounts with proper conversion and breakdown.
 * Shows unified total (converted) plus raw per-currency amounts.
 */

import { useMemo } from 'react';
import { useFxRate } from '../../hooks/useFxRate';
import { getUnifiedTotal } from '../../lib/fx';
import { formatAmount, cn } from '../../lib/utils';
import { useLanguage, getLocale, useT } from '../../lib/i18n';
import type { Currency } from '../../types';

export interface UnifiedAmountProps {
  /** Amount in USD minor units (cents) */
  usdAmountMinor: number;
  /** Amount in ILS minor units (agorot) */
  ilsAmountMinor: number;
  /** Target currency for unified display (default: ILS) */
  unifiedCurrency?: Currency;
  /** Visual variant */
  variant?: 'default' | 'compact' | 'kpi';
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
  unifiedCurrency = 'ILS',
  variant = 'default',
  type = 'neutral',
  showSource = true,
  className,
}: UnifiedAmountProps) {
  const { rate, source } = useFxRate('USD', 'ILS');
  const { language } = useLanguage();
  const locale = getLocale(language);
  const t = useT();

  // Calculate unified total
  const unifiedTotal = useMemo(() => {
    return getUnifiedTotal(usdAmountMinor, ilsAmountMinor, unifiedCurrency, rate);
  }, [usdAmountMinor, ilsAmountMinor, unifiedCurrency, rate]);

  // Determine color class based on type and value
  const getColorClass = () => {
    if (type === 'income') return 'amount-positive';
    if (type === 'expense') return 'amount-negative';
    if (type === 'net') {
      if (unifiedTotal !== null) {
        return unifiedTotal >= 0 ? 'amount-positive' : 'amount-negative';
      }
      // Fallback: check if combined raw amounts are positive
      const rawNet = usdAmountMinor + ilsAmountMinor;
      return rawNet >= 0 ? 'amount-positive' : 'amount-negative';
    }
    return '';
  };

  const colorClass = getColorClass();

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
            {formatAmount(usdAmountMinor, 'USD', locale)} + {formatAmount(ilsAmountMinor, 'ILS', locale)}
          </span>
        )}
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
          <span className="breakdown-item">
            <span className="breakdown-currency">USD:</span>{' '}
            {formatAmount(usdAmountMinor, 'USD', locale)}
          </span>
          <span className="breakdown-separator">+</span>
          <span className="breakdown-item">
            <span className="breakdown-currency">ILS:</span>{' '}
            {formatAmount(ilsAmountMinor, 'ILS', locale)}
          </span>
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
        <span className="breakdown-item">
          {formatAmount(usdAmountMinor, 'USD', locale)}
        </span>
        <span className="breakdown-separator">+</span>
        <span className="breakdown-item">
          {formatAmount(ilsAmountMinor, 'ILS', locale)}
        </span>
      </div>
    </div>
  );
}
