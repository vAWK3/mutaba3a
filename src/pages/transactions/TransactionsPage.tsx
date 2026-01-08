import { useState, useMemo, useEffect } from "react";
import { useSearch, Link } from "@tanstack/react-router";
import { TopBar } from "../../components/layout";
import {
  SearchInput,
  CurrencyTabs,
  StatusSegment,
  TypeSegment,
  DateRangeControl,
} from "../../components/filters";
import { EmptyState, RowActionsMenu } from "../../components/ui";
import { CheckIcon, CopyIcon } from "../../components/icons";
import { TransactionTypeBadge, TransactionStatusCell } from "../../components/transactions";
import {
  useTransactions,
  useMarkTransactionPaid,
} from "../../hooks/useQueries";
import { useDrawerStore } from "../../lib/stores";
import {
  formatAmount,
  formatDate,
  getDateRangePreset,
  cn,
} from "../../lib/utils";
import { useT, useLanguage, getLocale } from "../../lib/i18n";
import type { Currency, TxKind, TxStatus, QueryFilters } from "../../types";

type TypeFilter = TxKind | "receivable" | undefined;

interface TransactionsSearchParams {
  dateFrom?: string;
  dateTo?: string;
  currency?: Currency;
  kind?: TxKind;
  status?: TxStatus | 'overdue';
}

export function TransactionsPage() {
  const { openTransactionDrawer, openDocumentDrawer } = useDrawerStore();
  const markPaidMutation = useMarkTransactionPaid();
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
  const [currency, setCurrency] = useState<Currency | undefined>(searchParams.currency);

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
    if (!initialParamsApplied && (searchParams.dateFrom || searchParams.currency || searchParams.kind)) {
      setInitialParamsApplied(true);
    }
  }, [initialParamsApplied, searchParams]);

  // Build query filters
  const queryFilters = useMemo((): QueryFilters => {
    const filters: QueryFilters = {
      dateFrom: dateRange.dateFrom,
      dateTo: dateRange.dateTo,
      currency,
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
  }, [dateRange, currency, typeFilter, statusFilter, search]);

  const { data: transactions = [], isLoading } = useTransactions(queryFilters);

  const handleRowClick = (id: string) => {
    openTransactionDrawer({ mode: "edit", transactionId: id });
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
            <CurrencyTabs value={currency} onChange={setCurrency} />
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
              onClick: () => openTransactionDrawer({ mode: "create" }),
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
                  <th>{t('transactions.columns.category')}</th>
                  <th style={{ textAlign: "end" }}>{t('transactions.columns.amount')}</th>
                  <th>{t('transactions.columns.status')}</th>
                  <th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr
                    key={tx.id}
                    className="clickable"
                    onClick={() => handleRowClick(tx.id)}
                  >
                    <td>{formatDate(tx.occurredAt, locale)}</td>
                    <td>
                      <TransactionTypeBadge kind={tx.kind} status={tx.status} />
                    </td>
                    <td className="text-secondary">{tx.clientName || "-"}</td>
                    <td className="text-secondary">{tx.projectName || "-"}</td>
                    <td className="text-secondary">{tx.categoryName || "-"}</td>
                    <td
                      className={cn(
                        "amount-cell",
                        tx.kind === "income" && "amount-positive",
                        tx.kind === "expense" && "amount-negative"
                      )}
                    >
                      {tx.kind === "expense" ? "-" : ""}
                      {formatAmount(tx.amountMinor, tx.currency, locale)}
                    </td>
                    <td>
                      <TransactionStatusCell kind={tx.kind} status={tx.status} dueDate={tx.dueDate} />
                    </td>
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
                            onClick: () =>
                              openTransactionDrawer({ mode: 'create', duplicateFromId: tx.id }),
                          },
                          // Generate Invoice (only for income transactions without linked document)
                          ...(tx.kind === 'income' && !tx.linkedDocumentId
                            ? [
                                {
                                  label: 'Generate Invoice',
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
                                  label: 'View Invoice',
                                  onClick: () => {
                                    window.location.href = `/documents/${tx.linkedDocumentId}`;
                                  },
                                },
                              ]
                            : []),
                        ]}
                      />
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
