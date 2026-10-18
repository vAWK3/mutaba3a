import { useCallback, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api, type CreateExpenseGroupRequest, type Currency, type Expense, type ExpenseGroupSummary, type UpdateExpenseGroupRequest } from '../api/client';
import { profileKey } from '../session/me';
import { VERB_MARK, applyMarks, applyRowMarks, runSequential, sortOldestFirst, type PendingMark, type SeenReads, type Verb } from './expenseGroups';

/**
 * Expense-group reads and writes (MUT-268, eng plan E1/E2/E5, review R1–R3).
 * Every group read sits under one key root, so a single invalidation is the
 * whole refetch set of 8A (summary, members, left out, group list, "in groups").
 */

const STALE_MS = 30_000;
const FX_STALE_MS = 60 * 60_000;
/** The ledger's page maximum: members load every page (4A), bounded by the window plus keep marks. */
const ALL_PAGES_LIMIT = 200;

export const GROUPS_ROOT = 'expense-groups';
export const groupsKey = (profileId: string, ...rest: unknown[]) => profileKey(profileId, GROUPS_ROOT, ...rest);
const groupKey = (profileId: string, groupId: string, ...rest: unknown[]) => groupsKey(profileId, 'group', groupId, ...rest);
export const fxRatesKey = (profileId: string, base: Currency) => profileKey(profileId, 'fx-rates', base);

export function invalidateGroups(queryClient: QueryClient, profileId: string) {
  return queryClient.invalidateQueries({ queryKey: groupsKey(profileId) });
}

/** After a delete, once the page has left the group: drop its reads (no 404 flash, eng R8) and refresh the list. */
export function forgetGroup(queryClient: QueryClient, profileId: string, groupId: string) {
  queryClient.removeQueries({ queryKey: groupKey(profileId, groupId) });
  return invalidateGroups(queryClient, profileId);
}

type LedgerQuery = { groupId?: string; groupMembership?: 'member' | 'excluded'; from?: string; to?: string };

/** Every page of a ledger query, oldest first (members are listed oldest first, 4A). */
export async function loadAllExpenses(profileId: string, query: LedgerQuery, signal?: AbortSignal): Promise<Expense[]> {
  const items: Expense[] = [];
  let cursor: string | undefined;
  do {
    const page = await api.expenses(profileId, { ...query, limit: ALL_PAGES_LIMIT, cursor }, signal);
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return sortOldestFirst(items);
}

/** The profile's groups, or (with `expenseId`) only the ones that expense is in. */
export function useExpenseGroups(profileId: string, expenseId?: string, enabled = true) {
  return useQuery({
    queryKey: groupsKey(profileId, 'list', expenseId ?? 'all'),
    queryFn: () => api.expenseGroups(profileId, expenseId ? { expenseId } : {}),
    select: (data) => data.items,
    staleTime: STALE_MS,
    enabled,
  });
}

export function useExpenseGroup(profileId: string, groupId: string) {
  return useQuery({ queryKey: groupKey(profileId, groupId), queryFn: () => api.expenseGroup(profileId, groupId), staleTime: STALE_MS });
}

export function useGroupSummary(profileId: string, groupId: string) {
  return useQuery({ queryKey: groupKey(profileId, groupId, 'summary'), queryFn: () => api.expenseGroupSummary(profileId, groupId), staleTime: STALE_MS });
}

export function useGroupRows(profileId: string, groupId: string, groupMembership: 'member' | 'excluded') {
  return useQuery({
    queryKey: groupKey(profileId, groupId, groupMembership),
    queryFn: ({ signal }) => loadAllExpenses(profileId, { groupId, groupMembership }, signal),
    staleTime: STALE_MS,
  });
}

/** The add-from-outside pool (12A): the ledger between two dates; the picker drops current members itself. */
export function usePickerPool(profileId: string, groupId: string, range: { from: string; to: string } | null) {
  return useQuery({
    queryKey: groupKey(profileId, groupId, 'pool', range?.from, range?.to),
    queryFn: ({ signal }) => loadAllExpenses(profileId, { from: range!.from, to: range!.to }, signal),
    enabled: range !== null,
    staleTime: STALE_MS,
  });
}

/** Today's reference rates for the ≈ line (2A); a 503 means no line, so no retry. */
export function useFxRates(profileId: string, base: Currency, enabled = true) {
  return useQuery({ queryKey: fxRatesKey(profileId, base), queryFn: () => api.fxRates(base), staleTime: FX_STALE_MS, retry: false, enabled });
}

export function useCreateGroup(profileId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ body, idempotencyKey }: { body: CreateExpenseGroupRequest; idempotencyKey: string }) => api.createExpenseGroup(profileId, body, idempotencyKey),
    onSuccess: () => invalidateGroups(queryClient, profileId),
  });
}

export function useUpdateGroup(profileId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ groupId, body, version }: { groupId: string; body: UpdateExpenseGroupRequest; version: number }) => api.updateExpenseGroup(profileId, groupId, body, version),
    onSuccess: () => invalidateGroups(queryClient, profileId),
  });
}

