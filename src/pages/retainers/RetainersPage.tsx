import { useState, useMemo, useEffect } from 'react';
import { TopBar } from '../../components/layout';
import { SearchInput } from '../../components/filters';
import { EmptyState } from '../../components/ui';
import { useRetainers, useRetainerDisplay, useRetainerSummary, useUpdateDueStates } from '../../hooks/useRetainerQueries';
import { useClients, useBusinessProfiles } from '../../hooks/useQueries';
import { useDrawerStore } from '../../lib/stores';
import { formatAmount, cn } from '../../lib/utils';
import { CurrencySummaryPopup } from '../../components/ui/CurrencySummaryPopup';
import { useT, useLanguage, getLocale } from '../../lib/i18n';
import type { RetainerStatus, RetainerFilters } from '../../types';
import './RetainersPage.css';

type ViewFilter = 'all' | 'due' | 'active' | 'ending';

export function RetainersPage() {
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);
  const { openRetainerDrawer, openRetainerMatchingDrawer, selectedRetainerId, selectRetainer } = useDrawerStore();

  // Update due states on mount
  const updateDueStates = useUpdateDueStates();
  useState(() => {
    updateDueStates.mutate();
  });

  // Get profiles
  const { data: profiles = [] } = useBusinessProfiles();

  // Get default profile
  const defaultProfile = useMemo(() => {
    const defaultOne = profiles.find((p) => p.isDefault);
    return defaultOne?.id || profiles[0]?.id;
  }, [profiles]);

  // Filter state
  const [profileFilter, setProfileFilter] = useState<string | undefined>(undefined);
  const [viewFilter, setViewFilter] = useState<ViewFilter>('all');
  const [statusFilter, setStatusFilter] = useState<RetainerStatus | undefined>(undefined);
  const [clientFilter, setClientFilter] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState('');

  // Set default profile filter when profiles load
  useEffect(() => {
    if (defaultProfile && !profileFilter) {
      setProfileFilter(defaultProfile);
    }
  }, [defaultProfile, profileFilter]);

  // Build query filters - always fetch all currencies
  const queryFilters = useMemo((): RetainerFilters => {
    const filters: RetainerFilters = {
      profileId: profileFilter,
      search: search || undefined,
      clientId: clientFilter,
    };

    // View-based filters
    if (viewFilter === 'due') {
      filters.dueOnly = true;
    } else if (viewFilter === 'active') {
      filters.status = 'active';
    } else if (viewFilter === 'ending') {
      // TODO: Implement ending soon filter
    }

    // Explicit status filter overrides view filter
    if (statusFilter) {
      filters.status = statusFilter;
    }

    return filters;
  }, [profileFilter, viewFilter, statusFilter, clientFilter, search]);

  const { data: retainers = [], isLoading } = useRetainers(queryFilters);
  const { data: summary } = useRetainerSummary(profileFilter);
  const { data: clients = [] } = useClients();
  const { data: selectedRetainer } = useRetainerDisplay(selectedRetainerId || '');

  const handleRowClick = (id: string) => {
    selectRetainer(id);
  };

  const handleNewRetainer = () => {
    openRetainerDrawer({ mode: 'create', defaultProfileId: profileFilter });
  };

  const handleMatchPayment = () => {
    openRetainerMatchingDrawer({ step: 'select-transaction' });
  };

  return (
    <>
      <TopBar
        title={t('retainers.title')}
        rightSlot={
          <div className="topbar-actions">
            <button className="btn btn-secondary" onClick={handleMatchPayment}>
              {t('retainers.matchPayment')}
            </button>
            <button className="btn btn-primary" onClick={handleNewRetainer}>
              + {t('retainers.new')}
            </button>
          </div>
        }
      />
      <div className="retainers-layout">
        {/* Left Filter Panel */}
        <aside className="retainers-filter-panel">
          {/* Profile Selector */}
          {profiles.length > 1 && (
            <div className="filter-section">
              <h4 className="filter-section-title">{t('drawer.expense.profile')}</h4>
              <select
                className="select filter-select"
                value={profileFilter || ''}
                onChange={(e) => setProfileFilter(e.target.value || undefined)}
              >
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="filter-section">
            <h4 className="filter-section-title">{t('retainers.filters.view')}</h4>
            <div className="filter-radio-group">
              {(['all', 'due', 'active', 'ending'] as ViewFilter[]).map((view) => (
                <label key={view} className={cn('filter-radio', viewFilter === view && 'active')}>
                  <input
                    type="radio"
                    name="view"
                    checked={viewFilter === view}
                    onChange={() => setViewFilter(view)}
                  />
                  <span>{t(`retainers.filters.${view}`)}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="filter-section">
            <h4 className="filter-section-title">{t('retainers.filters.status')}</h4>
            <select
              className="select filter-select"
              value={statusFilter || ''}
              onChange={(e) => setStatusFilter(e.target.value as RetainerStatus | undefined || undefined)}
            >
              <option value="">{t('common.all')}</option>
              <option value="draft">{t('retainers.status.draft')}</option>
              <option value="active">{t('retainers.status.active')}</option>
              <option value="paused">{t('retainers.status.paused')}</option>
              <option value="ended">{t('retainers.status.ended')}</option>
            </select>
          </div>

          <div className="filter-section">
            <h4 className="filter-section-title">{t('retainers.filters.client')}</h4>
            <select
              className="select filter-select"
              value={clientFilter || ''}
              onChange={(e) => setClientFilter(e.target.value || undefined)}
            >
              <option value="">{t('common.all')}</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </div>

          <div className="filter-section">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder={t('retainers.searchPlaceholder')}
            />
          </div>

          {/* Summary Stats */}
          {summary && (
            <div className="filter-section retainers-summary">
              <h4 className="filter-section-title">{t('retainers.summary')}</h4>
              <div className="retainers-summary-stat">
                <span className="retainers-summary-label">{t('retainers.activeCount')}</span>
                <span className="retainers-summary-value">{summary.activeCount}</span>
              </div>
              <div className="retainers-summary-stat">
                <CurrencySummaryPopup
                  usdAmountMinor={summary.totalExpectedMonthlyUsdMinor}
                  ilsAmountMinor={summary.totalExpectedMonthlyIlsMinor}
                  type="income"
                  label={t('retainers.monthlyExpected')}
                />
              </div>
              <div className="retainers-summary-stat">
                <CurrencySummaryPopup
                  usdAmountMinor={summary.totalDueUsdMinor}
                  ilsAmountMinor={summary.totalDueIlsMinor}
                  type={(summary.totalDueUsdMinor + summary.totalDueIlsMinor) > 0 ? 'expense' : 'neutral'}
                  label={t('retainers.totalDue')}
                />
              </div>
              {(summary.totalOverdueUsdMinor + summary.totalOverdueIlsMinor) > 0 && (
                <div className="retainers-summary-stat">
                  <CurrencySummaryPopup
                    usdAmountMinor={summary.totalOverdueUsdMinor}
                    ilsAmountMinor={summary.totalOverdueIlsMinor}
                    type="expense"
                    label={t('retainers.totalOverdue')}
                  />
                </div>
              )}
            </div>
          )}
        </aside>

        {/* Main Table */}
        <main className="retainers-main">
          {isLoading ? (
            <div className="loading">
              <div className="spinner" />
            </div>
          ) : retainers.length === 0 ? (
            <EmptyState
              title={t('retainers.empty')}
              description={search ? t('retainers.emptySearch') : t('retainers.emptyHint')}
              action={!search ? {
                label: t('retainers.addRetainer'),
                onClick: handleNewRetainer,
              } : undefined}
            />
          ) : (
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('retainers.columns.status')}</th>
                    <th>{t('retainers.columns.title')}</th>
                    <th>{t('retainers.columns.client')}</th>
                    <th>{t('retainers.columns.amount')}</th>
                    <th>{t('retainers.columns.cadence')}</th>
                    <th>{t('retainers.columns.nextDue')}</th>
                    <th>{t('retainers.columns.dueNow')}</th>
                  </tr>
                </thead>
                <tbody>
                  {retainers.map((retainer) => (
                    <tr
                      key={retainer.id}
                      className={cn('clickable', selectedRetainerId === retainer.id && 'selected')}
                      onClick={() => handleRowClick(retainer.id)}
                    >
                      <td>
                        <RetainerStatusBadge status={retainer.status} />
                      </td>
                      <td className="cell-primary">{retainer.title}</td>
                      <td>{retainer.clientName || '-'}</td>
                      <td className="cell-amount">
                        {formatAmount(retainer.amountMinor, retainer.currency, locale)}
                      </td>
                      <td>
                        <span className="cadence-badge">
                          {t(`retainers.cadence.${retainer.cadence}`)}
                        </span>
                      </td>
                      <td>
                        {retainer.nextExpectedDate
                          ? new Date(retainer.nextExpectedDate).toLocaleDateString(locale, {
                              month: 'short',
                              day: 'numeric',
                            })
                          : '-'}
                      </td>
                      <td className={cn('cell-amount', retainer.dueNowAmountMinor > 0 && 'amount-warning')}>
                        {retainer.dueNowAmountMinor > 0
                          ? formatAmount(retainer.dueNowAmountMinor, retainer.currency, locale)
                          : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </main>

        {/* Right Inspector Panel */}
        <aside className={cn('retainers-inspector', selectedRetainerId && 'visible')}>
          {selectedRetainer ? (
            <RetainerInspector
              retainer={selectedRetainer}
              onClose={() => selectRetainer(undefined)}
              onEdit={() => openRetainerDrawer({ mode: 'edit', retainerId: selectedRetainer.id })}
            />
          ) : (
            <div className="inspector-placeholder">
              <p>{t('retainers.selectToInspect')}</p>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}

// Status Badge Component
function RetainerStatusBadge({ status }: { status: RetainerStatus }) {
  const t = useT();
  return (
    <span className={cn('status-badge', `status-${status}`)}>
      {t(`retainers.status.${status}`)}
    </span>
  );
}

// Inspector Panel Component
import { useRetainerSchedule, usePauseRetainer, useResumeRetainer, useEndRetainer, useActivateRetainer } from '../../hooks/useRetainerQueries';
import type { RetainerAgreementDisplay, ProjectedIncomeState } from '../../types';

interface RetainerInspectorProps {
  retainer: RetainerAgreementDisplay;
  onClose: () => void;
  onEdit: () => void;
}

function RetainerInspector({ retainer, onClose, onEdit }: RetainerInspectorProps) {
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);

  const { data: schedule = [] } = useRetainerSchedule(retainer.id);
  const pauseMutation = usePauseRetainer();
  const resumeMutation = useResumeRetainer();
  const endMutation = useEndRetainer();
  const activateMutation = useActivateRetainer();

  // Sort schedule by expected date
  const sortedSchedule = [...schedule].sort((a, b) =>
    a.expectedDate.localeCompare(b.expectedDate)
  );

  // Show last 6 items for timeline
  const recentSchedule = sortedSchedule.slice(-6);

  const handlePause = () => {
    if (confirm(t('retainers.confirmPause'))) {
      pauseMutation.mutate(retainer.id);
    }
  };

  const handleResume = () => {
    resumeMutation.mutate(retainer.id);
  };

  const handleEnd = () => {
    if (confirm(t('retainers.confirmEnd'))) {
      endMutation.mutate(retainer.id);
    }
  };

  const handleActivate = () => {
    activateMutation.mutate(retainer.id);
  };

  return (
    <div className="inspector-content">
      <div className="inspector-header">
        <h3 className="inspector-title">{retainer.title}</h3>
        <button className="btn-icon" onClick={onClose} aria-label={t('common.close')}>
          <CloseIcon />
        </button>
      </div>

      {/* Overview Section */}
      <div className="inspector-section">
        <h4 className="inspector-section-title">{t('retainers.inspector.overview')}</h4>
        <dl className="inspector-details">
          <div className="inspector-detail">
            <dt>{t('retainers.inspector.client')}</dt>
            <dd>{retainer.clientName || t('common.noClient')}</dd>
          </div>
          {retainer.projectName && (
            <div className="inspector-detail">
              <dt>{t('retainers.inspector.project')}</dt>
              <dd>{retainer.projectName}</dd>
            </div>
          )}
          <div className="inspector-detail">
            <dt>{t('retainers.inspector.amount')}</dt>
            <dd className="amount-positive">
              {formatAmount(retainer.amountMinor, retainer.currency, locale)}
            </dd>
          </div>
          <div className="inspector-detail">
            <dt>{t('retainers.inspector.cadence')}</dt>
            <dd>{t(`retainers.cadence.${retainer.cadence}`)}</dd>
          </div>
          <div className="inspector-detail">
            <dt>{t('retainers.inspector.paymentDay')}</dt>
            <dd>{retainer.paymentDay}</dd>
          </div>
          <div className="inspector-detail">
            <dt>{t('retainers.inspector.startDate')}</dt>
            <dd>{new Date(retainer.startDate).toLocaleDateString(locale)}</dd>
          </div>
          {retainer.endDate && (
            <div className="inspector-detail">
              <dt>{t('retainers.inspector.endDate')}</dt>
              <dd>{new Date(retainer.endDate).toLocaleDateString(locale)}</dd>
            </div>
          )}
          <div className="inspector-detail">
            <dt>{t('retainers.inspector.status')}</dt>
            <dd><RetainerStatusBadge status={retainer.status} /></dd>
          </div>
        </dl>
      </div>

      {/* Schedule Timeline */}
      <div className="inspector-section">
        <h4 className="inspector-section-title">{t('retainers.inspector.schedule')}</h4>
        <div className="schedule-timeline">
          {recentSchedule.map((item) => (
            <div key={item.id} className={cn('schedule-item', `state-${item.state}`)}>
              <div className="schedule-item-icon">
                <ScheduleStateIcon state={item.state} />
              </div>
              <div className="schedule-item-content">
                <span className="schedule-item-date">
                  {new Date(item.expectedDate).toLocaleDateString(locale, {
                    month: 'short',
                    year: 'numeric',
                  })}
                </span>
                <span className="schedule-item-state">
                  {t(`retainers.state.${item.state}`)}
                </span>
              </div>
              <span className="schedule-item-amount">
                {formatAmount(item.expectedAmountMinor, item.currency, locale)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="inspector-actions">
        <button className="btn btn-secondary" onClick={onEdit}>
          {t('common.edit')}
        </button>
        {retainer.status === 'draft' && (
          <button
            className="btn btn-primary"
            onClick={handleActivate}
            disabled={activateMutation.isPending}
          >
            {t('retainers.activate')}
          </button>
        )}
        {retainer.status === 'active' && (
          <button
            className="btn btn-secondary"
            onClick={handlePause}
            disabled={pauseMutation.isPending}
          >
            {t('retainers.pause')}
          </button>
        )}
        {retainer.status === 'paused' && (
          <button
            className="btn btn-primary"
            onClick={handleResume}
            disabled={resumeMutation.isPending}
          >
            {t('retainers.resume')}
          </button>
        )}
        {(retainer.status === 'active' || retainer.status === 'paused') && (
          <button
            className="btn btn-danger"
            onClick={handleEnd}
            disabled={endMutation.isPending}
          >
            {t('retainers.end')}
          </button>
        )}
      </div>

      {retainer.notes && (
        <div className="inspector-section">
          <h4 className="inspector-section-title">{t('retainers.inspector.notes')}</h4>
          <p className="inspector-notes">{retainer.notes}</p>
        </div>
      )}
    </div>
  );
}

function ScheduleStateIcon({ state }: { state: ProjectedIncomeState }) {
  switch (state) {
    case 'received':
      return <CheckCircleIcon className="state-icon received" />;
    case 'partial':
      return <PartialIcon className="state-icon partial" />;
    case 'due':
      return <DueIcon className="state-icon due" />;
    case 'missed':
      return <MissedIcon className="state-icon missed" />;
    case 'canceled':
      return <CanceledIcon className="state-icon canceled" />;
    case 'upcoming':
    default:
      return <UpcomingIcon className="state-icon upcoming" />;
  }
}

// Icons
function CloseIcon() {
  return (
    <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  );
}

function CheckCircleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  );
}

function PartialIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  );
}

function DueIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
    </svg>
  );
}

function MissedIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m9.75 9.75 4.5 4.5m0-4.5-4.5 4.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  );
}

function CanceledIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636" />
    </svg>
  );
}

function UpcomingIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
