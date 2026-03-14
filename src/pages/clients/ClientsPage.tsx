import { useState, useMemo, useEffect } from 'react';
import { Link } from '@tanstack/react-router';
import { TopBar } from '../../components/layout';
import { SearchInput } from '../../components/filters';
import { CurrencySummaryPopup } from '../../components/ui/CurrencySummaryPopup';
import { OrphanedRecordsModal } from '../../components/modals';
import { useClientSummaries, useClients } from '../../hooks/useQueries';
import { useSortState } from '../../hooks/useSortState';
import { useProfileFilter } from '../../hooks/useActiveProfile';
import { useDrawerStore } from '../../lib/stores';
import { formatDate, formatRelativeDate } from '../../lib/utils';
import { useT, useLanguage, getLocale } from '../../lib/i18n';

type SortField = 'name' | 'value' | 'unpaid' | 'activity';

export function ClientsPage() {
  const { openClientDrawer } = useDrawerStore();
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);
  const [search, setSearch] = useState('');
  const [showOrphanedModal, setShowOrphanedModal] = useState(false);

  // URL-persisted sorting
  const { sortField, sortDir, setSort } = useSortState<SortField>({
    defaultField: 'name',
    defaultDir: 'asc',
    validFields: ['name', 'value', 'unpaid', 'activity'],
  });

  // Get active profile filter (undefined in "All Profiles" mode)
  const profileId = useProfileFilter();

  // Fetch all clients to check for orphaned records
  const { data: allClients = [] } = useClients(undefined);

  // Check for orphaned clients and show modal
  useEffect(() => {
    const orphanedClients = allClients.filter((c) => !c.profileId && !c.archivedAt);
    if (orphanedClients.length > 0 && !showOrphanedModal) {
      setShowOrphanedModal(true);
    }
  }, [allClients, showOrphanedModal]);

  // Always fetch all currencies - no currency filter
  const { data: rawClients = [], isLoading } = useClientSummaries(profileId, undefined, search);

  // Sort clients
  const clients = useMemo(() => {
    const sorted = [...rawClients].sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'value': {
          // Sum all currencies for total value comparison
          const aValue = (a.paidIncomeMinorUSD ?? 0) + (a.paidIncomeMinorILS ?? 0) + (a.paidIncomeMinorEUR ?? 0);
          const bValue = (b.paidIncomeMinorUSD ?? 0) + (b.paidIncomeMinorILS ?? 0) + (b.paidIncomeMinorEUR ?? 0);
          comparison = aValue - bValue;
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
  }, [rawClients, sortField, sortDir]);

  // Calculate totals for summary strip
  const totals = useMemo(() => {
    return clients.reduce(
      (acc, client) => ({
        receivedUSD: acc.receivedUSD + (client.paidIncomeMinorUSD ?? 0),
        receivedILS: acc.receivedILS + (client.paidIncomeMinorILS ?? 0),
        receivedEUR: acc.receivedEUR + (client.paidIncomeMinorEUR ?? 0),
        unpaidUSD: acc.unpaidUSD + (client.unpaidIncomeMinorUSD ?? 0),
        unpaidILS: acc.unpaidILS + (client.unpaidIncomeMinorILS ?? 0),
        unpaidEUR: acc.unpaidEUR + (client.unpaidIncomeMinorEUR ?? 0),
      }),
      { receivedUSD: 0, receivedILS: 0, receivedEUR: 0, unpaidUSD: 0, unpaidILS: 0, unpaidEUR: 0 }
    );
  }, [clients]);

  return (
    <>
      <OrphanedRecordsModal
        isOpen={showOrphanedModal}
        onClose={() => setShowOrphanedModal(false)}
        type="clients"
      />
      <TopBar title={t('clients.title')} />
      <div className="page-content">
        <div className="filters-row">
          <SearchInput value={search} onChange={setSearch} placeholder={t('clients.searchPlaceholder')} />
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
            <option value="value-desc">{t('common.sort.valueHigh')}</option>
            <option value="value-asc">{t('common.sort.valueLow')}</option>
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
        ) : clients.length === 0 ? (
          <div className="empty-state">
            <h3 className="empty-state-title">{t('clients.empty')}</h3>
            <p className="empty-state-description">
              {search ? t('clients.emptySearch') : t('clients.emptyHint')}
            </p>
            <button className="btn btn-primary" onClick={() => openClientDrawer({ mode: 'create' })}>
              {t('clients.addClient')}
            </button>
          </div>
        ) : (
          <>
            {/* Summary strip */}
            <div className="clients-summary-strip">
              <div className="clients-summary-count">
                {clients.length === 1
                  ? t('clients.summary.clientsCountOne')
                  : t('clients.summary.clientsCount', { count: clients.length })}
              </div>
              <div className="clients-summary-item">
                <span className="clients-summary-label">{t('clients.summary.totalReceived')}</span>
                <CurrencySummaryPopup
                  usdAmountMinor={totals.receivedUSD}
                  ilsAmountMinor={totals.receivedILS}
                  eurAmountMinor={totals.receivedEUR}
                  type="income"
                />
              </div>
              <div className="clients-summary-item">
                <span className="clients-summary-label">{t('clients.summary.totalUnpaid')}</span>
                <CurrencySummaryPopup
                  usdAmountMinor={totals.unpaidUSD}
                  ilsAmountMinor={totals.unpaidILS}
                  eurAmountMinor={totals.unpaidEUR}
                  type="neutral"
                />
              </div>
            </div>
            <div className="data-table">
              <table>
              <thead>
                <tr>
                  <th>{t('clients.columns.client')}</th>
                  <th>{t('clients.columns.activeProjects')}</th>
                  <th style={{ textAlign: 'end' }}>{t('clients.columns.received')}</th>
                  <th style={{ textAlign: 'end' }}>{t('clients.columns.unpaid')}</th>
                  <th>{t('clients.columns.lastPayment')}</th>
                  <th>{t('clients.columns.lastActivity')}</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((client) => (
                  <tr key={client.id}>
                    <td>
                      <Link
                        to="/clients/$clientId"
                        params={{ clientId: client.id }}
                        style={{ fontWeight: 500 }}
                      >
                        {client.name}
                      </Link>
                    </td>
                    <td className="text-secondary">{client.activeProjectCount}</td>
                    <td className="amount-cell">
                      <CurrencySummaryPopup
                        usdAmountMinor={client.paidIncomeMinorUSD ?? 0}
                        ilsAmountMinor={client.paidIncomeMinorILS ?? 0}
                        eurAmountMinor={client.paidIncomeMinorEUR ?? 0}
                        type="income"
                      />
                    </td>
                    <td className="amount-cell">
                      <CurrencySummaryPopup
                        usdAmountMinor={client.unpaidIncomeMinorUSD ?? 0}
                        ilsAmountMinor={client.unpaidIncomeMinorILS ?? 0}
                        eurAmountMinor={client.unpaidIncomeMinorEUR ?? 0}
                        type="neutral"
                      />
                    </td>
                    <td className="text-muted">
                      {client.lastPaymentAt ? formatDate(client.lastPaymentAt, locale) : '-'}
                    </td>
                    <td className="text-muted">
                      {client.lastActivityAt ? formatRelativeDate(client.lastActivityAt, t) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>
    </>
  );
}
