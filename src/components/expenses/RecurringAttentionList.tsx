/**
 * RecurringAttentionList
 *
 * Expenses › Needs attention as one row per recurring rule (MUT-87, decision
 * E1): "Server hosting · $80 monthly · Aug, Sep, Oct not marked · $240". One
 * primary action, Mark paid; Skip, Snooze and Edit rule live in a ⋯ menu and
 * apply to all of the rule's missed payments. Rows, not cards, so it reads
 * like Home's Needs attention. The header totals each currency on its own.
 *
 * Presentational: the page shapes the groups with `groupOccurrencesByRule`
 * and decides what each action does.
 */

import { useId } from 'react';
import { useMenuButton } from '../../hooks/useMenuButton';
import { MoreIcon } from '../icons';
import { CurrencyAmounts } from '../ui/CurrencyAmounts';
import { formatAmount, isolateAmount } from '../../lib/utils';
import { useT, useLanguage, getLocale } from '../../lib/i18n';
import { useTp } from '../../lib/i18n/plural';
import { currencyTotals, formatMonthList, formatMonthShortYear, type RecurringAttentionGroup } from './recurringAttention';
import './RecurringAttentionList.css';

type GroupAction = (group: RecurringAttentionGroup) => void;

export interface RecurringAttentionListProps {
  groups: readonly RecurringAttentionGroup[];
  onMarkPaid: GroupAction;
  onSkipAll: GroupAction;
  onSnoozeAll: GroupAction;
  onEditRule: GroupAction;
}

export function RecurringAttentionList({ groups, ...actions }: RecurringAttentionListProps) {
  const t = useT();
  const headingId = useId();

  return (
    <section className="card recurring-attention" aria-labelledby={headingId}>
      <div className="card-header recurring-attention-header">
        <h2 id={headingId} className="card-title">
          {t('expenses.recurring.occurrence.needsAttention')}
        </h2>
        <span className="recurring-attention-count" data-testid="recurring-attention-count">
          {groups.length}
        </span>
        <span className="recurring-attention-total">
          <span className="sr-only">{t('expenses.recurring.attention.total')}</span>
          <CurrencyAmounts amounts={currencyTotals(groups)} />
        </span>
      </div>
      <ul className="recurring-attention-list">
        {groups.map((group) => (
          <RecurringAttentionRow key={group.ruleId} group={group} {...actions} />
        ))}
      </ul>
    </section>
  );
}

/** More missed payments than this are summarised as "N payments since <month>" rather than listed. */
const MAX_NAMED_MONTHS = 6;

interface RowProps extends Omit<RecurringAttentionListProps, 'groups'> {
  group: RecurringAttentionGroup;
}

function RecurringAttentionRow({ group, onMarkPaid, onSkipAll, onSnoozeAll, onEditRule }: RowProps) {
  const t = useT();
  const tp = useTp();
  const { language } = useLanguage();
  const locale = getLocale(language);
  const titleId = useId();
  const menu = useMenuButton();

  const count = group.occurrences.length;
  const oldest = group.occurrences[0];
  // A few months are named; a long run (a rule unmarked for years, MUT-96) is counted from where it started
  const notMarked =
    count > MAX_NAMED_MONTHS
      ? tp('expenses.recurring.attention.notMarkedSince', count, { since: formatMonthShortYear(oldest.expectedDate, locale) })
      : t('expenses.recurring.attention.notMarked', {
          months: formatMonthList(group.occurrences.map((occurrence) => occurrence.expectedDate), locale),
        });
  const period = t(`expenses.recurring.attention.perPeriod.${group.frequency}`, {
    amount: isolateAmount(formatAmount(group.periodAmountMinor, group.currency, locale)),
  });

  const run = (action: GroupAction) => () => {
    menu.close();
    action(group);
  };

  return (
    <li className="recurring-attention-row">
      <div className="recurring-attention-main">
        <span id={titleId} className="recurring-attention-title">
          {group.title}
        </span>
        <span className="recurring-attention-detail">
          {period}
          <span aria-hidden="true"> · </span>
          {notMarked}
        </span>
      </div>

      <div className="recurring-attention-amount-cell">
        <bdi dir="ltr" className="recurring-attention-amount" data-testid="recurring-attention-amount">
          {formatAmount(group.totalMinor, group.currency, locale)}
        </bdi>
        <span className={oldest.isOverdue ? 'recurring-attention-status text-danger' : 'recurring-attention-status'}>
          {lateness(oldest.daysUntilDue, t)}
        </span>
      </div>

      <div className="recurring-attention-actions">
        <button
          type="button"
          className="btn btn-sm btn-primary"
          aria-describedby={titleId}
          onClick={() => onMarkPaid(group)}
        >
          {t('expenses.recurring.occurrence.markPaid')}
        </button>
        <div className="recurring-attention-menu">
          <button
            type="button"
            className="row-actions-trigger"
            aria-label={t('expenses.recurring.attention.actionsFor', { title: group.title })}
            {...menu.buttonProps}
          >
            <MoreIcon size={18} />
          </button>
          {menu.isOpen && (
            <div className="row-actions-menu recurring-attention-menu-list" {...menu.menuProps}>
              <button type="button" role="menuitem" tabIndex={-1} className="row-actions-item" onClick={run(onSkipAll)}>
                {tp('expenses.recurring.attention.skipAll', count)}
              </button>
              <button type="button" role="menuitem" tabIndex={-1} className="row-actions-item" onClick={run(onSnoozeAll)}>
                {tp('expenses.recurring.attention.snoozeAll', count)}
              </button>
              <button type="button" role="menuitem" tabIndex={-1} className="row-actions-item" onClick={run(onEditRule)}>
                {t('expenses.recurring.editRule')}
              </button>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

/** "68d overdue" / "Due today" / "Due in 3d", as Home's Needs attention says it */
function lateness(daysUntilDue: number, t: ReturnType<typeof useT>): string {
  if (daysUntilDue < 0) return t('transactions.status.overdue', { days: -daysUntilDue });
  if (daysUntilDue === 0) return t('transactions.status.dueToday');
  return t('transactions.status.dueIn', { days: daysUntilDue });
}
