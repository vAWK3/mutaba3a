/**
 * AmountWithConversion Component
 * Displays a single-currency amount with hover tooltip showing ILS-converted value.
 * Used in transaction tables where each row has a single currency.
 */

import { useMemo } from 'react';
import { useFxRate } from '../../hooks/useFxRate';
import { convertAmount } from '../../lib/fx';
import { formatAmount, cn } from '../../lib/utils';
import { useLanguage, getLocale, useT } from '../../lib/i18n';
import type { Currency } from '../../types';

export interface AmountWithConversionProps {
  /** Amount in minor units (cents/agorot) */
  amountMinor: number;
  /** Currency of the amount */
  currency: Currency;
  /** Semantic type for color styling */
  type?: 'income' | 'expense' | 'neutral';
  /** Show negative sign prefix for expenses */
  showExpenseSign?: boolean;
  /** Additional CSS class */
  className?: string;
}

export function AmountWithConversion({
  amountMinor,
  currency,
  type = 'neutral',
  showExpenseSign = false,
  className,
}: AmountWithConversionProps) {
  const { rate: usdToIlsRate, source: usdSource } = useFxRate('USD', 'ILS');
  const { rate: eurToIlsRate, source: eurSource } = useFxRate('EUR', 'ILS');
  const { language } = useLanguage();
  const locale = getLocale(language);
  const t = useT();

  // Build tooltip with conversion info
  const tooltipText = useMemo(() => {
    // If already ILS, no conversion needed
    if (currency === 'ILS') {
      return undefined;
    }

    // Get the appropriate rate
    const rate = currency === 'USD' ? usdToIlsRate : eurToIlsRate;
    const source = currency === 'USD' ? usdSource : eurSource;

    if (!rate || rate <= 0) {
      return t('fx.none');
    }

    // Convert to ILS
    const convertedMinor = convertAmount(amountMinor, currency, 'ILS', rate);
    const formattedConverted = formatAmount(Math.abs(convertedMinor), 'ILS', locale);

    // Format rate display
    const currencySymbol = currency === 'USD' ? '$' : '€';
    const rateDisplay = `${currencySymbol}1 = ${rate.toFixed(2)} ₪`;
    const sourceLabel = t(`fx.${source}`);

    return `≈ ${formattedConverted} (${rateDisplay}, ${sourceLabel})`;
  }, [currency, amountMinor, usdToIlsRate, eurToIlsRate, usdSource, eurSource, locale, t]);

  // Determine color class based on type
  const colorClass = type === 'income' ? 'amount-positive' :
                     type === 'expense' ? 'amount-negative' : '';

  // Format the displayed amount
  const formattedAmount = formatAmount(Math.abs(amountMinor), currency, locale);
  const prefix = showExpenseSign && type === 'expense' ? '-' : '';

  return (
    <span
      className={cn(colorClass, className)}
      title={tooltipText}
      style={tooltipText ? { cursor: 'help' } : undefined}
    >
      {prefix}{formattedAmount}
    </span>
  );
}
