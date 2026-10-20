/**
 * RecurringOccurrenceCard Component
 *
 * Displays a recurring expense occurrence with its computed state (projected,
 * due, overdue, snoozed). Read-only: the Expenses forecast lists upcoming
 * payments with it. Acting on a missed payment happens on its rule's Needs
 * attention row and drawer (MUT-87), which replaced this card's Mark Paid,
 * Skip, Snooze and Edit rule buttons.
 */

import { useT } from '../../lib/i18n';
import { useTp } from '../../lib/i18n/plural';
import { formatAmount, formatDate } from '../../lib/utils';
import type { VirtualOccurrenceDisplay } from '../../types';
import { USER_COLOR_INK } from './profileAvatarStyle';
import './RecurringOccurrenceCard.css';

interface RecurringOccurrenceCardProps {
  occurrence: VirtualOccurrenceDisplay;
  compact?: boolean;
}

export function RecurringOccurrenceCard({
  occurrence,
  compact = false,
}: RecurringOccurrenceCardProps) {
  const t = useT();
  const tp = useTp();

  const getStateLabel = (): string => {
    const persisted = occurrence.persistedOccurrence;

    if (persisted?.status === 'snoozed' && persisted.snoozeUntil) {
      return t('expenses.recurring.occurrence.snoozedUntil', {
        date: formatDate(persisted.snoozeUntil),
      });
    }

    switch (occurrence.computedState) {
      case 'overdue':
        return tp('expenses.recurring.occurrence.overdueDays', Math.abs(occurrence.daysUntilDue));
      case 'due':
        if (occurrence.daysUntilDue === 0) {
          return t('expenses.recurring.occurrence.dueToday');
        }
        return tp('expenses.recurring.occurrence.dueIn', occurrence.daysUntilDue);
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

  return (
    <div className={`recurring-occurrence-card ${getStateClass()} ${compact ? 'compact' : ''}`}>
      <div className="occurrence-main">
        <div className="occurrence-info">
          <span className="occurrence-title">{occurrence.ruleTitle}</span>
          {occurrence.vendorName && (
            <span className="occurrence-vendor">{occurrence.vendorName}</span>
          )}
          {occurrence.categoryName && (
            <span
              className="occurrence-category"
              style={occurrence.categoryColor ? { backgroundColor: occurrence.categoryColor, color: USER_COLOR_INK } : undefined}
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
    </div>
  );
}

/**
 * List component for multiple occurrences
 */
interface RecurringOccurrenceListProps {
  occurrences: VirtualOccurrenceDisplay[];
  emptyMessage?: string;
  emptyHint?: string;
  compact?: boolean;
}

export function RecurringOccurrenceList({
  occurrences,
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
          compact={compact}
        />
      ))}
    </div>
  );
}
