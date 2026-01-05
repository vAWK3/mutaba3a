import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { TopBar } from '../../components/layout';
import { SearchInput, CurrencyTabs } from '../../components/filters';
import { useClientSummaries } from '../../hooks/useQueries';
import { useDrawerStore } from '../../lib/stores';
import { formatAmount, formatDate, formatRelativeDate } from '../../lib/utils';
import type { Currency } from '../../types';

export function ClientsPage() {
  const { openClientDrawer } = useDrawerStore();
  const [currency, setCurrency] = useState<Currency | undefined>(undefined);
  const [search, setSearch] = useState('');

  const { data: clients = [], isLoading } = useClientSummaries(currency, search);

  const displayCurrency = currency || 'USD';

  return (
    <>
      <TopBar
        title="Clients"
        filterSlot={
          <div className="filters-row" style={{ marginBottom: 0, marginLeft: 24 }}>
            <CurrencyTabs value={currency} onChange={setCurrency} />
          </div>
        }
      />
      <div className="page-content">
        <div className="filters-row">
          <SearchInput value={search} onChange={setSearch} placeholder="Search clients..." />
        </div>

        {isLoading ? (
          <div className="loading">
            <div className="spinner" />
          </div>
        ) : clients.length === 0 ? (
          <div className="empty-state">
            <h3 className="empty-state-title">No clients found</h3>
            <p className="empty-state-description">
              {search ? 'Try adjusting your search' : 'Add your first client to get started'}
            </p>
            <button className="btn btn-primary" onClick={() => openClientDrawer({ mode: 'create' })}>
              Add Client
            </button>
          </div>
        ) : (
          <div className="data-table">
            <table>
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Active Projects</th>
                  <th style={{ textAlign: 'right' }}>Paid Income</th>
                  <th style={{ textAlign: 'right' }}>Unpaid</th>
                  <th>Last Payment</th>
                  <th>Last Activity</th>
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
                    <td className="amount-cell amount-positive">
                      {formatAmount(client.paidIncomeMinor, displayCurrency)}
                    </td>
                    <td className="amount-cell" style={{ color: 'var(--color-warning)' }}>
                      {formatAmount(client.unpaidIncomeMinor, displayCurrency)}
                    </td>
                    <td className="text-muted">
                      {client.lastPaymentAt ? formatDate(client.lastPaymentAt) : '-'}
                    </td>
                    <td className="text-muted">
                      {client.lastActivityAt ? formatRelativeDate(client.lastActivityAt) : '-'}
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
