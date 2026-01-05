import { useState, useMemo } from "react";
import { TopBar } from "../../components/layout";
import {
  SearchInput,
  CurrencyTabs,
  StatusSegment,
  TypeSegment,
  DateRangeControl,
} from "../../components/filters";
import { EmptyState } from "../../components/ui";
import { CheckIcon } from "../../components/icons";
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

export function TransactionsPage() {
  const { openTransactionDrawer } = useDrawerStore();
  const markPaidMutation = useMarkTransactionPaid();
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);

  // Filters state
  const [dateRange, setDateRange] = useState(() =>
    getDateRangePreset("this-month")
  );
  const [currency, setCurrency] = useState<Currency | undefined>(undefined);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>(undefined);
  const [statusFilter, setStatusFilter] = useState<
    TxStatus | "overdue" | undefined
  >(undefined);
  const [search, setSearch] = useState("");

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

  const handleMarkPaid = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await markPaidMutation.mutateAsync(id);
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
                    <td>
                      {tx.kind === 'income' && tx.status === 'unpaid' && (
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={(e) => handleMarkPaid(e, tx.id)}
                          title={t('common.markPaid')}
                        >
                          <CheckIcon />
                        </button>
                      )}
                      {tx.notes && (
                        <span
                          className="note-indicator"
                          title={t('drawer.transaction.notes')}
                          style={{ marginInlineStart: 8 }}
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
