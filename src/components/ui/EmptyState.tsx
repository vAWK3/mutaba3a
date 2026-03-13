import type { ReactNode } from 'react';

interface EmptyStateProps {
  title: string;
  description?: string;
  // Alternative props for convenience
  hint?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  // Alternative action props for convenience
  actionLabel?: string;
  onAction?: () => void;
  icon?: ReactNode;
}

/**
 * Generic empty state component for tables and lists.
 * Used across index pages (projects, clients, transactions).
 */
export function EmptyState({
  title,
  description,
  hint,
  action,
  actionLabel,
  onAction,
  icon,
}: EmptyStateProps) {
  // Support both prop styles
  const displayDescription = description || hint;
  const displayAction = action || (actionLabel && onAction ? { label: actionLabel, onClick: onAction } : undefined);

  return (
    <div className="empty-state">
      {icon && <div className="empty-state-icon">{icon}</div>}
      <h3 className="empty-state-title">{title}</h3>
      {displayDescription && (
        <p className="empty-state-description">{displayDescription}</p>
      )}
      {displayAction && (
        <button className="btn btn-primary" onClick={displayAction.onClick}>
          {displayAction.label}
        </button>
      )}
    </div>
  );
}
