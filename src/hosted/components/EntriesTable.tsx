/* eslint-disable react-refresh/only-export-components */
import { useMemo } from 'react';
import { useLanguage } from '../../lib/i18n/core';
import { useTp } from '../../lib/i18n/plural';
import type { Currency, ShareLinkEntry } from '../api/client';
import { DecimalAmount } from '../format/DecimalAmount';
import { moneyDay, type DeskEntry } from '../pages/client-books/clientBooksRules';
import { HostedTable, type Column } from './HostedTable';

/**
 * MUT-562 (D10): one table for a client's entries on the Client books desk and on a share link's page. The two read
 * different routes (the profile feed with ids; the link feed with names), so each is shaped into the same row first.
 * Amounts are signed (an expense goes out, a received payment comes in) and keep their currency (ADR-004). Read-only:
 * a row opens its receipts, nothing else.
 */

export interface EntryRow {
  key: string;
  kind: 'expense' | 'income';
  /** The money date, `YYYY-MM-DD`. */
  date: string;
  what: string | null;
  category: string | null;
  /** Ready receipts; null for income (none can be attached). */
  receiptCount: number | null;
  /** Signed decimal string. */
  amount: string;
  currency: Currency;
  /** The expense id (desk) or the entry key (link page) the receipt pane opens with. */
  receiptRef: string | null;
}

const negate = (amount: string) => (amount.startsWith('-') ? amount.slice(1) : `-${amount}`);

/** A desk feed row; categories by id (archived ones too). */
export function deskRow(entry: DeskEntry, categories: ReadonlyMap<string, string> | undefined): EntryRow {
  if (entry.kind === 'expense') {
    const { expense } = entry;
    return {
      key: `e:${expense.id}`,
      kind: 'expense',
      date: expense.occurredOn,
      what: expense.title ?? expense.vendor ?? null,
      category: expense.categoryId ? (categories?.get(expense.categoryId) ?? null) : null,
      receiptCount: expense.receiptCount,
      amount: negate(expense.amount),
      currency: expense.currency,
      receiptRef: expense.id,
    };
  }
  const { income } = entry;
  return { key: `r:${income.id}`, kind: 'income', date: income.occurredOn, what: income.title ?? null, category: null, receiptCount: null, amount: income.amount, currency: income.currency, receiptRef: null };
}

/** A share link's row: names already, an opaque key instead of an id. */
export function linkRow(entry: ShareLinkEntry): EntryRow {
  if (entry.kind === 'expense') {
    const { expense } = entry;
    return {
      key: `e:${expense.key}`,
      kind: 'expense',
      date: expense.occurredOn,
      what: expense.title ?? expense.vendor ?? null,
      category: expense.category,
      receiptCount: expense.receiptCount,
      amount: negate(expense.amount),
      currency: expense.currency,
      receiptRef: expense.key,
    };
  }
  const { income } = entry;
  return { key: `r:${income.key}`, kind: 'income', date: income.occurredOn, what: income.title ?? income.client ?? null, category: null, receiptCount: null, amount: income.amount, currency: income.currency, receiptRef: null };
}

interface EntriesTableProps {
  rows: EntryRow[];
  label: string;
  /** Opens a row's receipts; rows without one don't open. */
  onOpenReceipt?: (row: EntryRow) => void;
  /** The open row, marked in the table while its pane shows. */
  openKey?: string | null;
}

export function EntriesTable({ rows, label, onOpenReceipt, openKey = null }: EntriesTableProps) {
  const { t, language } = useLanguage();
  const tp = useTp();
  const columns = useMemo<Column<EntryRow>[]>(
    () => [
      { key: 'date', header: t('hosted.clientBooks.table.date'), cell: (row) => <span className="hp-nowrap">{moneyDay(row.date, language)}</span> },
      {
        key: 'what',
        header: t('hosted.clientBooks.table.what'),
        cell: (row) => <bdi dir="auto">{row.what ?? t(row.kind === 'expense' ? 'hosted.clientBooks.table.untitled' : 'hosted.clientBooks.table.receivedFrom')}</bdi>,
      },
      {
        key: 'category',
        header: t('hosted.clientBooks.table.category'),
        cell: (row) => (row.kind === 'income' ? t('hosted.clientBooks.table.income') : <bdi dir="auto">{row.category ?? '—'}</bdi>),
      },
      {
        key: 'receipt',
        header: t('hosted.clientBooks.table.receipt'),
        cell: (row) => (row.receiptCount ? tp('hosted.clientBooks.table.receipts', row.receiptCount) : t('hosted.clientBooks.table.noReceipt')),
      },
      { key: 'amount', header: t('hosted.clientBooks.table.amount'), numeric: true, cell: (row) => <DecimalAmount value={row.amount} currency={row.currency} /> },
    ],
    [t, tp, language],
  );
  return (
    <HostedTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.key}
      label={label}
      linkColumn="what"
      onRowClick={onOpenReceipt}
      canOpen={(row) => (row.receiptCount ?? 0) > 0}
      rowClassName={(row) => (row.key === openKey ? 'hp-row-open' : undefined)}
    />
  );
}
