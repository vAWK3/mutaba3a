/**
 * ClientWorkSection
 *
 * "What have I worked on for this client?" (MUT-3): the client's income
 * entries as one flat list -- the entry is the work record. The filter row
 * narrows only this list; Owed Now and Payments are never filtered (D5).
 *
 * Row actions keep their earlier gates: Record payment through
 * RecordPaymentButton (MUT-6), invoice actions while Invoices is on (MUT-13),
 * the project tag linking only while Projects is on (MUT-16).
 */

import { useMemo, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { SearchInput, StatusSegment, DateRangeControl } from '../filters';
import { RowActionsMenu, PaymentStatusBadge, RecordPaymentButton, AmountWithConversion, EmptyState, type RowAction } from '../ui';
import { CheckIcon, CopyIcon, DocumentIcon } from '../icons';
import { useIncome, useMarkIncomePaid, type IncomeFilters } from '../../hooks/useIncomeQueries';
import { useFeatureEnabled } from '../../lib/features/useFeatures';
import { useDrawerStore } from '../../lib/stores';
import { formatAmount, formatDate, getDateRangePreset, cn } from '../../lib/utils';
import { todayLocalISO } from '../../lib/dates';
import { useT, useLanguage, getLocale } from '../../lib/i18n';
import { toWorkRow, type WorkRow } from './clientProfileRows';
import type { TxStatus } from '../../types';

export interface ClientWorkSectionProps {
  clientId: string;
}

interface WorkFilters {
  dateFrom: string;
  dateTo: string;
  status?: TxStatus | 'overdue';
  search: string;
}

const DEFAULT_FILTERS: WorkFilters = { ...getDateRangePreset('all'), status: undefined, search: '' };

const isDefault = (filters: WorkFilters) =>
  filters.dateFrom === DEFAULT_FILTERS.dateFrom &&
  filters.dateTo === DEFAULT_FILTERS.dateTo &&
  filters.status === undefined &&
  filters.search === '';

export function ClientWorkSection({ clientId }: ClientWorkSectionProps) {
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);
  const navigate = useNavigate();
  const { openIncomeDrawer, openProjectDrawer, openPartialPaymentDrawer, openDocumentDrawer } = useDrawerStore();
  const invoicesEnabled = useFeatureEnabled('invoices');
  const projectsEnabled = useFeatureEnabled('projects');
  const markPaid = useMarkIncomePaid();

  // One filter object, so a change is one state update and one query key
  const [filters, setFilters] = useState<WorkFilters>(DEFAULT_FILTERS);
  const updateFilters = (patch: Partial<WorkFilters>) => setFilters((prev) => ({ ...prev, ...patch }));

  const queryFilters = useMemo(
    (): IncomeFilters => ({
      clientId,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      status: filters.status,
      search: filters.search || undefined,
      sort: { by: 'occurredAt', dir: 'desc' },
    }),
    [clientId, filters]
  );
  const { data: entries = [], isLoading } = useIncome(queryFilters);

  // One "today" per render so every row is classified the same way
  const today = todayLocalISO();
  const rows = useMemo(() => entries.map((tx) => toWorkRow(tx, today)), [entries, today]);

  const hasNoWork = !isLoading && rows.length === 0 && isDefault(filters);
  const addIncome = () => openIncomeDrawer({ mode: 'create', defaultClientId: clientId });

  const rowActions = (row: WorkRow): RowAction[] => {
    const actions: RowAction[] = [];
    if (row.isReceivable && row.paymentStatus !== 'paid') {
      actions.push({ label: t('common.markPaid'), icon: <CheckIcon size={16} />, onClick: () => markPaid.mutate(row.id) });
    }
    if (invoicesEnabled) {
      const documentId = row.tx.linkedDocumentId;
      actions.push(
        documentId
          ? {
              label: t('transactions.viewInvoice'),
              icon: <DocumentIcon size={16} />,
              onClick: () => navigate({ to: '/documents/$documentId', params: { documentId } }),
            }
          : {
              label: t('transactions.generateInvoice'),
              icon: <DocumentIcon size={16} />,
              onClick: () =>
                openDocumentDrawer({
                  mode: 'create',
                  defaultType: row.paymentStatus === 'paid' ? 'receipt' : 'invoice',
                  defaultClientId: clientId,
                  linkTransactionId: row.id,
                }),
            }
      );
    }
    actions.push({
      label: t('common.duplicate'),
      icon: <CopyIcon size={16} />,
      onClick: () => openIncomeDrawer({ mode: 'create', duplicateFromId: row.id }),
    });
    return actions;
  };

  return (
    <section className="client-section" aria-labelledby="client-work-title">
      <div className="client-section-header">
        <h2 id="client-work-title" className="client-section-title">
          {t('clients.profile.work.title')}
        </h2>
        <div className="client-section-actions">
          {projectsEnabled && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => openProjectDrawer({ mode: 'create', defaultClientId: clientId })}
            >
              {t('projects.addProject')}
            </button>
          )}
          {!hasNoWork && (
            <button className="btn btn-secondary btn-sm" onClick={addIncome}>
              {t('clients.profile.work.add')}
            </button>
          )}
        </div>
      </div>

      {hasNoWork ? (
        <EmptyState
          title={t('clients.profile.work.emptyTitle')}
          description={t('clients.profile.work.emptyHint')}
          action={{ label: t('clients.profile.work.add'), onClick: addIncome }}
        />
      ) : (
        <>
          <div className="filters-row">
            <DateRangeControl
              dateFrom={filters.dateFrom}
              dateTo={filters.dateTo}
              onChange={(dateFrom, dateTo) => updateFilters({ dateFrom, dateTo })}
            />
            <StatusSegment value={filters.status} onChange={(status) => updateFilters({ status })} />
            <SearchInput value={filters.search} onChange={(search) => updateFilters({ search })} />
          </div>

          {isLoading ? (
            <div className="loading">
              <div className="spinner" />
            </div>
          ) : rows.length === 0 ? (
            <div className="card-empty">
              <p>{t('clients.profile.work.noMatches')}</p>
              <button className="btn btn-ghost btn-sm" onClick={() => setFilters(DEFAULT_FILTERS)}>
                {t('clients.profile.work.clearFilters')}
              </button>
            </div>
          ) : (
            <div className="data-table client-work-table">
              <table>
                <thead>
                  <tr>
                    <th>{t('transactions.columns.date')}</th>
                    <th>{t('clients.profile.work.what')}</th>
                    <th style={{ textAlign: 'end' }}>{t('transactions.columns.amount')}</th>
                    <th>{t('transactions.columns.status')}</th>
                    <th className="row-actions-header"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.id}
                      className="clickable"
                      onClick={() => openIncomeDrawer({ mode: 'edit', transactionId: row.id })}
                    >
                      <td className="client-work-date">{formatDate(row.date, locale)}</td>
                      <td className="client-work-what">
                        <div className="client-work-what-inner">
                          <span className={cn('client-work-title', !row.title && 'text-muted')}>
                            {row.title ?? t('clients.profile.work.untitled')}
                          </span>
                          {row.projectName &&
                            (projectsEnabled && row.projectId ? (
                              <Link
                                to="/projects/$projectId"
                                params={{ projectId: row.projectId }}
                                className="project-tag"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {row.projectName}
                              </Link>
                            ) : (
                              <span className="project-tag">{row.projectName}</span>
                            ))}
                        </div>
                      </td>
                      <td className="amount-cell">
                        <AmountWithConversion amountMinor={row.amountMinor} currency={row.currency} />
                        {row.remainingMinor !== undefined && (
                          <div className="client-work-subline">
                            {t('transactions.partialPayment.remaining')}:{' '}
                            <bdi dir="ltr">{formatAmount(row.remainingMinor, row.currency, locale)}</bdi>
                          </div>
                        )}
                      </td>
                      <td>
                        <PaymentStatusBadge
                          paymentStatus={row.paymentStatus}
                          amountMinor={row.amountMinor}
                          receivedAmountMinor={row.tx.receivedAmountMinor}
                        />
                        {row.overdueDays !== undefined && (
                          <div className="client-work-subline text-danger">
                            {t('transactions.status.overdue', { days: row.overdueDays })}
                          </div>
                        )}
                        {row.dueInDays !== undefined && (
                          <div className="client-work-subline">
                            {row.dueInDays === 0
                              ? t('transactions.status.dueToday')
                              : t('transactions.status.dueIn', { days: row.dueInDays })}
                          </div>
                        )}
                      </td>
                      <td>
                        <div className="row-actions-cell">
                          <RecordPaymentButton
                            transaction={row.tx}
                            onRecordPayment={() => openPartialPaymentDrawer({ transactionId: row.id })}
                          />
                          <RowActionsMenu actions={rowActions(row)} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
