import { useState, useMemo } from 'react';
import { Link } from '@tanstack/react-router';
import { TopBar } from '../../components/layout';
import { SearchInput } from '../../components/filters';
import { CurrencySummaryPopup } from '../../components/ui/CurrencySummaryPopup';
import { useProjectSummaries } from '../../hooks/useQueries';
import { useSortState } from '../../hooks/useSortState';
import { useProfileFilter } from '../../hooks/useActiveProfile';
import { useDrawerStore } from '../../lib/stores';
import { formatRelativeDate } from '../../lib/utils';
import { useT } from '../../lib/i18n';

type SortField = 'name' | 'net' | 'unpaid' | 'activity';

export function ProjectsPage() {
  const { openProjectDrawer } = useDrawerStore();
  const t = useT();
  const [search, setSearch] = useState('');

  // URL-persisted sorting
  const { sortField, sortDir, setSort } = useSortState<SortField>({
    defaultField: 'name',
    defaultDir: 'asc',
    validFields: ['name', 'net', 'unpaid', 'activity'],
  });

  // Get active profile filter (undefined in "All Profiles" mode)
  const profileId = useProfileFilter();

  // Always fetch all currencies - no currency filter
  const { data: rawProjects = [], isLoading } = useProjectSummaries(profileId, undefined, search);

  // Sort projects
  const projects = useMemo(() => {
    const sorted = [...rawProjects].sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'net': {
          // Calculate net for each project
          const aNet = ((a.paidIncomeMinorUSD ?? 0) + (a.paidIncomeMinorILS ?? 0) + (a.paidIncomeMinorEUR ?? 0)) -
                       ((a.expensesMinorUSD ?? 0) + (a.expensesMinorILS ?? 0) + (a.expensesMinorEUR ?? 0));
          const bNet = ((b.paidIncomeMinorUSD ?? 0) + (b.paidIncomeMinorILS ?? 0) + (b.paidIncomeMinorEUR ?? 0)) -
                       ((b.expensesMinorUSD ?? 0) + (b.expensesMinorILS ?? 0) + (b.expensesMinorEUR ?? 0));
          comparison = aNet - bNet;
          break;
        }
        case 'unpaid': {
          const aUnpaid = (a.unpaidIncomeMinorUSD ?? 0) + (a.unpaidIncomeMinorILS ?? 0) + (a.unpaidIncomeMinorEUR ?? 0);
          const bUnpaid = (b.unpaidIncomeMinorUSD ?? 0) + (b.unpaidIncomeMinorILS ?? 0) + (b.unpaidIncomeMinorEUR ?? 0);
          comparison = aUnpaid - bUnpaid;
          break;
        }
        case 'activity': {
          const aDate = a.lastActivityAt || '1970-01-01';
          const bDate = b.lastActivityAt || '1970-01-01';
          comparison = aDate.localeCompare(bDate);
          break;
        }
      }
      return sortDir === 'asc' ? comparison : -comparison;
    });
    return sorted;
  }, [rawProjects, sortField, sortDir]);

  // Calculate totals for summary strip
  const totals = useMemo(() => {
    return projects.reduce(
      (acc, project) => ({
        receivedUSD: acc.receivedUSD + (project.paidIncomeMinorUSD ?? 0),
        receivedILS: acc.receivedILS + (project.paidIncomeMinorILS ?? 0),
        receivedEUR: acc.receivedEUR + (project.paidIncomeMinorEUR ?? 0),
        unpaidUSD: acc.unpaidUSD + (project.unpaidIncomeMinorUSD ?? 0),
        unpaidILS: acc.unpaidILS + (project.unpaidIncomeMinorILS ?? 0),
        unpaidEUR: acc.unpaidEUR + (project.unpaidIncomeMinorEUR ?? 0),
        expensesUSD: acc.expensesUSD + (project.expensesMinorUSD ?? 0),
        expensesILS: acc.expensesILS + (project.expensesMinorILS ?? 0),
        expensesEUR: acc.expensesEUR + (project.expensesMinorEUR ?? 0),
      }),
      {
        receivedUSD: 0, receivedILS: 0, receivedEUR: 0,
        unpaidUSD: 0, unpaidILS: 0, unpaidEUR: 0,
        expensesUSD: 0, expensesILS: 0, expensesEUR: 0,
      }
    );
  }, [projects]);

  // Calculate net totals
  const netTotals = useMemo(() => ({
    USD: totals.receivedUSD - totals.expensesUSD,
    ILS: totals.receivedILS - totals.expensesILS,
    EUR: totals.receivedEUR - totals.expensesEUR,
  }), [totals]);

  return (
    <>
      <TopBar title={t('projects.title')} />
      <div className="page-content">
        <div className="filters-row">
          <SearchInput value={search} onChange={setSearch} placeholder={t('projects.searchPlaceholder')} />
          <select
            className="select"
            value={`${sortField}-${sortDir}`}
            onChange={(e) => {
              const [field, dir] = e.target.value.split('-') as [SortField, 'asc' | 'desc'];
              setSort(field, dir);
            }}
          >
            <option value="name-asc">{t('common.sort.nameAZ')}</option>
            <option value="name-desc">{t('common.sort.nameZA')}</option>
            <option value="net-desc">{t('common.sort.netHigh')}</option>
            <option value="net-asc">{t('common.sort.netLow')}</option>
            <option value="unpaid-desc">{t('common.sort.unpaidHigh')}</option>
            <option value="unpaid-asc">{t('common.sort.unpaidLow')}</option>
            <option value="activity-desc">{t('common.sort.activityRecent')}</option>
            <option value="activity-asc">{t('common.sort.activityOldest')}</option>
          </select>
        </div>

        {isLoading ? (
          <div className="loading">
            <div className="spinner" />
          </div>
        ) : projects.length === 0 ? (
          <div className="empty-state">
            <h3 className="empty-state-title">{t('projects.empty')}</h3>
            <p className="empty-state-description">
              {search ? t('projects.emptySearch') : t('projects.emptyHint')}
            </p>
            <button className="btn btn-primary" onClick={() => openProjectDrawer({ mode: 'create' })}>
              {t('projects.addProject')}
            </button>
          </div>
        ) : (
          <>
            {/* Summary strip */}
            <div className="projects-summary-strip">
              <div className="projects-summary-count">
                {projects.length === 1
                  ? t('projects.summary.projectsCountOne')
                  : t('projects.summary.projectsCount', { count: projects.length })}
              </div>
              <div className="projects-summary-item">
                <span className="projects-summary-label">{t('projects.summary.totalReceived')}</span>
                <CurrencySummaryPopup
                  usdAmountMinor={totals.receivedUSD}
                  ilsAmountMinor={totals.receivedILS}
                  eurAmountMinor={totals.receivedEUR}
                  type="income"
                />
              </div>
              <div className="projects-summary-item">
                <span className="projects-summary-label">{t('projects.summary.totalUnpaid')}</span>
                <CurrencySummaryPopup
                  usdAmountMinor={totals.unpaidUSD}
                  ilsAmountMinor={totals.unpaidILS}
                  eurAmountMinor={totals.unpaidEUR}
                  type="neutral"
                />
              </div>
              <div className="projects-summary-item">
                <span className="projects-summary-label">{t('projects.summary.totalExpenses')}</span>
                <CurrencySummaryPopup
                  usdAmountMinor={totals.expensesUSD}
                  ilsAmountMinor={totals.expensesILS}
                  eurAmountMinor={totals.expensesEUR}
                  type="expense"
                />
              </div>
              <div className="projects-summary-item">
                <span className="projects-summary-label">{t('projects.summary.totalNet')}</span>
                <CurrencySummaryPopup
                  usdAmountMinor={netTotals.USD}
                  ilsAmountMinor={netTotals.ILS}
                  eurAmountMinor={netTotals.EUR}
                  type="net"
                />
              </div>
            </div>
            <div className="data-table">
              <table>
                <thead>
                  <tr>
                    <th>{t('projects.columns.project')}</th>
                    <th>{t('projects.columns.client')}</th>
                    <th>{t('projects.columns.field')}</th>
                    <th style={{ textAlign: 'end' }}>{t('projects.columns.received')}</th>
                    <th style={{ textAlign: 'end' }}>{t('projects.columns.unpaid')}</th>
                    <th style={{ textAlign: 'end' }}>{t('projects.columns.expenses')}</th>
                    <th style={{ textAlign: 'end' }}>{t('projects.columns.net')}</th>
                    <th>{t('projects.columns.lastActivity')}</th>
                  </tr>
                </thead>
              <tbody>
                {projects.map((project) => {
                  const netUSD = (project.paidIncomeMinorUSD ?? 0) - (project.expensesMinorUSD ?? 0);
                  const netILS = (project.paidIncomeMinorILS ?? 0) - (project.expensesMinorILS ?? 0);
                  const netEUR = (project.paidIncomeMinorEUR ?? 0) - (project.expensesMinorEUR ?? 0);
                  const isNegativeNet = netUSD + netILS + netEUR < 0;

                  return (
                    <tr key={project.id}>
                      <td>
                        <Link
                          to="/projects/$projectId"
                          params={{ projectId: project.id }}
                          style={{ fontWeight: 500 }}
                        >
                          {project.name}
                        </Link>
                      </td>
                      <td className="text-secondary">{project.clientName || '-'}</td>
                      <td className="text-secondary">{project.field || '-'}</td>
                      <td className="amount-cell">
                        <CurrencySummaryPopup
                          usdAmountMinor={project.paidIncomeMinorUSD ?? 0}
                          ilsAmountMinor={project.paidIncomeMinorILS ?? 0}
                          eurAmountMinor={project.paidIncomeMinorEUR ?? 0}
                          type="income"
                        />
                      </td>
                      <td className="amount-cell">
                        <CurrencySummaryPopup
                          usdAmountMinor={project.unpaidIncomeMinorUSD ?? 0}
                          ilsAmountMinor={project.unpaidIncomeMinorILS ?? 0}
                          eurAmountMinor={project.unpaidIncomeMinorEUR ?? 0}
                          type="neutral"
                        />
                      </td>
                      <td className="amount-cell">
                        <CurrencySummaryPopup
                          usdAmountMinor={project.expensesMinorUSD ?? 0}
                          ilsAmountMinor={project.expensesMinorILS ?? 0}
                          eurAmountMinor={project.expensesMinorEUR ?? 0}
                          type="expense"
                        />
                      </td>
                      <td className={`amount-cell net-cell ${isNegativeNet ? 'negative' : 'positive'}`}>
                        <CurrencySummaryPopup
                          usdAmountMinor={netUSD}
                          ilsAmountMinor={netILS}
                          eurAmountMinor={netEUR}
                          type="net"
                        />
                      </td>
                      <td className="text-muted">
                        {project.lastActivityAt ? formatRelativeDate(project.lastActivityAt, t) : '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>
    </>
  );
}
