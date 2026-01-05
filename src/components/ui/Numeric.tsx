import { type HTMLAttributes, useMemo } from 'react';
import { useLanguage, getLocale } from '../../lib/i18n';

export interface NumericProps extends HTMLAttributes<HTMLSpanElement> {
  value: number | string;
  format?: 'default' | 'currency' | 'percent';
  currency?: 'USD' | 'ILS';
  decimals?: number;
  sign?: boolean;
  /** Override locale (defaults to current language's locale) */
  locale?: string;
}

export function Numeric({
  value,
  format = 'default',
  currency = 'USD',
  decimals,
  sign = false,
  locale: localeProp,
  className = '',
  ...props
}: NumericProps) {
  const { language } = useLanguage();
  const locale = localeProp ?? getLocale(language);
  const numericValue = typeof value === 'string' ? parseFloat(value) : value;

  // Memoize formatters to avoid recreating Intl.NumberFormat on every render
  const formatter = useMemo(() => {
    switch (format) {
      case 'currency':
        return new Intl.NumberFormat(locale, {
          style: 'currency',
          currency,
          minimumFractionDigits: decimals ?? 0,
          maximumFractionDigits: decimals ?? 2,
        });
      case 'percent':
        return new Intl.NumberFormat(locale, {
          style: 'percent',
          minimumFractionDigits: decimals ?? 0,
          maximumFractionDigits: decimals ?? 1,
        });
      default:
        return new Intl.NumberFormat(locale, {
          minimumFractionDigits: decimals ?? 0,
          maximumFractionDigits: decimals ?? 2,
        });
    }
  }, [format, locale, currency, decimals]);

  let formatted: string;
  if (format === 'percent') {
    formatted = formatter.format(numericValue / 100);
  } else {
    formatted = formatter.format(numericValue);
    if (sign && numericValue > 0) {
      formatted = '+' + formatted;
    }
  }

  return (
    <span className={`num ${className}`} {...props}>
      {formatted}
    </span>
  );
}

// Amount helper that displays amounts in minor units (cents/agorot)
export interface AmountProps extends Omit<NumericProps, 'value' | 'format'> {
  amountMinor: number;
  currency?: 'USD' | 'ILS';
  showSign?: boolean;
}

export function Amount({ amountMinor, currency = 'USD', showSign = false, locale: localeProp, className = '', ...props }: AmountProps) {
  const { language } = useLanguage();
  const locale = localeProp ?? getLocale(language);
  const amount = amountMinor / 100;

  // Memoize formatter to avoid recreating Intl.NumberFormat on every render
  const formatter = useMemo(() => new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }), [locale, currency]);

  const formatted = formatter.format(Math.abs(amount));
  const prefix = showSign && amount !== 0 ? (amount > 0 ? '+' : '-') : (amount < 0 ? '-' : '');

  return (
    <span className={`num ${className}`} {...props}>
      {prefix}{amount < 0 && !showSign ? formatted.replace('-', '') : formatted}
    </span>
  );
}
