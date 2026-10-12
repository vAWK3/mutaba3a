/**
 * RecurringMarkPaidDrawer
 *
 * The small drawer behind a Needs attention row (MUT-87, decision E1). It
 * lists the rule's missed payments, oldest first, all checked, each with its
 * expected date and an amount field prefilled with the rule's amount. Mark
 * paid writes one expense per checked payment, dated on that payment's own
 * expected date, in one all-or-nothing write (ADR-052). Each payment can be
 * skipped or snoozed on its own; snoozing picks a date in the drawer's second
 * view, which Snooze all (the row's ⋯ menu) opens directly.
 *
 * Uses the shared `Drawer` as is.
 */

import { useId, useState } from 'react';
import { Drawer } from './Drawer';
import {
  useConfirmRecurringPayments,
  useSkipRecurringOccurrences,
  useSnoozeRecurringOccurrences,
} from '../../hooks/useRecurringExpenseQueries';
import {
  amountInputValue,
  formatDateOnly,
  formatMonthList,
  formatMonthYear,
  readPaymentAmount,
  snoozeDateAfter,
  type RecurringAttentionGroup,
} from '../expenses/recurringAttention';
import { todayLocalISO } from '../../lib/dates';
import { formatAmount } from '../../lib/utils';
import { useT, useLanguage, getLocale } from '../../lib/i18n';
import { useTp } from '../../lib/i18n/plural';
import type { VirtualOccurrenceDisplay } from '../../types';
import './RecurringMarkPaidDrawer.css';

export type RecurringDrawerView = 'list' | 'snooze';

/** Snooze defaults to a week; the quick picks are a week, two weeks and a month */
const DEFAULT_SNOOZE_DAYS = 7;
const QUICK_SNOOZE_DAYS = [7, 14, 30] as const;

/** FIRST STRONG ISOLATE … POP DIRECTIONAL ISOLATE around an amount inside a sentence */
const isolate = (text: string) => `\u2068${text}\u2069`;

type View =
  | { kind: 'list' }
  | { kind: 'snooze'; expectedDates: string[]; returnToList: boolean };

export interface RecurringMarkPaidDrawerProps {
  group: RecurringAttentionGroup;
  /** 'snooze' opens on snoozing every payment (Snooze all) */
  initialView?: RecurringDrawerView;
  onClose: () => void;
}

