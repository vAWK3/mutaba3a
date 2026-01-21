import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { TopBar } from '../../components/layout';
import { SearchInput } from '../../components/filters';
import { CurrencySummaryPopup } from '../../components/ui/CurrencySummaryPopup';
import { useClientSummaries } from '../../hooks/useQueries';
import { useDrawerStore } from '../../lib/stores';
import { formatDate, formatRelativeDate } from '../../lib/utils';
import { useT, useLanguage, getLocale } from '../../lib/i18n';

export function ClientsPage() {
  const { openClientDrawer } = useDrawerStore();
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);
  const [search, setSearch] = useState('');

  // Always fetch all currencies - no currency filter
  const { data: clients = [], isLoading } = useClientSummaries(undefined, search);

  return (
    <>
      <TopBar title={t('clients.title')} />
      <div className="page-content">
        <div className="filters-row">
          <SearchInput value={search} onChange={setSearch} placeholder={t('clients.searchPlaceholder')} />
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
          <div className="data-table">
            <table>
              <thead>
                <tr>
                  <th>{t('clients.columns.client')}</th>
                  <th>{t('clients.columns.activeProjects')}</th>
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
        )}
      </div>
    </>
  );
}
