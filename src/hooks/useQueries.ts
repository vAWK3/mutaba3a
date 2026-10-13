import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { backUpNow } from '../db/backup';
import { getRepositories, type Repositories } from '../db';
import type {
  QueryFilters,
  Transaction,
  Client,
  Project,
  Currency,
  BusinessProfile,
  PaymentByClientFilters,
  ClientSummary,
  ProjectSummary,
  ProfileScope,
} from '../types';

/**
 * Invalidates every payment-record list, including the client payment history
 * (MUT-4). Any income write can change it: Mark paid writes a PaymentRecord,
 * and a retitled, re-dated or deleted entry changes or removes its rows. Lives
 * here, beside the keys it owns, so the income write path calls this rather
 * than repeating the key (TD-021).
 */
export function invalidatePaymentRecordLists(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['paymentRecords'] });
}

/**
 * Everything a transaction write can change. The one list for every write
 * path: the income hooks (useIncomeQueries) reuse it, and it covers their
 * keys too, because the income drawer saves through this module while the
 * client profile and /income read useIncome / useReceivables (MUT-5).
 */
export function invalidateTransactionQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['income'] });
  queryClient.invalidateQueries({ queryKey: ['receivables'] });
  queryClient.invalidateQueries({ queryKey: ['incomeOverviewTotals'] });
  queryClient.invalidateQueries({ queryKey: ['incomeAttentionReceivables'] });
  queryClient.invalidateQueries({ queryKey: ['transactions'] });
  queryClient.invalidateQueries({ queryKey: ['transaction'] });
  // The payment drawer's remaining balance reads this one
  queryClient.invalidateQueries({ queryKey: ['transactionDisplay'] });
  queryClient.invalidateQueries({ queryKey: ['overviewTotals'] });
  queryClient.invalidateQueries({ queryKey: ['overviewTotalsByCurrency'] });
  queryClient.invalidateQueries({ queryKey: ['attentionReceivables'] });
  queryClient.invalidateQueries({ queryKey: ['projectSummaries'] });
  queryClient.invalidateQueries({ queryKey: ['projectSummary'] });
  queryClient.invalidateQueries({ queryKey: ['clientSummaries'] });
  queryClient.invalidateQueries({ queryKey: ['clientSummary'] });
  invalidatePaymentRecordLists(queryClient);
}

// Query keys
export const queryKeys = {
  transactions: (filters: QueryFilters) => ['transactions', filters] as const,
  transaction: (id: string) => ['transaction', id] as const,
  overviewTotals: (dateFrom: string, dateTo: string, currency?: Currency, profileId?: string) =>
    ['overviewTotals', { dateFrom, dateTo, currency, profileId }] as const,
  overviewTotalsByCurrency: (dateFrom: string, dateTo: string, profileId?: string) =>
    ['overviewTotalsByCurrency', { dateFrom, dateTo, profileId }] as const,
  attentionReceivables: (currency?: Currency, profileId?: string) =>
    ['attentionReceivables', { currency, profileId }] as const,
  clients: (profileId?: ProfileScope) => ['clients', { profileId }] as const,
  client: (id: string) => ['client', id] as const,
  clientSummaries: (profileId?: string, currency?: Currency, search?: string) =>
    ['clientSummaries', { profileId, currency, search }] as const,
  clientSummary: (id: string, dateFrom?: string, dateTo?: string, currency?: Currency) =>
    ['clientSummary', id, { dateFrom, dateTo, currency }] as const,
  projects: (profileId?: string, clientId?: string) => ['projects', { profileId, clientId }] as const,
  project: (id: string) => ['project', id] as const,
  projectSummaries: (profileId?: string, currency?: Currency, search?: string, field?: string) =>
    ['projectSummaries', { profileId, currency, search, field }] as const,
  projectSummary: (id: string, dateFrom?: string, dateTo?: string, currency?: Currency) =>
    ['projectSummary', id, { dateFrom, dateTo, currency }] as const,
  categories: (kind?: 'income' | 'expense') => ['categories', { kind }] as const,
  settings: () => ['settings'] as const,
  fxRate: (base: Currency, quote: Currency) => ['fxRate', base, quote] as const,
  // Business Profile keys
  businessProfiles: () => ['businessProfiles'] as const,
  businessProfile: (id: string) => ['businessProfile', id] as const,
  defaultBusinessProfile: () => ['defaultBusinessProfile'] as const,
  // Payment Record keys
  paymentRecords: (transactionId: string) => ['paymentRecords', transactionId] as const,
  paymentRecordsByClient: (clientId: string, filters: PaymentByClientFilters) =>
    ['paymentRecords', 'client', clientId, filters] as const,
  recentPayments: (profileId?: ProfileScope, limit?: number) => ['paymentRecords', 'recent', { profileId, limit }] as const,
};

