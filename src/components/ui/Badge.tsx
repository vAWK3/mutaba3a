import { type HTMLAttributes, type ReactNode } from 'react';
import './Badge.css';

export type BadgeVariant = 'paid' | 'unpaid' | 'overdue' | 'neutral' | 'success' | 'warning' | 'error' | 'info' | 'accent';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: 'sm' | 'md';
  children: ReactNode;
}

export function Badge({ variant = 'neutral', size = 'md', children, className = '', ...props }: BadgeProps) {
  const classes = ['badge', `badge-${variant}`, `badge-${size}`, className]
    .filter(Boolean)
    .join(' ');

  return (
    <span className={classes} {...props}>
      {children}
    </span>
  );
}

// Convenience components for common status badges
export function PaidBadge({ children = 'Paid', ...props }: Omit<BadgeProps, 'variant'>) {
  return <Badge variant="paid" {...props}>{children}</Badge>;
}

export function UnpaidBadge({ children = 'Unpaid', ...props }: Omit<BadgeProps, 'variant'>) {
  return <Badge variant="unpaid" {...props}>{children}</Badge>;
}

export function OverdueBadge({ children = 'Overdue', ...props }: Omit<BadgeProps, 'variant'>) {
  return <Badge variant="overdue" {...props}>{children}</Badge>;
}

// Type badge for Income/Expense/Receivable
export type TypeBadgeVariant = 'income' | 'expense' | 'receivable';

export interface TypeBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  type: TypeBadgeVariant;
  size?: 'sm' | 'md';
}

export function TypeBadge({ type, size = 'md', className = '', ...props }: TypeBadgeProps) {
  const variantMap: Record<TypeBadgeVariant, BadgeVariant> = {
    income: 'success',
    expense: 'neutral',
    receivable: 'warning',
  };

  const labelMap: Record<TypeBadgeVariant, string> = {
    income: 'Income',
    expense: 'Expense',
    receivable: 'Receivable',
  };

  return (
    <Badge variant={variantMap[type]} size={size} className={className} {...props}>
      {labelMap[type]}
    </Badge>
  );
}
