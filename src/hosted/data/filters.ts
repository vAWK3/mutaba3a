import type { Currency } from '../api/client';
import { HOSTED_CURRENCIES } from '../format/currencies';
import { PERIODS, type Period } from './reports';

/**
 * One filters object per list view, kept in the URL's search params and updated
 * with `replace` (house rule: no history entry per keystroke, no rerender
 * storms). Each `parse*` turns whatever is in the URL into a valid model,
 * dropping values the server would refuse.
 */

type Raw = Record<string, unknown>;

/** The wire currencies a list can filter by -- derives from HOSTED_CURRENCIES (MUT-281) instead of its own copy. */
const CURRENCIES = HOSTED_CURRENCIES;
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

/**
 * Reports (MUT-175): the period, any day inside it, and the All-profiles switch
 * (DS4: off by default, so only `all` is ever written). A Year asked for before
 * stage 3 falls back to Month on the page, which knows the stage (DR27).
 */
export interface ReportsSearch {
  period?: Period;
  at?: string;
  scope?: 'all';
}
export const parseReports = (raw: Raw): ReportsSearch => compact({ period: oneOf(raw.period, PERIODS), at: day(raw.at), scope: raw.scope === 'all' ? ('all' as const) : undefined });

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

/** The conversions drawer's own URL state: `?conversion=<id>` to edit (MUT-194), `?newConversion=1` to create. */
export interface ConversionDrawerSearch {
  conversion?: string;
  newConversion?: true;
}
export const parseConversionDrawer = (raw: Raw): ConversionDrawerSearch =>
  compact({ conversion: id(raw.conversion), newConversion: raw.newConversion === '1' || raw.newConversion === true ? true : undefined });

/** The /conversions route's full search: the list's own filters plus the drawer's open state. */
export type ConversionsPageSearch = ConversionFilters & ConversionDrawerSearch;
export const parseConversionsPage = (raw: Raw): ConversionsPageSearch => ({ ...parseConversions(raw), ...parseConversionDrawer(raw) });

/** Expenses › Groups (MUT-268, 1A): `?newGroup=1` opens New group. */
export interface GroupsPageSearch {
  newGroup?: true;
}
// TanStack parses `?newGroup=1` to the number 1
const one = (value: unknown): true | undefined => (value === '1' || value === 1 || value === true ? true : undefined);
export const parseGroupsPage = (raw: Raw): GroupsPageSearch => compact({ newGroup: one(raw.newGroup) });

/**
 * One group's page: the currency tab (5A), the category filter (13A; `none` is
 * Uncategorized, 23A) and its drawers, `?editGroup=1` and `?addToGroup=1`.
 */
export interface GroupDetailSearch {
  currency?: Currency;
  category?: string;
  editGroup?: true;
  addToGroup?: true;
}
export const parseGroupDetail = (raw: Raw): GroupDetailSearch =>
  compact({
    currency: oneOf(raw.currency, CURRENCIES),
    category: raw.category === 'none' ? 'none' : id(raw.category),
    editGroup: one(raw.editGroup),
    addToGroup: one(raw.addToGroup),
  });

export const INCOME_KINDS = ['received', 'owed'] as const;

/**
 * The income drawers' own URL state (MUT-133): `?newIncome=received|owed` opens
 * Add income, `?settle=<receivableId>` opens Record payment. MUT-224 adds the
 * re-date drawers: `?income=<receivableId>` (an Owed entry) and
 * `?payment=<paymentId>` (a payment the person recorded). Pages own it,
 * beside (never inside) a list's filters, so it can never enter a list's query
 * key (eng review R1). Ignored where the gate offers no income writes.
 */
export interface IncomeDrawerSearch {
  newIncome?: (typeof INCOME_KINDS)[number];
  settle?: string;
  income?: string;
  payment?: string;
}
export const parseIncomeDrawer = (raw: Raw): IncomeDrawerSearch =>
  compact({ newIncome: oneOf(raw.newIncome, INCOME_KINDS), settle: id(raw.settle), income: id(raw.income), payment: id(raw.payment) });

export type ReceivablesPageSearch = ReceivableFilters & IncomeDrawerSearch;
export const parseReceivablesPage = (raw: Raw): ReceivablesPageSearch => ({ ...parseReceivables(raw), ...parseIncomeDrawer(raw) });