/**
 * A read that may wait: Home and Clients pass `enabled: false` until the
 * "All businesses" lens knows its businesses (MUT-89, D2), because an absent
 * business means every record.
 */
export interface QueryGate {
  enabled?: boolean;
}

// Transaction hooks
/**
 * @deprecated Use `useIncome` from `useIncomeQueries.ts` for income-specific queries.
 * This generic hook is kept for legacy mixed views (transactions ledger, overview, etc.)
 * that show both income and old-style project expenses until the next release migration.
 *
 * For income-only queries, use:
 * - `useIncome` for fetching income transactions
 * - `useReceivables` for unpaid income
 *
 * For expenses, use hooks from `useExpenseQueries.ts`.
 */
export function useTransactions(filters: QueryFilters, { enabled }: QueryGate = {}) {
  return useQuery({
    queryKey: queryKeys.transactions(filters),
    queryFn: () => getRepositories().base.transactions.list(filters),
    enabled,
  });
}

export function useTransaction(id: string) {
  return useQuery<Transaction | null>({
    queryKey: queryKeys.transaction(id),
    queryFn: async () => (await getRepositories().base.transactions.get(id)) ?? null,
    enabled: !!id,
  });
}

export function useTransactionDisplay(id: string | undefined) {
  return useQuery({
    queryKey: ['transactionDisplay', id],
    queryFn: () => getRepositories().base.transactions.getDisplay(id!),
    enabled: !!id,
  });
}

export function useOverviewTotals(dateFrom: string, dateTo: string, currency?: Currency, profileId?: string) {
  return useQuery({
    queryKey: queryKeys.overviewTotals(dateFrom, dateTo, currency, profileId),
    queryFn: () => getRepositories().base.transactions.getOverviewTotals({ dateFrom, dateTo, currency, profileId }),
  });
}

export function useOverviewTotalsByCurrency(dateFrom: string, dateTo: string, profileId?: string) {
  return useQuery({
    queryKey: queryKeys.overviewTotalsByCurrency(dateFrom, dateTo, profileId),
    queryFn: () => getRepositories().base.transactions.getOverviewTotalsByCurrency({ dateFrom, dateTo, profileId }),
  });
}

export function useAttentionReceivables(currency?: Currency, profileId?: string) {
  return useQuery({
    queryKey: queryKeys.attentionReceivables(currency, profileId),
    queryFn: () => getRepositories().base.transactions.getAttentionReceivables({ currency, profileId }),
  });
}

export function useCreateTransaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>) =>
      getRepositories().base.transactions.create(data),
    onSuccess: () => invalidateTransactionQueries(queryClient),
  });
}

export function useUpdateTransaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Transaction> }) =>
      getRepositories().base.transactions.update(id, data),
    onSuccess: () => invalidateTransactionQueries(queryClient),
  });
}

/**
 * @deprecated Mark paid now routes through `PartialPaymentDrawer` and
 * `useCreatePaymentRecord` (MUT-18/ADR-038, MUT-86). This hook is kept for
 * backwards compatibility until the next release migration.
 */
export function useMarkTransactionPaid() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => getRepositories().base.transactions.markPaid(id),
    onSuccess: () => invalidateTransactionQueries(queryClient),
  });
}

export function useRecordPartialPayment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, paymentAmountMinor }: { id: string; paymentAmountMinor: number }) =>
      getRepositories().base.transactions.recordPartialPayment(id, paymentAmountMinor),
    onSuccess: () => invalidateTransactionQueries(queryClient),
  });
}

// Payment Record hooks

/**
 * A payment changes what the user is owed, so every list that answers that
 * question has to refetch. invalidateTransactionQueries is the one list for
 * that (MUT-5): it covers the income and receivables keys and, through
 * invalidatePaymentRecordLists, every ['paymentRecords', ...] key, including
 * this transaction's history and the by-client Payments section. Listing any
 * of them again here would invalidate (and refetch) them twice per save.
 */
function invalidatePaymentRecordQueries(queryClient: ReturnType<typeof useQueryClient>) {
  invalidateTransactionQueries(queryClient);
}

export function usePaymentRecords(transactionId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.paymentRecords(transactionId!),
    queryFn: () => getRepositories().base.paymentRecords.listByTransaction(transactionId!),
    enabled: !!transactionId,
  });
}

export function usePaymentsByClient(
  clientId: string | undefined,
  filters: PaymentByClientFilters = {}
) {
  return useQuery({
    queryKey: queryKeys.paymentRecordsByClient(clientId!, filters),
    queryFn: () => getRepositories().base.paymentRecords.listByClient(clientId!, filters),
    enabled: !!clientId,
  });
}