export function useDeleteGroup(profileId: string) {
  return useMutation({ mutationFn: (groupId: string) => api.deleteExpenseGroup(profileId, groupId) });
}

/**
 * Marks for one expense reach the server in the order they were made (eng R3):
 * the API is last-write-wins by arrival, so a Leave out and its Undo must never
 * race. A failed request doesn't block the next one.
 */
const markChains = new Map<string, Promise<unknown>>();

export function sendMark(profileId: string, groupId: string, expenseId: string, verb: Verb): Promise<unknown> {
  const key = `${profileId}:${groupId}:${expenseId}`;
  const previous = markChains.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(() => api.setExpenseGroupMark(profileId, groupId, expenseId, VERB_MARK[verb]));
  markChains.set(key, next);
  next
    .catch(() => undefined)
    .finally(() => {
      if (markChains.get(key) === next) markChains.delete(key);
    });
  return next;
}

export const markMutationKey = (groupId: string) => ['expense-group-mark', groupId] as const;

/**
 * How many times a group's summary, members and Left out have loaded, read from
 * the cache during render: the page re-renders whenever those queries change, so
 * the counts are current there (the hook results don't carry `dataUpdateCount`).
 */
export function groupLoads(queryClient: QueryClient, profileId: string, groupId: string): SeenReads {
  const loads = (part: string) => queryClient.getQueryState(groupKey(profileId, groupId, part))?.dataUpdateCount ?? 0;
  return { summary: loads('summary'), members: loads('member'), excluded: loads('excluded') };
}

let markSerial = 0;

/**
 * Optimistic leave-out (craft spec 1, eng R1): a mark shows at once and stays
 * until a read loads again after its request settled, so the server's figures
 * replace it without ever counting it twice. "Again" is TanStack's per-query
 * load counter, not a clock, so two events in one millisecond (or a test's
 * frozen clock) can't confuse it. A refused mark is dropped (the row goes back)
 * and the caller hears `false`. Refetch only after the last mark in flight, so
 * a burst of leave-outs reads once.
 */
export function useGroupMarks(profileId: string, groupId: string) {
  const queryClient = useQueryClient();
  const [marks, setMarks] = useState<PendingMark[]>([]);
  // While a batch runs, its saves don't each refetch; the batch refetches once at the end (eng R2).
  const batching = useRef(false);
  const mutationKey = markMutationKey(groupId);
  const mutation = useMutation({
    mutationKey,
    mutationFn: async ({ verb, row, markId }: { verb: Verb; row: Expense; markId: string }) => {
      await sendMark(profileId, groupId, row.id, verb);
      const settled = groupLoads(queryClient, profileId, groupId);
      setMarks((current) => current.map((m) => (m.id === markId ? { ...m, settled } : m)));
    },
    onMutate: () => queryClient.cancelQueries({ queryKey: groupKey(profileId, groupId) }),
    onSettled: () => {
      if (!batching.current && queryClient.isMutating({ mutationKey }) <= 1) void invalidateGroups(queryClient, profileId);
    },
  });
  const { mutateAsync } = mutation;

  const act = useCallback(
    async (verb: Verb, row: Expense): Promise<boolean> => {
      markSerial += 1;
      const markId = `m${markSerial}`;
      setMarks((current) => [...current, { id: markId, verb, row, settled: null }]);
      try {
        await mutateAsync({ verb, row, markId });
        return true;
      } catch {
        setMarks((current) => current.filter((m) => m.id !== markId));
        return false;
      }
    },
    [mutateAsync],
  );

  /** Several rows at once (13A Leave out all, 12A picker): they all move now; the saves go one at a time (no batch API). */
  const actMany = useCallback(
    async (verb: Verb, rows: Expense[]) => {
      const pending = rows.map((row) => {
        markSerial += 1;
        return { id: `m${markSerial}`, verb, row, settled: null } satisfies PendingMark;
      });
      setMarks((current) => [...current, ...pending]);
      batching.current = true;
      try {
        const result = await runSequential(pending, (mark) => mutateAsync({ verb, row: mark.row, markId: mark.id }));
        const failed = new Set(result.failed.map((m) => m.id));
        if (failed.size > 0) setMarks((current) => current.filter((m) => !failed.has(m.id)));
        return { done: result.done.map((m) => m.row), failed: result.failed.map((m) => m.row) };
      } finally {
        batching.current = false;
        void invalidateGroups(queryClient, profileId);
      }
    },
    [mutateAsync, queryClient, profileId],
  );

  return {
    act,
    actMany,
    /** The summary as last loaded (`loads` = its dataUpdateCount), with the marks it doesn't carry yet. */
    summary: (summary: ExpenseGroupSummary, loads: number) => applyMarks(summary, marks.filter((m) => m.settled === null || loads <= m.settled.summary)),
    /** Members and Left out with the marks either list doesn't carry yet (row marks are idempotent, so both lists may get them). */
    rows: (members: Expense[], excluded: Expense[], loads: { members: number; excluded: number }) =>
      applyRowMarks(members, excluded, marks.filter((m) => m.settled === null || loads.members <= m.settled.members || loads.excluded <= m.settled.excluded)),
  };
}
