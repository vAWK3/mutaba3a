import type { Currency } from '../api/client';

/**
 * One filters object per list view, kept in the URL's search params and updated
 * with `replace` (house rule: no history entry per keystroke, no rerender
 * storms). Each `parse*` turns whatever is in the URL into a valid model,
 * dropping values the server would refuse.
 */

type Raw = Record<string, unknown>;

const CURRENCIES = ['ILS', 'USD', 'EUR'] as const;
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number') return String(value);
  return undefined;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

function id(value: unknown): string | undefined {
  const v = text(value);
  return v && UUID.test(v) ? v : undefined;
}

function day(value: unknown): string | undefined {
  const v = text(value);
  return v && CALENDAR_DATE.test(v) ? v : undefined;
}

function compact<T extends object>(model: T): T {
  return Object.fromEntries(Object.entries(model).filter(([, v]) => v !== undefined)) as T;
}

export interface OverviewFilters {
  currency?: Currency;
}
export const parseOverview = (raw: Raw): OverviewFilters => compact({ currency: oneOf(raw.currency, CURRENCIES) });

export interface ClientsFilters {
  q?: string;
}
export const parseClients = (raw: Raw): ClientsFilters => compact({ q: text(raw.q) });

export const RECEIVABLE_STATUSES = ['OPEN', 'SETTLED', 'ALL'] as const;
export type ReceivableStatusFilter = (typeof RECEIVABLE_STATUSES)[number];
export const DEFAULT_RECEIVABLE_STATUS: ReceivableStatusFilter = 'OPEN';

export interface ReceivableFilters {
  customerId?: string;
  projectId?: string;
  currency?: Currency;
  status?: ReceivableStatusFilter;
  dueFrom?: string;
  dueTo?: string;
}
export const parseReceivables = (raw: Raw): ReceivableFilters =>
  compact({
    customerId: id(raw.customerId),
    projectId: id(raw.projectId),
    currency: oneOf(raw.currency, CURRENCIES),
    status: oneOf(raw.status, RECEIVABLE_STATUSES),
    dueFrom: day(raw.dueFrom),
    dueTo: day(raw.dueTo),
  });

export const PAYMENT_STATUSES = ['ALL', 'POSTED', 'REVERSED'] as const;
export type PaymentStatusFilter = (typeof PAYMENT_STATUSES)[number];

export interface PaymentFilters {
  customerId?: string;
  status?: PaymentStatusFilter;
  receivedFrom?: string;
  receivedTo?: string;
}
export const parsePayments = (raw: Raw): PaymentFilters =>
  compact({
    customerId: id(raw.customerId),
    status: oneOf(raw.status, PAYMENT_STATUSES),
    receivedFrom: day(raw.receivedFrom),
    receivedTo: day(raw.receivedTo),
  });

export interface ExpenseFilters {
  customerId?: string;
  categoryId?: string;
  currency?: Currency;
  from?: string;
  to?: string;
  /** Start the list at this expense (MUT-91): set by Show after a save the list didn't show. */
  anchor?: string;
}
export const parseExpenses = (raw: Raw): ExpenseFilters =>
  compact({
    customerId: id(raw.customerId),
    categoryId: id(raw.categoryId),
    currency: oneOf(raw.currency, CURRENCIES),
    from: day(raw.from),
    to: day(raw.to),
    anchor: id(raw.anchor),
  });

/** The expense drawer's own URL state: `?expense=<id>` to edit, `?newExpense=1` to create. */
export interface ExpenseDrawerSearch {
  expense?: string;
  newExpense?: true;
}
export const parseExpenseDrawer = (raw: Raw): ExpenseDrawerSearch =>
  compact({ expense: id(raw.expense), newExpense: raw.newExpense === '1' || raw.newExpense === true ? true : undefined });

/** The /expenses route's full search: the list's own filters plus the drawer's open/edit state. */
export type ExpensesPageSearch = ExpenseFilters & ExpenseDrawerSearch;
export const parseExpensesPage = (raw: Raw): ExpensesPageSearch => ({ ...parseExpenses(raw), ...parseExpenseDrawer(raw) });

export interface ConversionFilters {
  currency?: Currency;
  from?: string;
  to?: string;
  /** Start the list at this conversion (MUT-91): set by Show after a save the list didn't show. */
  anchor?: string;
}
export const parseConversions = (raw: Raw): ConversionFilters =>
  compact({
    currency: oneOf(raw.currency, CURRENCIES),
    from: day(raw.from),
    to: day(raw.to),
    anchor: id(raw.anchor),
  });

/** The conversions drawer's own URL state: `?newConversion=1` to create. Create-only (MUT-161) — no `?conversion=<id>` to edit. */
export interface ConversionDrawerSearch {
  newConversion?: true;
}
export const parseConversionDrawer = (raw: Raw): ConversionDrawerSearch =>
  compact({ newConversion: raw.newConversion === '1' || raw.newConversion === true ? true : undefined });

/** The /conversions route's full search: the list's own filters plus the drawer's open state. */
export type ConversionsPageSearch = ConversionFilters & ConversionDrawerSearch;
export const parseConversionsPage = (raw: Raw): ConversionsPageSearch => ({ ...parseConversions(raw), ...parseConversionDrawer(raw) });

export const DOCUMENT_KINDS = ['INVOICE', 'RECEIPT', 'OTHER'] as const;

export interface DocumentFilters {
  customerId?: string;
  kind?: (typeof DOCUMENT_KINDS)[number];
}
export const parseDocuments = (raw: Raw): DocumentFilters => compact({ customerId: id(raw.customerId), kind: oneOf(raw.kind, DOCUMENT_KINDS) });

export const CLIENT_TABS = ['summary', 'receivables', 'payments', 'documents'] as const;
export type ClientTab = (typeof CLIENT_TABS)[number];

/** Client detail: the tab, plus the filters of whichever list it shows (the client itself is fixed). */
export type ClientDetailSearch = { tab?: ClientTab } & Omit<ReceivableFilters, 'customerId'> & Omit<PaymentFilters, 'customerId' | 'status'> & {
    paymentStatus?: PaymentStatusFilter;
    kind?: DocumentFilters['kind'];
  };
export const parseClientDetail = (raw: Raw): ClientDetailSearch =>
  compact({
    tab: oneOf(raw.tab, CLIENT_TABS),
    projectId: id(raw.projectId),
    currency: oneOf(raw.currency, CURRENCIES),
    status: oneOf(raw.status, RECEIVABLE_STATUSES),
    dueFrom: day(raw.dueFrom),
    dueTo: day(raw.dueTo),
    receivedFrom: day(raw.receivedFrom),
    receivedTo: day(raw.receivedTo),
    paymentStatus: oneOf(raw.paymentStatus, PAYMENT_STATUSES),
    kind: oneOf(raw.kind, DOCUMENT_KINDS),
  });

/** Whether any filter narrows the list (so an empty result means "nothing matches", not "nothing yet"). */
export function isNarrowed(filters: object, defaults: object = {}): boolean {
  return Object.entries(filters).some(([key, value]) => value !== undefined && (defaults as Raw)[key] !== value);
}

/**
 * The server's answer when a list's `anchor` names a record that is gone
 * (deleted, another profile's, a stale bookmark): a 404 with this reason, so it
 * is never mistaken for a removed profile. The list drops the anchor (MUT-91).
 */
export function isStaleAnchor(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('status' in error) || (error as { status: unknown }).status !== 404) return false;
  const details = (error as { details?: unknown }).details;
  return Boolean(details && typeof details === 'object' && (details as { reason?: unknown }).reason === 'ANCHOR_NOT_FOUND');
}
