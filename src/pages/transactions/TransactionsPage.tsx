import { useState, useMemo, useEffect } from "react";
import { useSearch } from "@tanstack/react-router";
import { TopBar } from "../../components/layout";
import {
  SearchInput,
  StatusSegment,
  TypeSegment,
  DateRangeControl,
} from "../../components/filters";
import { EmptyState, RowActionsMenu, AmountWithConversion } from "../../components/ui";
import { CheckIcon, CopyIcon, DocumentIcon } from "../../components/icons";
import { TransactionTypeBadge, TransactionStatusCell } from "../../components/transactions";
import { useTransactions } from "../../hooks/useQueries";
import { useMarkIncomePaid } from "../../hooks/useIncomeQueries";
import { useIsCompactTable } from "../../hooks/useMediaQuery";
import { useDrawerStore } from "../../lib/stores";
import {
  formatDate,
  formatDateCompact,
  getDateRangePreset,
  cn,
  getDaysUntil,
} from "../../lib/utils";
import { useT, useLanguage, getLocale } from "../../lib/i18n";
import type { TxKind, TxStatus, QueryFilters } from "../../types";

type TypeFilter = TxKind | "receivable" | undefined;

interface TransactionsSearchParams {
  dateFrom?: string;
  dateTo?: string;
  kind?: TxKind;
  status?: TxStatus | 'overdue';
}