export function RecurringMarkPaidDrawer({ group, initialView = 'list', onClose }: RecurringMarkPaidDrawerProps) {
  const t = useT();
  const tp = useTp();
  const { language } = useLanguage();
  const locale = getLocale(language);
  const today = todayLocalISO();
  const baseId = useId();
  const { ruleId, profileId } = group;

  const [view, setView] = useState<View>(() =>
    initialView === 'snooze'
      ? { kind: 'snooze', expectedDates: group.occurrences.map((o) => o.expectedDate), returnToList: false }
      : { kind: 'list' }
  );
  const [snoozeUntil, setSnoozeUntil] = useState(() => snoozeDateAfter(today, DEFAULT_SNOOZE_DAYS));
  // Unchecked payments and edited amounts, by expected date. They live here so
  // a trip to the snooze view keeps them; a payment that drops out (skipped)
  // takes its entry with it, and a new one starts checked.
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(() => new Set());
  const [typed, setTyped] = useState<Readonly<Record<string, string>>>({});

  const markPaid = useConfirmRecurringPayments();
  const skip = useSkipRecurringOccurrences();
  const snooze = useSnoozeRecurringOccurrences();
  const busy = markPaid.isPending || skip.isPending || snooze.isPending;

  const rows = group.occurrences.map((occurrence) => {
    const value = typed[occurrence.expectedDate] ?? amountInputValue(occurrence.effectiveAmount);
    return {
      occurrence,
      checked: !unchecked.has(occurrence.expectedDate),
      value,
      reading: readPaymentAmount(value, group.currency),
    };
  });
  const selected = rows.filter((row) => row.checked);
  const canMarkPaid = !busy && selected.length > 0 && selected.every((row) => row.reading.error === undefined);

  const toggle = (expectedDate: string) =>
    setUnchecked((current) => {
      const next = new Set(current);
      if (next.has(expectedDate)) next.delete(expectedDate);
      else next.add(expectedDate);
      return next;
    });

  // An amount is sent only when it was changed, so the occurrence records a real override
  const saveMarkPaid = () =>
    markPaid.mutate(
      {
        ruleId,
        profileId,
        payments: selected.map(({ occurrence, reading }) =>
          reading.amountMinor !== undefined && reading.amountMinor !== occurrence.effectiveAmount
            ? { expectedDate: occurrence.expectedDate, amountMinor: reading.amountMinor }
            : { expectedDate: occurrence.expectedDate }
        ),
      },
      { onSuccess: onClose }
    );

  const skipOne = (expectedDate: string) => {
    if (!window.confirm(t('expenses.recurring.occurrence.confirmSkip'))) return;
    const wasLast = group.occurrences.length === 1;
    skip.mutate({ ruleId, profileId, expectedDates: [expectedDate] }, { onSuccess: () => wasLast && onClose() });
  };

  const openSnooze = (expectedDate: string) => {
    setSnoozeUntil(snoozeDateAfter(today, DEFAULT_SNOOZE_DAYS));
    setView({ kind: 'snooze', expectedDates: [expectedDate], returnToList: true });
  };

  const footer = (secondary: { label: string; onClick: () => void }, primary: { label: string; onClick: () => void; enabled: boolean }) => (
    <>
      <div className="drawer-footer-left" />
      <div className="drawer-footer-right">
        <button type="button" className="btn btn-secondary" onClick={secondary.onClick} disabled={busy}>
          {secondary.label}
        </button>
        <button type="button" className="btn btn-primary" onClick={primary.onClick} disabled={!primary.enabled}>
          {primary.label}
        </button>
      </div>
    </>
  );

  if (view.kind === 'snooze') {
    const { expectedDates, returnToList } = view;
    const snoozesAll = expectedDates.length === group.occurrences.length;
    const saveSnooze = () =>
      snooze.mutate(
        { ruleId, profileId, expectedDates, snoozeUntil },
        { onSuccess: () => (snoozesAll ? onClose() : setView({ kind: 'list' })) }
      );

    return (
      <Drawer
        title={group.title}
        onClose={onClose}
        footer={footer(
          returnToList
            ? { label: t('expenses.recurring.attention.back'), onClick: () => setView({ kind: 'list' }) }
            : { label: t('common.cancel'), onClick: onClose },
          {
            label: t('expenses.recurring.occurrence.snooze'),
            onClick: saveSnooze,
            enabled: !busy && snoozeUntil > today,
          }
        )}
      >
        <SnoozeFields
          months={
            expectedDates.length === 1
              ? formatMonthYear(expectedDates[0], locale)
              : formatMonthList(expectedDates, locale)
          }
          today={today}
          value={snoozeUntil}
          onChange={setSnoozeUntil}
        />
      </Drawer>
    );
  }

  const period = t(`expenses.recurring.attention.perPeriod.${group.frequency}`, {
    amount: isolate(formatAmount(group.periodAmountMinor, group.currency, locale)),
  });

  return (
    <Drawer
      title={group.title}
      onClose={onClose}
      footer={footer(
        { label: t('common.cancel'), onClick: onClose },
        {
          label:
            selected.length > 0
              ? tp('expenses.recurring.attention.markPaidCount', selected.length)
              : t('expenses.recurring.attention.markPaidNone'),
          onClick: saveMarkPaid,
          enabled: canMarkPaid,
        }
      )}
    >
      <p className="recurring-drawer-intro">
        {period}
        <span aria-hidden="true"> · </span>
        {t('expenses.recurring.attention.hint')}
      </p>
      <ul className="recurring-drawer-payments">
        {rows.map(({ occurrence, checked, value, reading }) => (
          <PaymentRow
            key={occurrence.expectedDate}
            id={`${baseId}-${occurrence.expectedDate}`}
            occurrence={occurrence}
            locale={locale}
            checked={checked}
            value={value}
            error={checked ? reading.error : undefined}
            busy={busy}
            onToggle={() => toggle(occurrence.expectedDate)}
            onChange={(next) => setTyped((current) => ({ ...current, [occurrence.expectedDate]: next }))}
            onSkip={() => skipOne(occurrence.expectedDate)}
            onSnooze={() => openSnooze(occurrence.expectedDate)}
          />
        ))}
      </ul>
    </Drawer>
  );
}

