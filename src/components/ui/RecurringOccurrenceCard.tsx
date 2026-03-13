/**
 * RecurringOccurrenceCard Component
 *
 * Displays a recurring expense occurrence with computed state and actions.
 * Handles:
 * - State display (projected, due, overdue, snoozed)
 * - Quick actions (Mark Paid, Skip, Snooze)
 * - Click to open confirm payment modal
 */

import { useT } from '../../lib/i18n';
import { formatAmount, formatDate } from '../../lib/utils';
import type { VirtualOccurrenceDisplay } from '../../types';
import './RecurringOccurrenceCard.css';

interface RecurringOccurrenceCardProps {
  occurrence: VirtualOccurrenceDisplay;
  onMarkPaid: (occurrence: VirtualOccurrenceDisplay) => void;
  onSkip: (occurrence: VirtualOccurrenceDisplay) => void;
  onSnooze: (occurrence: VirtualOccurrenceDisplay) => void;
  onClick?: (occurrence: VirtualOccurrenceDisplay) => void;
  compact?: boolean;
}

export function RecurringOccurrenceCard({
  occurrence,
  onMarkPaid,
  onSkip,
  onSnooze,
  onClick,
  compact = false,
}: RecurringOccurrenceCardProps) {
  const t = useT();

  const getStateLabel = (): string => {
    const persisted = occurrence.persistedOccurrence;

    if (persisted?.status === 'snoozed' && persisted.snoozeUntil) {
      return t('expenses.recurring.occurrence.snoozedUntil', {
        date: formatDate(persisted.snoozeUntil),
      });
    }

    switch (occurrence.computedState) {
      case 'overdue':
        return t('expenses.recurring.occurrence.overdueDays', {
          days: Math.abs(occurrence.daysUntilDue),
        });
      case 'due':
        if (occurrence.daysUntilDue === 0) {
          return t('expenses.recurring.occurrence.dueToday');
        }
        return t('expenses.recurring.occurrence.dueIn', {
          days: occurrence.daysUntilDue,
        });
      case 'projected':
      default:
        return t('expenses.recurring.occurrence.state.projected');
    }
  };

  const getStateClass = (): string => {
    const persisted = occurrence.persistedOccurrence;
    if (persisted?.status === 'snoozed') return 'state-snoozed';

    switch (occurrence.computedState) {
      case 'overdue':
        return 'state-overdue';
      case 'due':
        return 'state-due';
      case 'projected':
      default:
        return 'state-projected';
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    // Don't trigger card click if clicking on action buttons
    if ((e.target as HTMLElement).closest('.occurrence-actions')) {
      return;
    }
    onClick?.(occurrence);
  };

  return (
    <div
      className={`recurring-occurrence-card ${getStateClass()} ${compact ? 'compact' : ''}`}
      onClick={handleClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className="occurrence-main">
        <div className="occurrence-info">
          <span className="occurrence-title">{occurrence.ruleTitle}</span>
          {occurrence.vendorName && (
            <span className="occurrence-vendor">{occurrence.vendorName}</span>
          )}
          {occurrence.categoryName && (
            <span
              className="occurrence-category"
              style={{ backgroundColor: occurrence.categoryColor }}
            >
              {occurrence.categoryName}
            </span>
          )}
        </div>

        <div className="occurrence-amount">
          {formatAmount(occurrence.effectiveAmount, occurrence.effectiveCurrency)}
        </div>
      </div>

      <div className="occurrence-meta">
        <span className="occurrence-date">
          {t('expenses.recurring.occurrence.expectedOn')} {formatDate(occurrence.expectedDate)}
        </span>
        <span className={`occurrence-state ${getStateClass()}`}>
          {getStateLabel()}
        </span>
      </div>

      {!compact && (
        <div className="occurrence-actions">
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => onMarkPaid(occurrence)}
          >
            {t('expenses.recurring.occurrence.markPaid')}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={() => onSkip(occurrence)}
          >
            {t('expenses.recurring.occurrence.skip')}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={() => onSnooze(occurrence)}
          >
            {t('expenses.recurring.occurrence.snooze')}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * List component for multiple occurrences
 */
interface RecurringOccurrenceListProps {
  occurrences: VirtualOccurrenceDisplay[];
  onMarkPaid: (occurrence: VirtualOccurrenceDisplay) => void;
  onSkip: (occurrence: VirtualOccurrenceDisplay) => void;
  onSnooze: (occurrence: VirtualOccurrenceDisplay) => void;
  onClick?: (occurrence: VirtualOccurrenceDisplay) => void;
  emptyMessage?: string;
  emptyHint?: string;
  compact?: boolean;
}

export function RecurringOccurrenceList({
  occurrences,
  onMarkPaid,
  onSkip,
  onSnooze,
  onClick,
  emptyMessage,
  emptyHint,
  compact = false,
}: RecurringOccurrenceListProps) {
  const t = useT();

  if (occurrences.length === 0) {
    return (
      <div className="recurring-occurrence-empty">
        <p className="empty-message">
          {emptyMessage || t('expenses.recurring.occurrence.empty')}
        </p>
        {emptyHint && (
          <p className="empty-hint">{emptyHint}</p>
        )}
      </div>
    );
  }

  return (
    <div className="recurring-occurrence-list">
      {occurrences.map((occurrence) => (
        <RecurringOccurrenceCard
          key={`${occurrence.ruleId}-${occurrence.expectedDate}`}
          occurrence={occurrence}
          onMarkPaid={onMarkPaid}
          onSkip={onSkip}
          onSnooze={onSnooze}
          onClick={onClick}
          compact={compact}
        />
      ))}
    </div>
  );
}
