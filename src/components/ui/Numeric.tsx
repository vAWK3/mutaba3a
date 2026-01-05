import { type HTMLAttributes } from 'react';

export interface NumericProps extends HTMLAttributes<HTMLSpanElement> {
  value: number | string;
  format?: 'default' | 'currency' | 'percent';
  currency?: 'USD' | 'ILS';
  decimals?: number;
  sign?: boolean;
}

export function Numeric({
  value,
  format = 'default',
  currency = 'USD',
  decimals,
  sign = false,
  className = '',
  ...props
}: NumericProps) {
  const numericValue = typeof value === 'string' ? parseFloat(value) : value;

  let formatted: string;

  switch (format) {
    case 'currency': {
      const formatter = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
        minimumFractionDigits: decimals ?? 0,
        maximumFractionDigits: decimals ?? 2,
      });
      formatted = formatter.format(numericValue);
      break;
    }
    case 'percent': {
      const formatter = new Intl.NumberFormat('en-US', {
        style: 'percent',
        minimumFractionDigits: decimals ?? 0,
        maximumFractionDigits: decimals ?? 1,
      });
      formatted = formatter.format(numericValue / 100);
      break;
    }
    default: {
      const formatter = new Intl.NumberFormat('en-US', {
        minimumFractionDigits: decimals ?? 0,
        maximumFractionDigits: decimals ?? 2,
      });
      formatted = formatter.format(numericValue);
      if (sign && numericValue > 0) {
        formatted = '+' + formatted;
      }
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

export function Amount({ amountMinor, currency = 'USD', showSign = false, className = '', ...props }: AmountProps) {
  const amount = amountMinor / 100;

  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Math.abs(amount));

  const prefix = showSign && amount !== 0 ? (amount > 0 ? '+' : '-') : (amount < 0 ? '-' : '');

  return (
    <span className={`num ${className}`} {...props}>
      {prefix}{amount < 0 && !showSign ? formatted.replace('-', '') : formatted}
    </span>
  );
}