/**
 * The newest payments across every client (MUT-8, Home). Keyed under
 * ['paymentRecords'], so invalidatePaymentRecordLists refreshes it after any
 * payment or income write.
 */
export function useRecentPayments(profileId?: ProfileScope, limit = 10) {
  return useQuery({
    queryKey: queryKeys.recentPayments(profileId, limit),
    queryFn: () => getRepositories().base.paymentRecords.listRecent({ profileId, limit }),
  });
}

export function useCreatePaymentRecord() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { transactionId: string; amountMinor: number; paidAt: string; notes?: string }) =>
      getRepositories().base.paymentRecords.create(data),
    onSuccess: () => invalidatePaymentRecordQueries(queryClient),
  });
}

export function useUpdatePaymentRecord() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (vars: {
      id: string;
      transactionId: string;
      data: { amountMinor?: number; paidAt?: string; notes?: string };
    }) => getRepositories().base.paymentRecords.update(vars.id, vars.data),
    onSuccess: () => invalidatePaymentRecordQueries(queryClient),
  });
}

export function useDeletePaymentRecord() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (vars: { id: string; transactionId: string }) =>
      getRepositories().base.paymentRecords.delete(vars.id),
    onSuccess: () => invalidatePaymentRecordQueries(queryClient),
  });
}

export function useDeleteTransaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => getRepositories().base.transactions.softDelete(id),
    onSuccess: () => invalidateTransactionQueries(queryClient),
  });
}

export function useArchiveTransaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => getRepositories().base.transactions.archive(id),
    onSuccess: () => invalidateTransactionQueries(queryClient),
  });
}

export function useUnarchiveTransaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => getRepositories().base.transactions.unarchive(id),
    onSuccess: () => invalidateTransactionQueries(queryClient),
  });
}

// Client hooks
export function useClients(profileId?: ProfileScope, { enabled }: QueryGate = {}) {
  return useQuery({
    queryKey: queryKeys.clients(profileId),
    queryFn: () => getRepositories().base.clients.list({ profileId }),
    enabled,
  });
}

export function useClient(id: string) {
  return useQuery<Client | null>({
    queryKey: queryKeys.client(id),
    queryFn: async () => (await getRepositories().base.clients.get(id)) ?? null,
    enabled: !!id,
  });
}

export function useClientSummaries(profileId?: string, currency?: Currency, search?: string) {
  return useQuery({
    queryKey: queryKeys.clientSummaries(profileId, currency, search),
    queryFn: () => getRepositories().base.clientSummaries.list({ profileId, currency, search }),
  });
}

/**
 * The clients index (MUT-83, ADR-049): rows, the No client and Archived
 * clients rows, and a total equal to Home's Owed now, from one read. Keyed
 * under 'clientSummaries', so every write that refreshes client summaries
 * refreshes this too.
 */
export function useClientOwedIndex(profileId?: ProfileScope, search?: string, { enabled }: QueryGate = {}) {
  return useQuery({
    queryKey: ['clientSummaries', 'owedIndex', { profileId, search }] as const,
    queryFn: () => getRepositories().base.clientSummaries.listOwedIndex({ profileId, search }),
    enabled,
  });
}

export function useClientSummary(id: string, filters?: { dateFrom?: string; dateTo?: string; currency?: Currency }) {
  return useQuery<ClientSummary | null>({
    queryKey: queryKeys.clientSummary(id, filters?.dateFrom, filters?.dateTo, filters?.currency),
    queryFn: async () => (await getRepositories().base.clientSummaries.get(id, filters)) ?? null,
    enabled: !!id,
  });
}

export function useCreateClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Omit<Client, 'id' | 'createdAt' | 'updatedAt'>) =>
      getRepositories().base.clients.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['clientSummaries'] });
    },
  });
}

export function useUpdateClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Client> }) =>
      getRepositories().base.clients.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['client'] });
      queryClient.invalidateQueries({ queryKey: ['clientSummaries'] });
      queryClient.invalidateQueries({ queryKey: ['clientSummary'] });
    },
  });
}

export function useArchiveClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => getRepositories().base.clients.archive(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['clientSummaries'] });
    },
  });
}

// Project hooks
export function useProjects(profileId?: string, clientId?: string) {
  return useQuery({
    queryKey: queryKeys.projects(profileId, clientId),
    queryFn: () => getRepositories().base.projects.list({ profileId, clientId }),
  });
}

export function useProject(id: string) {
  return useQuery<Project | null>({
    queryKey: queryKeys.project(id),
    queryFn: async () => (await getRepositories().base.projects.get(id)) ?? null,
    enabled: !!id,
  });
}

