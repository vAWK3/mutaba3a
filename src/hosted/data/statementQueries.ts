import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api, type Currency, type CustomerStatement, type StatementLine } from '../api/client';
import { todayLocalISO } from '../format/dates';
import { profileKey } from '../session/me';
import type { LedgerPeriod } from './filters';

/**
 * MUT-664: the client's ledger card, newest first (D14), 50 lines a page; "Show earlier" is the next page. Keyed
 * under 'summary', so every money and issuing write that refreshes the summaries refreshes the card too.
 */
export const LEDGER_PAGE = 50;

/** A period's first and last day, from today (the browser's calendar day). */
export function periodRange(period: LedgerPeriod, today: string = todayLocalISO()): { from?: string; to?: string } {
  const [y, m] = today.split('-').map(Number) as [number, number];
  const first = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}-01`;
  if (period === 'month') return { from: first(y, m), to: today };
  if (period === 'quarter') {
    const back = m - 2;
    return { from: back >= 1 ? first(y, back) : first(y - 1, back + 12), to: today };
  }
  if (period === 'year') return { from: first(y, 1), to: today };
  return {};
}

export interface LedgerData {
  head: Omit<CustomerStatement, 'lines' | 'nextCursor'>;
  lines: StatementLine[];
}

/** MUT-774: one client's balances, per currency (never summed), as the clients list shows them. */
export type ClientBalances = Map<string, { currency: Currency; balance: string }[]>;

/**
 * MUT-774: GET /v1/customer-balances, grouped by client. Under the profile's `summary` scope, so every save that moves
 * the ledger card or Owed refreshes it too: the list always matches them.
 */
export function useCustomerBalances(profileId: string) {
  return useQuery({
    queryKey: profileKey(profileId, 'summary', 'balances'),
    queryFn: ({ signal }) => api.customerBalances(profileId, signal),
    select: (data): ClientBalances => {
      const byClient: ClientBalances = new Map();
      for (const b of data.balances) byClient.set(b.customerId, [...(byClient.get(b.customerId) ?? []), { currency: b.currency, balance: b.balance }]);
      for (const list of byClient.values()) list.sort((a, b) => a.currency.localeCompare(b.currency));
      return byClient;
    },
  });
}

export function useCustomerStatement(profileId: string, customerId: string, currency: string | undefined, period: LedgerPeriod) {
  const range = periodRange(period);
  return useInfiniteQuery({
    queryKey: profileKey(profileId, 'summary', 'statement', customerId, currency ?? '', period),
    queryFn: ({ pageParam, signal }) =>
      api.customerStatement(profileId, customerId, { currency: currency as CustomerStatement['currency'], order: 'desc', limit: LEDGER_PAGE, ...range, ...(pageParam ? { cursor: pageParam } : {}) }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    select: (data): LedgerData => {
      const first = data.pages[0]!;
      const head = { customerId: first.customerId, currency: first.currency, projectId: first.projectId, from: first.from, to: first.to, asOf: first.asOf, openingBalance: first.openingBalance, totals: first.totals, closingBalance: first.closingBalance };
      return { head, lines: data.pages.flatMap((p) => p.lines) };
    },
    enabled: !!currency,
    staleTime: 30_000,
  });
}
