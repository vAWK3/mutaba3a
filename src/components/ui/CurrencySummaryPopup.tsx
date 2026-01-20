/**
 * CurrencySummaryPopup Component
 * Displays a unified amount with a clickable icon that shows a popup breakdown of USD and ILS.
 */

import { useState, useRef, useEffect } from 'react';
import { useFxRate } from '../../hooks/useFxRate';
import { getUnifiedTotal } from '../../lib/fx';
import { formatAmount, cn } from '../../lib/utils';
import { useLanguage, getLocale, useT } from '../../lib/i18n';
import type { Currency } from '../../types';

export interface CurrencySummaryPopupProps {
  /** Amount in USD minor units (cents) */
  usdAmountMinor: number;
  /** Amount in ILS minor units (agorot) */
  ilsAmountMinor: number;
  /** Target currency for unified display (default: ILS) */
  unifiedCurrency?: Currency;
  /** Semantic type for color styling */
  type?: 'income' | 'expense' | 'net' | 'neutral';
  /** Label for the amount (optional) */
  label?: string;
  /** Size variant */
  size?: 'default' | 'large';
  /** Additional CSS class */
  className?: string;
}

export function CurrencySummaryPopup({
  usdAmountMinor,
  ilsAmountMinor,
  unifiedCurrency = 'ILS',
  type = 'neutral',
  label,
  size = 'default',
  className,
}: CurrencySummaryPopupProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { rate, source } = useFxRate('USD', 'ILS');
  const { language } = useLanguage();
  const locale = getLocale(language);
  const t = useT();

  // Calculate unified total
  const unifiedTotal = getUnifiedTotal(usdAmountMinor, ilsAmountMinor, unifiedCurrency, rate);

  // Close popup when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Close on escape
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen]);

  // Determine color class based on type and value
  const getColorClass = () => {
    if (type === 'income') return 'amount-positive';
    if (type === 'expense') return 'amount-negative';
    if (type === 'net') {
      if (unifiedTotal !== null) {
        return unifiedTotal >= 0 ? 'amount-positive' : 'amount-negative';
      }
      const rawNet = usdAmountMinor + ilsAmountMinor;
      return rawNet >= 0 ? 'amount-positive' : 'amount-negative';
    }
    return '';
  };

  const colorClass = getColorClass();

  return (
    <div ref={containerRef} className={cn('currency-summary-popup', className)}>
      {label && <span className="currency-summary-label">{label}</span>}
      <div className="currency-summary-main">
        <span className={cn('currency-summary-amount', colorClass, size === 'large' && 'large')}>
          {unifiedTotal !== null
            ? formatAmount(unifiedTotal, unifiedCurrency, locale)
            : `${formatAmount(usdAmountMinor, 'USD', locale)} + ${formatAmount(ilsAmountMinor, 'ILS', locale)}`}
        </span>
        <button
          type="button"
          className="currency-summary-toggle"
          onClick={() => setIsOpen(!isOpen)}
          aria-label="Show currency breakdown"
          title="Show currency breakdown"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
            <path d="M8 4.5V8.5M8 11V11.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {isOpen && (
        <div className="currency-summary-dropdown">
          <div className="currency-breakdown-row">
            <span className="currency-breakdown-label">USD</span>
            <span className={cn('currency-breakdown-value', colorClass)}>
              {formatAmount(usdAmountMinor, 'USD', locale)}
            </span>
          </div>
          <div className="currency-breakdown-row">
            <span className="currency-breakdown-label">ILS</span>
            <span className={cn('currency-breakdown-value', colorClass)}>
              {formatAmount(ilsAmountMinor, 'ILS', locale)}
            </span>
          </div>
          {rate && (
            <div className="currency-breakdown-rate">
              <span className="currency-breakdown-rate-label">
                {t('fx.bannerTitle')}: 1 USD = {rate.toFixed(2)} ILS
              </span>
              <span className={cn('currency-breakdown-source', `source-${source}`)}>
                ({t(`fx.${source}`)})
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