// ============================================================================
// One payment in the list
// ============================================================================

interface PaymentRowProps {
  id: string;
  occurrence: VirtualOccurrenceDisplay;
  locale: string;
  checked: boolean;
  value: string;
  error?: { key: string; vars?: Record<string, string> };
  busy: boolean;
  onToggle: () => void;
  onChange: (value: string) => void;
  onSkip: () => void;
  onSnooze: () => void;
}

function PaymentRow({ id, occurrence, locale, checked, value, error, busy, onToggle, onChange, onSkip, onSnooze }: PaymentRowProps) {
  const t = useT();
  const month = formatMonthYear(occurrence.expectedDate, locale);
  const errorId = `${id}-error`;

  return (
    <li className="recurring-drawer-payment">
      <input
        id={`${id}-check`}
        type="checkbox"
        className="recurring-drawer-check"
        checked={checked}
        onChange={onToggle}
        disabled={busy}
      />
      <label htmlFor={`${id}-check`} className="recurring-drawer-label">
        <span className="recurring-drawer-month">{month}</span>{' '}
        <span className="recurring-drawer-date">{formatDateOnly(occurrence.expectedDate, locale)}</span>
      </label>
      <div className="input-with-prefix recurring-drawer-amount">
        <span className="input-prefix" aria-hidden="true">
          {occurrence.effectiveCurrency}
        </span>
        <input
          type="text"
          inputMode="decimal"
          className="input"
          aria-label={t('expenses.recurring.attention.amountFor', { month })}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          value={value}
          disabled={!checked || busy}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      {error && (
        <p id={errorId} className="form-error recurring-drawer-error">
          {t(error.key, error.vars)}
        </p>
      )}
      <div className="recurring-drawer-payment-actions">
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          aria-label={t('expenses.recurring.attention.skipMonth', { month })}
          onClick={onSkip}
          disabled={busy}
        >
          {t('expenses.recurring.occurrence.skip')}
        </button>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          aria-label={t('expenses.recurring.attention.snoozeMonth', { month })}
          onClick={onSnooze}
          disabled={busy}
        >
          {t('expenses.recurring.occurrence.snooze')}
        </button>
      </div>
    </li>
  );
}

// ============================================================================
// Snoozing one payment, or all of them
// ============================================================================

interface SnoozeFieldsProps {
  months: string;
  today: string;
  value: string;
  onChange: (value: string) => void;
}

function SnoozeFields({ months, today, value, onChange }: SnoozeFieldsProps) {
  const t = useT();
  const { language } = useLanguage();
  const dateId = useId();
  const errorId = useId();
  const relative = new Intl.RelativeTimeFormat(getLocale(language), { numeric: 'auto' });
  // YYYY-MM-DD strings order as dates
  const valid = value > today;

  return (
    <>
      <p className="recurring-drawer-intro">{t('expenses.recurring.attention.snoozeWhat', { months })}</p>
      <div className="form-group">
        <label htmlFor={dateId} className="form-label">
          {t('expenses.recurring.occurrence.snoozeUntil')}
        </label>
        <input
          id={dateId}
          type="date"
          className="input"
          min={snoozeDateAfter(today, 1)}
          value={value}
          aria-invalid={valid ? undefined : true}
          aria-describedby={valid ? undefined : errorId}
          onChange={(event) => onChange(event.target.value)}
        />
        {!valid && (
          <p id={errorId} className="form-error">
            {t('expenses.recurring.attention.snoozeAfterToday')}
          </p>
        )}
      </div>
      <div className="recurring-drawer-quick" role="group" aria-label={t('expenses.recurring.attention.quickPicks')}>
        {QUICK_SNOOZE_DAYS.map((days) => (
          <button key={days} type="button" className="btn btn-sm btn-secondary" onClick={() => onChange(snoozeDateAfter(today, days))}>
            {relative.format(days, 'day')}
          </button>
        ))}
      </div>
    </>
  );
}
