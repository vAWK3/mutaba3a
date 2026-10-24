import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api, type Attachment, type Customer, type Payment, type Project, type Receivable } from '../api/client';
import { profileKey } from '../session/me';
import { DEFAULT_RECEIVABLE_STATUS, type DocumentFilters, type PaymentFilters, type ReceivableFilters } from './filters';

/**
 * The portal's query hooks (hosted-portal.md §7.3). Every key starts with
 * `['p', profileId]`, so figures never cross profiles and sign-out drops them
 * all. Nothing is persisted, and nothing is placed in the cache ahead of the
 * server (no `placeholderData`).
 */

const PAGE_LIMIT = 50;
const DIRECTORY_LIMIT = 200;
const STALE_MS = 30_000;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export async function everyPage<T>(load: (cursor: string | undefined) => Promise<Page<T>>): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await load(cursor);
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return items;
}

function byId<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

export function useOrganizationSummary(profileId: string) {
  return useQuery({
    queryKey: profileKey(profileId, 'summary', 'organization'),
    queryFn: () => api.organizationSummary(profileId),
    staleTime: STALE_MS,
  });
}

export function useCustomerSummary(profileId: string, customerId: string) {
  return useQuery({
    queryKey: profileKey(profileId, 'summary', 'customer', customerId),
    queryFn: () => api.customerSummary(profileId, customerId),
    staleTime: STALE_MS,
  });
}

export function useCustomer(profileId: string, customerId: string) {
  return useQuery({
    queryKey: profileKey(profileId, 'customer', customerId),
    queryFn: () => api.customer(profileId, customerId),
    staleTime: STALE_MS,
  });
}

/** Every client of the profile, by id: names for rows that carry only ids. */
export function useCustomerDirectory(profileId: string) {
  return useQuery({
    queryKey: profileKey(profileId, 'directory', 'customers'),
    queryFn: () => everyPage((cursor) => api.customers(profileId, { limit: DIRECTORY_LIMIT, cursor })),
    select: byId<Customer>,
    staleTime: STALE_MS,
  });
}

/** Every matter of the profile (or of one client), by id. */
export function useProjectDirectory(profileId: string, customerId?: string) {
  return useQuery({
    queryKey: profileKey(profileId, 'directory', 'projects', customerId ?? 'all'),
    queryFn: () => everyPage((cursor) => api.projects(profileId, { limit: DIRECTORY_LIMIT, cursor, customerId })),
    select: byId<Project>,
    staleTime: STALE_MS,
  });
}

/** Exported for reuse by src/hosted/hooks/useExpenseQueries.ts (MUT-44) — the shape is generic, not read-only-specific. */
export function useCursorList<T>(key: readonly unknown[], load: (cursor: string | undefined) => Promise<Page<T>>) {
  return useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => load(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    select: (data) => data.pages.flatMap((page) => page.items),
    staleTime: STALE_MS,
  });
}

export function useReceivables(profileId: string, filters: ReceivableFilters) {
  const status = filters.status ?? DEFAULT_RECEIVABLE_STATUS;
  return useCursorList<Receivable>(profileKey(profileId, 'receivables', filters), (cursor) =>
    api.receivables(profileId, {
      limit: PAGE_LIMIT,
      cursor,
      customerId: filters.customerId,
      projectId: filters.projectId,
      currency: filters.currency,
      status: status === 'ALL' ? undefined : status,
      dueAfter: filters.dueFrom,
      dueBefore: filters.dueTo,
    }),
  );
}

export function usePayments(profileId: string, filters: PaymentFilters) {
  return useCursorList<Payment>(profileKey(profileId, 'payments', filters), (cursor) =>
    api.payments(profileId, {
      limit: PAGE_LIMIT,
      cursor,
      customerId: filters.customerId,
      status: filters.status === 'ALL' ? undefined : filters.status,
      receivedAfter: filters.receivedFrom,
      receivedBefore: filters.receivedTo,
    }),
  );
}

export function useAttachments(profileId: string, filters: DocumentFilters) {
  return useCursorList<Attachment>(profileKey(profileId, 'attachments', filters), (cursor) =>
    api.attachments(profileId, { limit: PAGE_LIMIT, cursor, customerId: filters.customerId, kind: filters.kind }),
  );
}
