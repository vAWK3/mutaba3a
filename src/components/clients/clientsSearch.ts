/**
 * The Clients list's search and sort as one model mirrored to the URL
 * (MUT-84), on `/clients` and `/clients/:id` alike, so they survive opening
 * one client after another beside the list, Back and a reload.
 *
 * The URL carries only what differs from the defaults: owed now, descending,
 * no search. The parameter names are the ones the list used before (`sort`,
 * `dir`), so older links keep their order. Pure, so the router can validate
 * with it without loading the page.
 */

import { CLIENT_SORT_FIELDS, type ClientSortField } from './clientIndexRows';
import type { SortDir } from '../../hooks/useSortState';

/** What the URL may say. Every field is optional: absent means the default. */
export interface ClientsSearch {
  /** The search box */
  q?: string;
  /** A sort column other than owed now */
  sort?: ClientSortField;
  /** Ascending; descending is the default */
  dir?: SortDir;
}

/** The list's state: the URL with every default filled in. */
export interface ClientsListState {
  q: string;
  sort: ClientSortField;
  dir: SortDir;
}

export const DEFAULT_CLIENTS_LIST: ClientsListState = { q: '', sort: 'owed', dir: 'desc' };

const DIRECTIONS: readonly SortDir[] = ['asc', 'desc'];

const oneOf = <T extends string>(allowed: readonly T[], value: unknown): T | undefined =>
  allowed.includes(value as T) ? (value as T) : undefined;

/** Drop every absent or empty field, and with `defaults` every field that says the default. */
function compact(search: ClientsSearch, { defaults }: { defaults: boolean }): ClientsSearch {
  const isDefault = (key: string, value: unknown) => defaults && value === DEFAULT_CLIENTS_LIST[key as keyof ClientsListState];
  return Object.fromEntries(
    Object.entries(search).filter(([key, value]) => value !== undefined && value !== '' && !isDefault(key, value))
  ) as ClientsSearch;
}

/**
 * Read the list's URL. Anything unknown is dropped, so a hand-edited or stale
 * link never breaks the page. The router parses `?q=2026` as a number, so a
 * numeric search is read back as text.
 */
export function parseClientsSearch(raw: Record<string, unknown>): ClientsSearch {
  const q = typeof raw.q === 'string' || typeof raw.q === 'number' ? String(raw.q) : undefined;
  return compact({ q, sort: oneOf(CLIENT_SORT_FIELDS, raw.sort), dir: oneOf(DIRECTIONS, raw.dir) }, { defaults: false });
}

/** Apply a change to the list's URL; a cleared search or a default is removed, so only real choices are written. */
export function mergeClientsSearch(prev: ClientsSearch, patch: Partial<ClientsListState>): ClientsSearch {
  return compact({ ...prev, ...patch }, { defaults: true });
}

/** The state to show: the URL's, with owed now, descending and no search by default. */
export function resolveClientsSearch(search: ClientsSearch): ClientsListState {
  return { ...DEFAULT_CLIENTS_LIST, ...search };
}