export function useProjectSummaries(profileId?: string, currency?: Currency, search?: string, field?: string) {
  return useQuery({
    queryKey: queryKeys.projectSummaries(profileId, currency, search, field),
    queryFn: () => getRepositories().base.projectSummaries.list({ profileId, currency, search, field }),
  });
}

export function useProjectSummary(id: string, filters?: { dateFrom?: string; dateTo?: string; currency?: Currency }) {
  return useQuery<ProjectSummary | null>({
    queryKey: queryKeys.projectSummary(id, filters?.dateFrom, filters?.dateTo, filters?.currency),
    queryFn: async () => (await getRepositories().base.projectSummaries.get(id, filters)) ?? null,
    enabled: !!id,
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>) =>
      getRepositories().base.projects.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['projectSummaries'] });
      queryClient.invalidateQueries({ queryKey: ['clientSummaries'] });
    },
  });
}

export function useUpdateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Project> }) =>
      getRepositories().base.projects.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['project'] });
      queryClient.invalidateQueries({ queryKey: ['projectSummaries'] });
      queryClient.invalidateQueries({ queryKey: ['projectSummary'] });
    },
  });
}

export function useArchiveProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => getRepositories().base.projects.archive(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['projectSummaries'] });
      queryClient.invalidateQueries({ queryKey: ['clientSummaries'] });
    },
  });
}

// Category hooks
export function useCategories(kind?: 'income' | 'expense') {
  return useQuery({
    queryKey: queryKeys.categories(kind),
    queryFn: () => getRepositories().base.categories.list(kind),
  });
}

// Settings hooks
export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings(),
    queryFn: () => getRepositories().base.settings.get(),
  });
}

/**
 * Settings › Your data › Back up (MUT-88): download a full backup and record
 * its date; the settings query refreshes so "Last backed up" updates.
 */
export function useBackUp() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => backUpNow(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    // Must be a closure, not a bare method reference: settingsRepo.update
    // calls `this.get()`, and TanStack invokes mutationFn with its own `this`.
    // A detached reference throws `this.get is not a function`. The closure
    // also keeps resolution lazy, like every other call site here.
    mutationFn: (data: Parameters<Repositories['base']['settings']['update']>[0]) =>
      getRepositories().base.settings.update(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });
}

// ============================================================================
// Business Profile hooks
// ============================================================================

/**
 * Invalidates all business profile-related queries.
 */
function invalidateBusinessProfileQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['businessProfiles'] });
  queryClient.invalidateQueries({ queryKey: ['businessProfile'] });
  queryClient.invalidateQueries({ queryKey: ['defaultBusinessProfile'] });
}

export function useBusinessProfiles() {
  return useQuery({
    queryKey: queryKeys.businessProfiles(),
    queryFn: () => getRepositories().base.businessProfiles.list(),
  });
}

export function useBusinessProfile(id: string) {
  return useQuery<BusinessProfile | null>({
    queryKey: queryKeys.businessProfile(id),
    queryFn: async () => (await getRepositories().base.businessProfiles.get(id)) ?? null,
    enabled: !!id,
  });
}

/**
 * The default business profile, or `null` when none exists yet.
 *
 * The repository contract returns `undefined` for "no default", but TanStack
 * Query v5 rejects `undefined` as query data (the query enters `error` state
 * and logs on every fresh install). The hook normalises the absence to `null`
 * so consumers can rely on `isSuccess` and a plain `?.`/truthy check.
 */
export function useDefaultBusinessProfile() {
  return useQuery<BusinessProfile | null>({
    queryKey: queryKeys.defaultBusinessProfile(),
    queryFn: async () => (await getRepositories().base.businessProfiles.getDefault()) ?? null,
  });
}

export function useCreateBusinessProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Omit<BusinessProfile, 'id' | 'createdAt' | 'updatedAt'>) =>
      getRepositories().base.businessProfiles.create(data),
    onSuccess: () => invalidateBusinessProfileQueries(queryClient),
  });
}

export function useUpdateBusinessProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<BusinessProfile> }) =>
      getRepositories().base.businessProfiles.update(id, data),
    onSuccess: () => invalidateBusinessProfileQueries(queryClient),
  });
}

export function useSetDefaultBusinessProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => getRepositories().base.businessProfiles.setDefault(id),
    onSuccess: () => invalidateBusinessProfileQueries(queryClient),
  });
}

export function useArchiveBusinessProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => getRepositories().base.businessProfiles.archive(id),
    onSuccess: () => invalidateBusinessProfileQueries(queryClient),
  });
}
