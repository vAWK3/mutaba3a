/**
 * /income's filters as one model mirrored to the URL (MUT-83).
 *
 * The URL carries only what differs from the page's defaults: a period (both
 * ends, YYYY-MM-DD), a status tab, a search and a client scope. With no
 * parameters the page shows what it always did -- this month, every status,
 * every client. Pure, so the router can validate with it without loading the
 * page.
 */

import { getDateRangePreset } from './utils';
import type { ClientScope } from '../types';

export type IncomeStatusFilter = 'all' | 'unpaid' | 'received' | 'overdue';

/** What the URL may say. Every field is optional: absent means the default. */
export interface IncomeSearch {
  dateFrom?: string;
  dateTo?: string;
  /** A status tab other than All */
  status?: Exclude<IncomeStatusFilter, 'all'>;
  /** The search box */
  q?: string;
  /** Only entries with no client, or only those of archived clients */
  client?: ClientScope;
}

/** The filters the page applies: the URL with every default filled in. */
export interface IncomeFiltersModel {
  dateFrom: string;
  dateTo: string;
  status: IncomeStatusFilter;
  q: string;
  client?: ClientScope;
}

const STATUSES: readonly IncomeSearch['status'][] = ['unpaid', 'received', 'overdue'];
const CLIENT_SCOPES: readonly ClientScope[] = ['none', 'archived'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_PERIOD = 'this-month';

const oneOf = <T extends string>(allowed: readonly (T | undefined)[], value: unknown): T | undefined =>
  allowed.includes(value as T) ? (value as T) : undefined;

const isoDate = (value: unknown): string | undefined =>
  typeof value === 'string' && ISO_DATE.test(value) ? value : undefined;

/** Drop every absent or empty field, so the URL holds only real filters. */
function compact(search: IncomeSearch): IncomeSearch {
  return Object.fromEntries(
    Object.entries(search).filter(([, value]) => value !== undefined && value !== '')
  ) as IncomeSearch;
}

/**
 * Read /income's URL. Anything unknown is dropped, so a hand-edited or stale
 * link never breaks the page. The router parses `?q=2026` as a number, so a
 * numeric search is read back as text.
 */
export function parseIncomeSearch(raw: Record<string, unknown>): IncomeSearch {
  const dateFrom = isoDate(raw.dateFrom);
  const dateTo = isoDate(raw.dateTo);
  const hasPeriod = Boolean(dateFrom && dateTo);
  const q = typeof raw.q === 'string' || typeof raw.q === 'number' ? String(raw.q) : undefined;

  return compact({
    dateFrom: hasPeriod ? dateFrom : undefined,
    dateTo: hasPeriod ? dateTo : undefined,
    status: oneOf(STATUSES, raw.status),
    q,
    client: oneOf(CLIENT_SCOPES, raw.client),
  });
}

/** Apply a change to the URL's filters; a field set to undefined or '' is removed. */
export function mergeIncomeSearch(prev: IncomeSearch, patch: Partial<IncomeSearch>): IncomeSearch {
  return compact({ ...prev, ...patch });
}

/** The filters to apply: the URL's, with this month, All, no search and every client by default. */
export function resolveIncomeFilters(search: IncomeSearch): IncomeFiltersModel {
  const period =
    search.dateFrom && search.dateTo
      ? { dateFrom: search.dateFrom, dateTo: search.dateTo }
      : getDateRangePreset(DEFAULT_PERIOD);
  return { ...period, status: search.status ?? 'all', q: search.q ?? '', client: search.client };
}

/**
 * Where a clients-index muted row leads (MUT-83): the unpaid entries of that
 * scope over all time, because Owed now is not a period figure.
 */
export function owedEntriesSearch(client: ClientScope): IncomeSearch {
  return { client, status: 'unpaid', ...getDateRangePreset('all') };
}