export function TransactionsPage() {
  const { openIncomeDrawer, openExpenseDrawer, openDocumentDrawer } = useDrawerStore();
  const markPaidMutation = useMarkIncomePaid();
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);

  // Read URL search params
  const searchParams = useSearch({ strict: false }) as TransactionsSearchParams;

  // Initialize filters from URL params or defaults
  const [dateRange, setDateRange] = useState(() => {
    if (searchParams.dateFrom && searchParams.dateTo) {
      return { dateFrom: searchParams.dateFrom, dateTo: searchParams.dateTo };
    }
    return getDateRangePreset("all");
  });

  // Derive type filter from URL kind+status
  const initialTypeFilter = useMemo((): TypeFilter => {
    if (searchParams.kind === 'income' && searchParams.status === 'unpaid') {
      return 'receivable';
    }
    return searchParams.kind;
  }, [searchParams.kind, searchParams.status]);

  const [typeFilter, setTypeFilter] = useState<TypeFilter>(initialTypeFilter);
  const [statusFilter, setStatusFilter] = useState<TxStatus | "overdue" | undefined>(
    // Don't set status filter if receivable type since it's implicit
    initialTypeFilter === 'receivable' ? undefined : searchParams.status
  );
  const [search, setSearch] = useState("");

  // Clear URL-based filters after initial load (optional - keeps URL clean)
  const [initialParamsApplied, setInitialParamsApplied] = useState(false);
  useEffect(() => {
    if (!initialParamsApplied && (searchParams.dateFrom || searchParams.kind)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInitialParamsApplied(true);
    }
  }, [initialParamsApplied, searchParams]);

  // Build query filters - always fetch all currencies (no currency filter)
  const queryFilters = useMemo((): QueryFilters => {
    const filters: QueryFilters = {
      dateFrom: dateRange.dateFrom,
      dateTo: dateRange.dateTo,
      search: search || undefined,
      sort: { by: "occurredAt", dir: "desc" },
    };

    if (typeFilter === "receivable") {
      filters.kind = "income";
      filters.status = "unpaid";
    } else if (typeFilter) {
      filters.kind = typeFilter;
    }

    if (statusFilter && typeFilter !== "receivable") {
      filters.status = statusFilter;
    }

    return filters;
  }, [dateRange, typeFilter, statusFilter, search]);

  const { data: transactions = [], isLoading } = useTransactions(queryFilters);
  const isCompact = useIsCompactTable();

  // Helper to get status for the compact mode dot
  const getStatusForDot = (tx: typeof transactions[0]): 'paid' | 'unpaid' | 'overdue' | null => {
    if (tx.kind !== 'income') return null;
    if (tx.status === 'paid') return 'paid';
    if (tx.dueDate) {
      const daysUntil = getDaysUntil(tx.dueDate);
      if (daysUntil < 0) return 'overdue';
    }
    return 'unpaid';
  };

  const handleRowClick = (id: string, kind: TxKind) => {
    if (kind === 'expense') {
      openExpenseDrawer({ mode: "edit", expenseId: id });
    } else {
      openIncomeDrawer({ mode: "edit", transactionId: id });
    }
  };

  return (
    <>
      <TopBar
        title={t('transactions.title')}
        filterSlot={
          <div
            className="filters-row"
            style={{ marginBottom: 0, marginInlineStart: 24, flexWrap: "nowrap" }}
          >
            <DateRangeControl
              dateFrom={dateRange.dateFrom}
              dateTo={dateRange.dateTo}
              onChange={(from, to) =>
                setDateRange({ dateFrom: from, dateTo: to })
              }
            />
          </div>
        }
      />
      <div className="page-content">
        <div className="filters-row">
          <TypeSegment value={typeFilter} onChange={setTypeFilter} />
          <StatusSegment value={statusFilter} onChange={setStatusFilter} />
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder={t('transactions.searchPlaceholder')}
          />
        </div>

        {isLoading ? (
          <div className="loading">
            <div className="spinner" />
          </div>
        ) : transactions.length === 0 ? (
          <EmptyState
            title={t('transactions.empty')}
            description={search ? t('transactions.emptySearch') : t('transactions.emptyHint')}
            action={{
              label: t('transactions.addTransaction'),
              onClick: () => openIncomeDrawer({ mode: "create", defaultStatus: "earned" }),
            }}
          />
        ) : (
          <div className="data-table">
            <table>
              <thead>
                <tr>
                  <th>{t('transactions.columns.date')}</th>
                  <th>{t('transactions.columns.type')}</th>
                  <th>{t('transactions.columns.client')}</th>
                  <th>{t('transactions.columns.project')}</th>
                  <th style={{ textAlign: "end" }}>{t('transactions.columns.amount')}</th>
                  {!isCompact && <th>{t('transactions.columns.status')}</th>}
                  <th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr
                    key={tx.id}
                    className="clickable"
                    onClick={() => handleRowClick(tx.id, tx.kind)}
                  >
                    <td className={isCompact ? 'date-cell-compact' : undefined}>
                      {isCompact && getStatusForDot(tx) && (
                        <span
                          className="status-dot"
                          data-status={getStatusForDot(tx)}
                          aria-label={getStatusForDot(tx) || undefined}
                        />
                      )}
                      {isCompact ? formatDateCompact(tx.occurredAt) : formatDate(tx.occurredAt, locale)}
                    </td>
                    <td>
                      <TransactionTypeBadge kind={tx.kind} status={tx.status} />
                    </td>
                    <td className={cn('text-secondary', isCompact && 'text-sm-responsive')}>{tx.clientName || "-"}</td>
                    <td className={cn('text-secondary', isCompact && 'text-sm-responsive')}>{tx.projectName || "-"}</td>
                    <td className="amount-cell">
                      <AmountWithConversion
                        amountMinor={tx.amountMinor}
                        currency={tx.currency}
                        type={tx.kind === "income" ? "income" : "expense"}
                        showExpenseSign={tx.kind === "expense"}
                      />
                    </td>
                    {!isCompact && (
                      <td>
                        <TransactionStatusCell kind={tx.kind} status={tx.status} dueDate={tx.dueDate} />
                      </td>
                    )}
                    <td style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <RowActionsMenu
                        actions={[
                          ...(tx.kind === 'income' && tx.status === 'unpaid'
                            ? [
                                {
                                  label: t('common.markPaid'),
                                  icon: <CheckIcon size={16} />,
                                  onClick: () => markPaidMutation.mutate(tx.id),
                                },
                              ]
                            : []),
                          {
                            label: t('common.duplicate'),
                            icon: <CopyIcon size={16} />,
                            onClick: () => {
                              if (tx.kind === 'expense') {
                                // For expenses, we'd need a duplicate mechanism in ExpenseDrawer
                                // For now, just open a new expense drawer
                                openExpenseDrawer({ mode: 'create' });
                              } else {
                                openIncomeDrawer({ mode: 'create', duplicateFromId: tx.id });
                              }
                            },
                          },
                          // Generate Invoice (only for income transactions without linked document)
                          ...(tx.kind === 'income' && !tx.linkedDocumentId
                            ? [
                                {
                                  label: t('transactions.generateInvoice'),
                                  onClick: () =>
                                    openDocumentDrawer({
                                      mode: 'create',
                                      defaultType: tx.status === 'paid' ? 'receipt' : 'invoice',
                                      defaultClientId: tx.clientId,
                                    }),
                                },
                              ]
                            : []),
                          // View Invoice (if linked document exists)
                          ...(tx.linkedDocumentId
                            ? [
                                {
                                  label: t('transactions.viewInvoice'),
                                  onClick: () => {
                                    window.location.href = `/documents/${tx.linkedDocumentId}`;
                                  },
                                },
                              ]
                            : []),
                        ]}
                      />
                      {tx.linkedDocumentId && (
                        <span
                          className="doc-indicator"
                          title={t('transactions.hasDocument')}
                          onClick={(e) => {
                            e.stopPropagation();
                            window.location.href = `/documents/${tx.linkedDocumentId}`;
                          }}
                        >
                          <DocumentIcon size={14} />
                        </span>
                      )}
                      {tx.notes && (
                        <span
                          className="note-indicator"
                          title={t('drawer.transaction.notes')}
                        />
                      )}
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
