import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import './Button.css';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
  isLoading?: boolean;
  /**
   * While loading, keep the label beside the spinner and stay focusable (aria-disabled, clicks ignored) instead of
   * hiding the label and disabling. For a busy button a person is watching, e.g. "Continue to payment" (MUT-362 DR4).
   */
  keepLabelWhileLoading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', children, isLoading, keepLabelWhileLoading, disabled, className = '', onClick, ...props }, ref) => {
    const busyInPlace = Boolean(isLoading && keepLabelWhileLoading);
    const classes = [
      'btn',
      `btn-${variant}`,
      `btn-${size}`,
      isLoading && 'btn-loading',
      busyInPlace && 'btn-loading-labelled',
      className,
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <button
        ref={ref}
        className={classes}
        disabled={disabled || (isLoading && !busyInPlace)}
        aria-disabled={busyInPlace || undefined}
        onClick={busyInPlace ? undefined : onClick}
        {...props}
      >
        {isLoading && <span className="btn-spinner" aria-hidden="true" />}
        <span className={isLoading && !busyInPlace ? 'btn-content-hidden' : ''}>{children}</span>
      </button>
    );
  }
);

Button.displayName = 'Button';
