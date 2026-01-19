import { useState, useMemo } from 'react';
import { useParams, useSearch, Link } from '@tanstack/react-router';
import { TopBar } from '../../components/layout';
import {
  useMonthCloseStatus,
  useMonthCloseComputed,
  useUpdateMonthCloseChecklist,
  useCloseMonth,
  useReopenMonth,
} from '../../hooks/useExpenseQueries';
import { useBusinessProfile } from '../../hooks/useQueries';
import { exportReceiptsAsZip } from '../../lib/zipExport';
import { formatMonthKey, getRecentMonthKeys, getCurrentMonthKey, isPastMonth } from '../../lib/monthDetection';
import { useT, useLanguage, getLocale } from '../../lib/i18n';
import { cn } from '../../lib/utils';
import './MonthCloseChecklistPage.css';

export function MonthCloseChecklistPage() {
  const { profileId } = useParams({ from: '/expenses/close/profile/$profileId' });
  const search = useSearch({ from: '/expenses/close/profile/$profileId' });
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);

  const currentMonth = getCurrentMonthKey();
  const [selectedMonth, setSelectedMonth] = useState(
    (search as { month?: string }).month || currentMonth
  );
  const [isExporting, setIsExporting] = useState(false);
  const [closeNotes, setCloseNotes] = useState('');

  const { data: profile, isLoading: profileLoading } = useBusinessProfile(profileId);
  const { data: closeStatus, isLoading: statusLoading } = useMonthCloseStatus(profileId, selectedMonth);
  const { data: computedStatus, isLoading: computedLoading } = useMonthCloseComputed(profileId, selectedMonth);

  const updateChecklistMutation = useUpdateMonthCloseChecklist();
  const closeMonthMutation = useCloseMonth();
  const reopenMonthMutation = useReopenMonth();

  const monthOptions = getRecentMonthKeys(12);

  const handleChecklistChange = (key: keyof NonNullable<typeof closeStatus>['checklist'], value: boolean) => {
    updateChecklistMutation.mutate({
      profileId,
      monthKey: selectedMonth,
      updates: { [key]: value },
    });
  };

  const handleExportZip = async () => {
    if (!profile) return;

    setIsExporting(true);
    try {
      await exportReceiptsAsZip(profileId, profile.name, selectedMonth);
      // Mark as exported
      handleChecklistChange('zipExported', true);
    } catch (err) {
      console.error('Failed to export receipts:', err);
    } finally {
      setIsExporting(false);
    }
  };

  const handleCloseMonth = async () => {
    if (!confirm(t('monthClose.confirmClose'))) return;

    try {
      await closeMonthMutation.mutateAsync({
        profileId,
        monthKey: selectedMonth,
        notes: closeNotes || undefined,
      });
    } catch {
      // Error handled by mutation
    }
  };

  const handleReopenMonth = async () => {
    if (!confirm(t('monthClose.confirmReopen'))) return;

    try {
      await reopenMonthMutation.mutateAsync({
        profileId,
        monthKey: selectedMonth,
      });
    } catch {
      // Error handled by mutation
    }
  };

  // Calculate readiness
  const isReady = useMemo(() => {
    if (!closeStatus || !computedStatus) return false;

    return (
      computedStatus.isFullyLinked &&
      computedStatus.isFullyCategorized &&
      closeStatus.checklist.recurringConfirmed
    );
  }, [closeStatus, computedStatus]);

  const isLoading = profileLoading || statusLoading || computedLoading;

  if (isLoading) {
    return (
      <>
        <TopBar
          title={t('common.loading')}
          breadcrumbs={[
            { label: t('nav.expenses'), href: '/expenses' },
            { label: t('common.loading') },
          ]}
        />
        <div className="page-content">
          <div className="loading">
            <div className="spinner" />
          </div>
        </div>
      </>
    );
  }

  if (!profile) {
    return (
      <>
        <TopBar
          title={t('expenses.profileNotFound')}
          breadcrumbs={[{ label: t('nav.expenses'), href: '/expenses' }]}
        />
        <div className="page-content">
          <div className="empty-state">
            <h3 className="empty-state-title">{t('expenses.profileNotFound')}</h3>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <TopBar
        title={t('monthClose.title')}
        breadcrumbs={[
          { label: t('nav.expenses'), href: '/expenses' },
          { label: profile.name, href: `/expenses/profile/${profileId}` },
          { label: t('monthClose.title') },
        ]}
        filterSlot={
          <div className="filters-row" style={{ marginBottom: 0, marginInlineStart: 24 }}>
            <select
              className="select"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
            >
              {monthOptions.map((key) => (
                <option key={key} value={key}>
                  {formatMonthKey(key, locale)}
                </option>
              ))}
            </select>
          </div>
        }
      />
      <div className="page-content">
        <div className="month-close-container">
          {/* Status Banner */}
          {closeStatus?.isClosed ? (
            <div className="month-close-banner closed">
              <div className="month-close-banner-icon">
                <LockedIcon />
              </div>
              <div className="month-close-banner-content">
                <h3 className="month-close-banner-title">{t('monthClose.monthClosed')}</h3>
                <p className="month-close-banner-text">
                  {t('monthClose.closedAt', {
                    date: closeStatus.closedAt
                      ? new Date(closeStatus.closedAt).toLocaleDateString(locale)
                      : '',
                  })}
                </p>
                {closeStatus.notes && (
                  <p className="month-close-banner-notes">{closeStatus.notes}</p>
                )}
              </div>
              <button
                className="btn btn-secondary"
                onClick={handleReopenMonth}
                disabled={reopenMonthMutation.isPending}
              >
                {t('monthClose.reopen')}
              </button>
            </div>
          ) : (
            <div className={cn('month-close-banner', isReady ? 'ready' : 'pending')}>
              <div className="month-close-banner-icon">
                {isReady ? <ReadyIcon /> : <PendingIcon />}
              </div>
              <div className="month-close-banner-content">
                <h3 className="month-close-banner-title">
                  {isReady ? t('monthClose.readyToClose') : t('monthClose.notReady')}
                </h3>
                <p className="month-close-banner-text">
                  {isReady
                    ? t('monthClose.allTasksComplete')
                    : t('monthClose.completeTasks')}
                </p>
              </div>
            </div>
          )}

          {/* Checklist */}
          {!closeStatus?.isClosed && (
            <div className="month-close-checklist">
              <h4 className="month-close-section-title">{t('monthClose.checklist')}</h4>

              {/* Receipts linked */}
              <div
                className={cn(
                  'month-close-item',
                  computedStatus?.isFullyLinked && 'completed'
                )}
              >
                <div className="month-close-item-checkbox">
                  <input
                    type="checkbox"
                    checked={computedStatus?.isFullyLinked || false}
                    disabled
                    readOnly
                  />
                </div>
                <div className="month-close-item-content">
                  <span className="month-close-item-label">
                    {t('monthClose.receiptsLinked')}
                  </span>
                  <span className="month-close-item-status">
                    {computedStatus?.unlinkedReceiptsCount === 0
                      ? t('monthClose.allLinked')
                      : t('monthClose.unlinkedCount', {
                          count: computedStatus?.unlinkedReceiptsCount || 0,
                        })}
                  </span>
                </div>
                {!computedStatus?.isFullyLinked && (
                  <Link
                    to="/expenses/profile/$profileId/receipts"
                    params={{ profileId }}
                    className="btn btn-sm btn-secondary"
                  >
                    {t('monthClose.viewReceipts')}
                  </Link>
                )}
              </div>

              {/* All categorized */}
              <div
                className={cn(
                  'month-close-item',
                  computedStatus?.isFullyCategorized && 'completed'
                )}
              >
                <div className="month-close-item-checkbox">
                  <input
                    type="checkbox"
                    checked={computedStatus?.isFullyCategorized || false}
                    disabled
                    readOnly
                  />
                </div>
                <div className="month-close-item-content">
                  <span className="month-close-item-label">
                    {t('monthClose.allCategorized')}
                  </span>
                  <span className="month-close-item-status">
                    {computedStatus?.uncategorizedExpensesCount === 0
                      ? t('monthClose.allCategorizedStatus')
                      : t('monthClose.uncategorizedCount', {
                          count: computedStatus?.uncategorizedExpensesCount || 0,
                        })}
                  </span>
                </div>
                {!computedStatus?.isFullyCategorized && (
                  <Link
                    to="/expenses/profile/$profileId"
                    params={{ profileId }}
                    className="btn btn-sm btn-secondary"
                  >
                    {t('monthClose.viewExpenses')}
                  </Link>
                )}
              </div>

              {/* Recurring confirmed */}
              <div
                className={cn(
                  'month-close-item',
                  closeStatus?.checklist.recurringConfirmed && 'completed'
                )}
              >
                <div className="month-close-item-checkbox">
                  <input
                    type="checkbox"
                    checked={closeStatus?.checklist.recurringConfirmed || false}
                    onChange={(e) =>
                      handleChecklistChange('recurringConfirmed', e.target.checked)
                    }
                  />
                </div>
                <div className="month-close-item-content">
                  <span className="month-close-item-label">
                    {t('monthClose.recurringConfirmed')}
                  </span>
                  <span className="month-close-item-hint">
                    {t('monthClose.recurringConfirmedHint')}
                  </span>
                </div>
              </div>

              {/* Export ZIP (optional) */}
              <div
                className={cn(
                  'month-close-item',
                  closeStatus?.checklist.zipExported && 'completed'
                )}
              >
                <div className="month-close-item-checkbox">
                  <input
                    type="checkbox"
                    checked={closeStatus?.checklist.zipExported || false}
                    onChange={(e) =>
                      handleChecklistChange('zipExported', e.target.checked)
                    }
                  />
                </div>
                <div className="month-close-item-content">
                  <span className="month-close-item-label">
                    {t('monthClose.zipExported')}
                  </span>
                  <span className="month-close-item-hint">
                    {t('monthClose.zipExportedHint')}
                  </span>
                </div>
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={handleExportZip}
                  disabled={isExporting}
                >
                  {isExporting
                    ? t('expenses.receipts.exporting')
                    : t('monthClose.exportZip')}
                </button>
              </div>
            </div>
          )}

          {/* Close Month Section */}
          {!closeStatus?.isClosed && isPastMonth(selectedMonth) && (
            <div className="month-close-action-section">
              <h4 className="month-close-section-title">{t('monthClose.closeMonth')}</h4>

              <div className="month-close-notes">
                <label className="form-label">{t('monthClose.notesLabel')}</label>
                <textarea
                  className="textarea"
                  value={closeNotes}
                  onChange={(e) => setCloseNotes(e.target.value)}
                  placeholder={t('monthClose.notesPlaceholder')}
                />
              </div>

              <button
                className="btn btn-primary"
                onClick={handleCloseMonth}
                disabled={!isReady || closeMonthMutation.isPending}
              >
                {closeMonthMutation.isPending
                  ? t('common.saving')
                  : t('monthClose.closeMonthButton')}
              </button>

              {!isReady && (
                <p className="month-close-hint text-warning">
                  {t('monthClose.completeChecklistFirst')}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function LockedIcon() {
  return (
    <svg
      width="24"
      height="24"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"
      />
    </svg>
  );
}

function ReadyIcon() {
  return (
    <svg
      width="24"
      height="24"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
      />
    </svg>
  );
}

function PendingIcon() {
  return (
    <svg
      width="24"
      height="24"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
      />
    </svg>
  );
}
