import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { TopBar } from '../../components/layout';
import { SearchInput, CurrencyTabs } from '../../components/filters';
import { UnifiedAmount } from '../../components/ui/UnifiedAmount';
import { useProjectSummaries } from '../../hooks/useQueries';
import { useDrawerStore } from '../../lib/stores';
import { formatAmount, formatRelativeDate } from '../../lib/utils';
import { useT, useLanguage, getLocale } from '../../lib/i18n';
import type { Currency } from '../../types';

export function ProjectsPage() {
  const { openProjectDrawer } = useDrawerStore();
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);
  const [currency, setCurrency] = useState<Currency | undefined>(undefined);
  const [search, setSearch] = useState('');

  const { data: projects = [], isLoading } = useProjectSummaries(currency, search);

  // Helper to check if project has per-currency data (when no currency filter)
  const hasPerCurrencyData = !currency;

  return (
    <>
      <TopBar
        title={t('projects.title')}
        filterSlot={
          <div className="filters-row" style={{ marginBottom: 0, marginInlineStart: 24 }}>
            <CurrencyTabs value={currency} onChange={setCurrency} />
          </div>
        }
      />
      <div className="page-content">
        <div className="filters-row">
          <SearchInput value={search} onChange={setSearch} placeholder={t('projects.searchPlaceholder')} />
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
          <div className="data-table">
            <table>
              <thead>
                <tr>
                  <th>{t('projects.columns.project')}</th>
                  <th>{t('projects.columns.client')}</th>
                  <th>{t('projects.columns.field')}</th>
                  <th style={{ textAlign: 'end' }}>{t('projects.columns.unpaid')}</th>
                  <th>{t('projects.columns.lastActivity')}</th>
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
                    <td className="amount-cell">
                      {hasPerCurrencyData && project.unpaidIncomeMinorUSD !== undefined ? (
                        <UnifiedAmount
                          usdAmountMinor={project.unpaidIncomeMinorUSD}
                          ilsAmountMinor={project.unpaidIncomeMinorILS ?? 0}
                          variant="compact"
                          type="neutral"
                        />
                      ) : (
                        <span style={{ color: 'var(--color-warning)' }}>
                          {formatAmount(project.unpaidIncomeMinor, currency!, locale)}
                        </span>
                      )}
                    </td>
                    <td className="text-muted">
                      {project.lastActivityAt ? formatRelativeDate(project.lastActivityAt, t) : '-'}
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