export type PaymentsPageSearch = PaymentFilters & IncomeDrawerSearch;
export const parsePaymentsPage = (raw: Raw): PaymentsPageSearch => ({ ...parsePayments(raw), ...parseIncomeDrawer(raw) });

/** Splits a page's search into the list's filters and the drawer state, so the list never sees the latter. */
export function splitIncomeDrawer<T extends IncomeDrawerSearch>(search: T): { filters: Omit<T, keyof IncomeDrawerSearch>; drawer: IncomeDrawerSearch } {
  const { newIncome, settle, income, payment, ...filters } = search;
  return { filters, drawer: compact({ newIncome, settle, income, payment }) };
}

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
  } & IncomeDrawerSearch;
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
    ...parseIncomeDrawer(raw),
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

/**
 * The profile drawers' URL state (MUT-183, ADR-008): `?newProfile=true` opens
 * New profile, `?manageProfiles=true` the Manage list, `?editProfile=<id>` one
 * profile's edit pane. The shell owns them, on every page. TanStack carries
 * every raw key into each route's search, and pages feed theirs whole into
 * list query keys and `isNarrowed`, so the router strips these at the page
 * boundary with `omitShellOverlay` (the MUT-44 e0ed4fd lesson, shell-wide).
 */
export interface ProfileDrawerSearch {
  newProfile?: true;
  manageProfiles?: true;
  editProfile?: string;
  /** MUT-237: the account menu's Change password drawer. Named here, not a separate registry, because this is the
   * shell's one shared overlay-key set — every page's `useReplaceSearch` (via `pickShellOverlay`) must carry it
   * forward across a filter change the same way it already does for the profile drawers. */
  changePassword?: true;
  /** MUT-286: the account menu's Your data drawer (signed out only), carried the same way as Change password. */
  yourData?: true;
  /** MUT-362: the account menu's Billing drawer (signed in only); Stripe's return URLs open it too. */
  billing?: true;
  /**
   * MUT-362 DR2: the Subscribe step inside the Billing drawer, deep-linkable (MUT-361's locked screen opens it).
   * MUT-418: `welcome`, the first-run "Your 14-day free trial has started" step.
   */
  step?: 'subscribe' | 'welcome';
  /** MUT-362: how the person came back from Stripe Checkout (its success_url / cancel_url). */
  checkout?: 'success' | 'cancelled';
  /** MUT-362: back from Stripe's Customer Portal (its return_url), where a change may not be mirrored yet. */
  portal?: 'returned';
}
export const SHELL_OVERLAY_KEYS = ['newProfile', 'manageProfiles', 'editProfile', 'changePassword', 'yourData', 'billing', 'step', 'checkout', 'portal'] as const;

const flag = (value: unknown): true | undefined => (value === true || value === 'true' || value === 1 || value === '1' ? true : undefined);

export const parseProfileDrawer = (raw: Raw): ProfileDrawerSearch =>
  compact({
    newProfile: flag(raw.newProfile),
    manageProfiles: flag(raw.manageProfiles),
    editProfile: id(raw.editProfile),
    changePassword: flag(raw.changePassword),
    yourData: flag(raw.yourData),
    billing: flag(raw.billing),
    step: raw.step === 'subscribe' || raw.step === 'welcome' ? raw.step : undefined,
    checkout: raw.checkout === 'success' || raw.checkout === 'cancelled' ? raw.checkout : undefined,
    portal: raw.portal === 'returned' ? 'returned' : undefined,
  });

/** A page's search without the shell's keys, so no list ever sees them. */
export function omitShellOverlay<T extends object>(search: T): T {
  const rest = { ...search } as Raw;
  for (const key of SHELL_OVERLAY_KEYS) delete rest[key];
  return rest as T;
}

/** The shell's own keys out of a raw search, so a page rewrite can carry them forward untouched. */
export function pickShellOverlay(search: Raw): Partial<ProfileDrawerSearch> {
  const picked: Raw = {};
  for (const key of SHELL_OVERLAY_KEYS) if (search[key] !== undefined) picked[key] = search[key];
  return picked as Partial<ProfileDrawerSearch>;
}
