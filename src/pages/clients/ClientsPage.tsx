import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { TopBar } from '../../components/layout';
import { SearchInput, CurrencyTabs } from '../../components/filters';
import { UnifiedAmount } from '../../components/ui/UnifiedAmount';
import { useClientSummaries } from '../../hooks/useQueries';
import { useDrawerStore } from '../../lib/stores';
import { formatAmount, formatDate, formatRelativeDate } from '../../lib/utils';
import { useT, useLanguage, getLocale } from '../../lib/i18n';
import type { Currency } from '../../types';

export function ClientsPage() {
  const { openClientDrawer } = useDrawerStore();
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);
  const [currency, setCurrency] = useState<Currency | undefined>(undefined);
  const [search, setSearch] = useState('');

  const { data: clients = [], isLoading } = useClientSummaries(currency, search);

  // Helper to check if client has per-currency data (when no currency filter)
  const hasPerCurrencyData = !currency;

  return (
    <>
      <TopBar
        title={t('clients.title')}
        filterSlot={
          <div className="filters-row" style={{ marginBottom: 0, marginInlineStart: 24 }}>
            <CurrencyTabs value={currency} onChange={setCurrency} />
          </div>
        }
      />
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
                      {hasPerCurrencyData && client.unpaidIncomeMinorUSD !== undefined ? (
                        <UnifiedAmount
                          usdAmountMinor={client.unpaidIncomeMinorUSD}
                          ilsAmountMinor={client.unpaidIncomeMinorILS ?? 0}
                          variant="compact"
                          type="neutral"
                        />
                      ) : (
                        <span style={{ color: 'var(--color-warning)' }}>
                          {formatAmount(client.unpaidIncomeMinor, currency!, locale)}
                        </span>
                      )}
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
