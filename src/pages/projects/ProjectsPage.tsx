import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { TopBar } from '../../components/layout';
import { SearchInput, CurrencyTabs } from '../../components/filters';
import { useProjectSummaries } from '../../hooks/useQueries';
import { useDrawerStore } from '../../lib/stores';
import { formatAmount, formatRelativeDate } from '../../lib/utils';
import type { Currency } from '../../types';

const FIELDS = ['Design', 'Development', 'Consulting', 'Marketing', 'Legal', 'Maintenance', 'Other'];

export function ProjectsPage() {
  const { openProjectDrawer } = useDrawerStore();
  const [currency, setCurrency] = useState<Currency | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [field, setField] = useState<string>('');

  const { data: projects = [], isLoading } = useProjectSummaries(currency, search, field || undefined);

  const displayCurrency = currency || 'USD';

  return (
    <>
      <TopBar
        title="Projects"
        filterSlot={
          <div className="filters-row" style={{ marginBottom: 0, marginLeft: 24 }}>
            <CurrencyTabs value={currency} onChange={setCurrency} />
          </div>
        }
      />
      <div className="page-content">
        <div className="filters-row">
          <SearchInput value={search} onChange={setSearch} placeholder="Search projects..." />
          <select className="select" value={field} onChange={(e) => setField(e.target.value)}>
            <option value="">All fields</option>
            {FIELDS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>

        {isLoading ? (
          <div className="loading">
            <div className="spinner" />
          </div>
        ) : projects.length === 0 ? (
          <div className="empty-state">
            <h3 className="empty-state-title">No projects found</h3>
            <p className="empty-state-description">
              {search ? 'Try adjusting your search' : 'Create your first project to get started'}
            </p>
            <button className="btn btn-primary" onClick={() => openProjectDrawer({ mode: 'create' })}>
              Add Project
            </button>
          </div>
        ) : (
          <div className="data-table">
            <table>
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Client</th>
                  <th>Field</th>
                  <th style={{ textAlign: 'right' }}>Paid</th>
                  <th style={{ textAlign: 'right' }}>Unpaid</th>
                  <th style={{ textAlign: 'right' }}>Expenses</th>
                  <th style={{ textAlign: 'right' }}>Net</th>
                  <th>Last Activity</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => (
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
                    <td className="amount-cell amount-positive">
                      {formatAmount(project.paidIncomeMinor, displayCurrency)}
                    </td>
                    <td className="amount-cell" style={{ color: 'var(--color-warning)' }}>
                      {formatAmount(project.unpaidIncomeMinor, displayCurrency)}
                    </td>
                    <td className="amount-cell amount-negative">
                      {formatAmount(project.expensesMinor, displayCurrency)}
                    </td>
                    <td
                      className="amount-cell"
                      style={{
                        color: project.netMinor >= 0 ? 'var(--color-success)' : 'var(--color-danger)',
                      }}
                    >
                      {formatAmount(project.netMinor, displayCurrency)}
                    </td>
                    <td className="text-muted">
                      {project.lastActivityAt ? formatRelativeDate(project.lastActivityAt) : '-'}
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
