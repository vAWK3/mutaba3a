import { useEffect, useMemo } from 'react';
import { useT, useLanguage, getLocale } from '../../lib/i18n';
import { useDrawerStore } from '../../lib/stores';
import { useDayEvents } from '../../hooks/useMoneyAnswersQueries';
import { useFxRate } from '../../hooks/useFxRate';
import { getUnifiedTotal } from '../../lib/fx';
import { formatAmount as formatAmountUtil } from '../../lib/utils';
import type { Currency, MoneyEvent } from '../../types';

interface DayDetailDrawerProps {
  date: string;
  onClose: () => void;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function formatAmount(amountMinor: number, currency: Currency): string {
  const formatted = (amountMinor / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${currency} ${formatted}`;
}

export function DayDetailDrawer({ date, onClose }: DayDetailDrawerProps) {
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);
  const openTransactionDrawer = useDrawerStore((s) => s.openTransactionDrawer);
  const openExpenseDrawer = useDrawerStore((s) => s.openExpenseDrawer);
  const { rate } = useFxRate('USD', 'ILS');

  // Fetch events for both currencies
  const { data: eventsUSD, isLoading: loadingUSD } = useDayEvents(date, 'USD');
  const { data: eventsILS, isLoading: loadingILS } = useDayEvents(date, 'ILS');

  const isLoading = loadingUSD || loadingILS;

  // Combine events from both currencies
  const events = useMemo(() => {
    const combined = [...(eventsUSD || []), ...(eventsILS || [])];
    // Sort by amount descending
    return combined.sort((a, b) => b.amountMinor - a.amountMinor);
  }, [eventsUSD, eventsILS]);

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  // Separate inflows and outflows
  const inflows = events?.filter(e => e.direction === 'inflow') || [];
  const outflows = events?.filter(e => e.direction === 'outflow') || [];

  // Calculate totals by currency
  const totals = useMemo(() => {
    const usdInflow = inflows.filter(e => e.currency === 'USD').reduce((sum, e) => sum + e.amountMinor, 0);
    const ilsInflow = inflows.filter(e => e.currency === 'ILS').reduce((sum, e) => sum + e.amountMinor, 0);
    const usdOutflow = outflows.filter(e => e.currency === 'USD').reduce((sum, e) => sum + e.amountMinor, 0);
    const ilsOutflow = outflows.filter(e => e.currency === 'ILS').reduce((sum, e) => sum + e.amountMinor, 0);

    const totalInflow = getUnifiedTotal(usdInflow, ilsInflow, 'ILS', rate) || 0;
    const totalOutflow = getUnifiedTotal(usdOutflow, ilsOutflow, 'ILS', rate) || 0;
    const netChange = totalInflow - totalOutflow;

    return { totalInflow, totalOutflow, netChange };
  }, [inflows, outflows, rate]);

  // Handle event click
  const handleEventClick = (event: MoneyEvent) => {
    if (event.sourceEntityType === 'transaction') {
      openTransactionDrawer({ mode: 'edit', transactionId: event.sourceEntityId });
      onClose();
    } else if (event.sourceEntityType === 'expense') {
      openExpenseDrawer({ mode: 'edit', expenseId: event.sourceEntityId });
      onClose();
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div className="day-detail-drawer-backdrop" onClick={onClose} />

      {/* Drawer */}
      <div className="day-detail-drawer">
        {/* Header */}
        <div className="day-detail-header">
          <h2 className="day-detail-title">{formatDate(date)}</h2>
          <button
            type="button"
            className="day-detail-close"
            onClick={onClose}
            aria-label={t('common.close')}
          >
            <CloseIcon />
          </button>
        </div>

        {/* Summary */}
        <div className="day-detail-summary">
          <div className="day-summary-item">
            <div className="day-summary-label">{t('moneyAnswers.dayDetail.inflow')}</div>
            <div className="day-summary-value positive">+{formatAmountUtil(totals.totalInflow, 'ILS', locale)}</div>
          </div>
          <div className="day-summary-item">
            <div className="day-summary-label">{t('moneyAnswers.dayDetail.outflow')}</div>
            <div className="day-summary-value negative">-{formatAmountUtil(totals.totalOutflow, 'ILS', locale)}</div>
          </div>
          <div className="day-summary-item">
            <div className="day-summary-label">{t('moneyAnswers.dayDetail.net')}</div>
            <div className={`day-summary-value ${totals.netChange >= 0 ? 'positive' : 'negative'}`}>
              {totals.netChange >= 0 ? '+' : ''}{formatAmountUtil(totals.netChange, 'ILS', locale)}
            </div>
          </div>
        </div>

        {/* Events */}
        <div className="day-detail-events">
          {isLoading ? (
            <div className="day-events-empty">{t('common.loading')}</div>
          ) : events?.length === 0 ? (
            <div className="day-events-empty">{t('moneyAnswers.dayDetail.noEvents')}</div>
          ) : (
            <>
              {/* Inflows */}
              {inflows.length > 0 && (
                <div className="day-events-section">
                  <div className="day-events-section-title">{t('moneyAnswers.dayDetail.inflows')}</div>
                  {inflows.map(event => (
                    <div
                      key={event.id}
                      className="day-event-item"
                      onClick={() => handleEventClick(event)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          handleEventClick(event);
                        }
                      }}
                    >
                      <div className="day-event-info">
                        <div className="day-event-title">{event.title}</div>
                        <div className="day-event-subtitle">
                          {event.counterparty?.name || getSourceLabel(event.source, t)}
                          {event.state !== 'paid' && (
                            <span className="day-event-state"> • {getStateLabel(event.state, t)}</span>
                          )}
                        </div>
                      </div>
                      <div className="day-event-amount inflow">
                        +{formatAmount(event.amountMinor, event.currency)}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Outflows */}
              {outflows.length > 0 && (
                <div className="day-events-section">
                  <div className="day-events-section-title">{t('moneyAnswers.dayDetail.outflows')}</div>
                  {outflows.map(event => (
                    <div
                      key={event.id}
                      className="day-event-item"
                      onClick={() => handleEventClick(event)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          handleEventClick(event);
                        }
                      }}
                    >
                      <div className="day-event-info">
                        <div className="day-event-title">{event.title}</div>
                        <div className="day-event-subtitle">
                          {event.counterparty?.name || getSourceLabel(event.source, t)}
                        </div>
                      </div>
                      <div className="day-event-amount outflow">
                        -{formatAmount(event.amountMinor, event.currency)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

function getSourceLabel(source: string, t: (key: string) => string): string {
  switch (source) {
    case 'actual_income':
      return t('moneyAnswers.source.actualIncome');
    case 'actual_cost':
      return t('moneyAnswers.source.actualCost');
    case 'receivable':
      return t('moneyAnswers.source.receivable');
    case 'profile_expense':
      return t('moneyAnswers.source.profileExpense');
    case 'projected_expense':
      return t('moneyAnswers.source.projectedExpense');
    case 'retainer':
      return t('moneyAnswers.source.retainer');
    default:
      return source;
  }
}

function getStateLabel(state: string, t: (key: string) => string): string {
  switch (state) {
    case 'paid':
      return t('moneyAnswers.state.paid');
    case 'unpaid':
      return t('moneyAnswers.state.unpaid');
    case 'overdue':
      return t('moneyAnswers.state.overdue');
    case 'upcoming':
      return t('moneyAnswers.state.upcoming');
    case 'missed':
      return t('moneyAnswers.state.missed');
    case 'cancelled':
      return t('moneyAnswers.state.cancelled');
    default:
      return state;
  }
}

function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  );
}
