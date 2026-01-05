import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  transactionRepo,
  clientRepo,
  projectRepo,
  categoryRepo,
  projectSummaryRepo,
  clientSummaryRepo,
  settingsRepo,
} from '../db';
import type { QueryFilters, Transaction, Client, Project, Currency } from '../types';

/**
 * Invalidates all transaction-related queries.
 * Extracted to avoid repeating 8 invalidation calls in each mutation.
 */
function invalidateTransactionQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['transactions'] });
  queryClient.invalidateQueries({ queryKey: ['transaction'] });
  queryClient.invalidateQueries({ queryKey: ['overviewTotals'] });
  queryClient.invalidateQueries({ queryKey: ['attentionReceivables'] });
  queryClient.invalidateQueries({ queryKey: ['projectSummaries'] });
  queryClient.invalidateQueries({ queryKey: ['projectSummary'] });
  queryClient.invalidateQueries({ queryKey: ['clientSummaries'] });
  queryClient.invalidateQueries({ queryKey: ['clientSummary'] });
}

// Query keys
export const queryKeys = {
  transactions: (filters: QueryFilters) => ['transactions', filters] as const,
  transaction: (id: string) => ['transaction', id] as const,
  overviewTotals: (dateFrom: string, dateTo: string, currency?: Currency) =>
    ['overviewTotals', { dateFrom, dateTo, currency }] as const,
  attentionReceivables: (currency?: Currency) => ['attentionReceivables', { currency }] as const,
  clients: () => ['clients'] as const,
  client: (id: string) => ['client', id] as const,
  clientSummaries: (currency?: Currency, search?: string) =>
    ['clientSummaries', { currency, search }] as const,
  clientSummary: (id: string, dateFrom?: string, dateTo?: string, currency?: Currency) =>
    ['clientSummary', id, { dateFrom, dateTo, currency }] as const,
  projects: (clientId?: string) => ['projects', { clientId }] as const,
  project: (id: string) => ['project', id] as const,
  projectSummaries: (currency?: Currency, search?: string, field?: string) =>
    ['projectSummaries', { currency, search, field }] as const,
  projectSummary: (id: string, dateFrom?: string, dateTo?: string, currency?: Currency) =>
    ['projectSummary', id, { dateFrom, dateTo, currency }] as const,
  categories: (kind?: 'income' | 'expense') => ['categories', { kind }] as const,
  settings: () => ['settings'] as const,
};

// Transaction hooks
export function useTransactions(filters: QueryFilters) {
  return useQuery({
    queryKey: queryKeys.transactions(filters),
    queryFn: () => transactionRepo.list(filters),
  });
}

export function useTransaction(id: string) {
  return useQuery({
    queryKey: queryKeys.transaction(id),
    queryFn: () => transactionRepo.get(id),
    enabled: !!id,
  });
}

export function useOverviewTotals(dateFrom: string, dateTo: string, currency?: Currency) {
  return useQuery({
    queryKey: queryKeys.overviewTotals(dateFrom, dateTo, currency),
    queryFn: () => transactionRepo.getOverviewTotals({ dateFrom, dateTo, currency }),
  });
}

export function useAttentionReceivables(currency?: Currency) {
  return useQuery({
    queryKey: queryKeys.attentionReceivables(currency),
    queryFn: () => transactionRepo.getAttentionReceivables({ currency }),
  });
}

export function useCreateTransaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>) =>
      transactionRepo.create(data),
    onSuccess: () => invalidateTransactionQueries(queryClient),
  });
}

export function useUpdateTransaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Transaction> }) =>
      transactionRepo.update(id, data),
    onSuccess: () => invalidateTransactionQueries(queryClient),
  });
}

export function useMarkTransactionPaid() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => transactionRepo.markPaid(id),
    onSuccess: () => invalidateTransactionQueries(queryClient),
  });
}

export function useDeleteTransaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => transactionRepo.softDelete(id),
    onSuccess: () => invalidateTransactionQueries(queryClient),
  });
}

// Client hooks
export function useClients() {
  return useQuery({
    queryKey: queryKeys.clients(),
    queryFn: () => clientRepo.list(),
  });
}

export function useClient(id: string) {
  return useQuery({
    queryKey: queryKeys.client(id),
    queryFn: () => clientRepo.get(id),
    enabled: !!id,
  });
}

export function useClientSummaries(currency?: Currency, search?: string) {
  return useQuery({
    queryKey: queryKeys.clientSummaries(currency, search),
    queryFn: () => clientSummaryRepo.list({ currency, search }),
  });
}

export function useClientSummary(id: string, filters?: { dateFrom?: string; dateTo?: string; currency?: Currency }) {
  return useQuery({
    queryKey: queryKeys.clientSummary(id, filters?.dateFrom, filters?.dateTo, filters?.currency),
    queryFn: () => clientSummaryRepo.get(id, filters),
    enabled: !!id,
  });
}

export function useCreateClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Omit<Client, 'id' | 'createdAt' | 'updatedAt'>) =>
      clientRepo.create(data),
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
      clientRepo.update(id, data),
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
    mutationFn: (id: string) => clientRepo.archive(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['clientSummaries'] });
    },
  });
}

// Project hooks
export function useProjects(clientId?: string) {
  return useQuery({
    queryKey: queryKeys.projects(clientId),
    queryFn: () => projectRepo.list({ clientId }),
  });
}

export function useProject(id: string) {
  return useQuery({
    queryKey: queryKeys.project(id),
    queryFn: () => projectRepo.get(id),
    enabled: !!id,
  });
}

export function useProjectSummaries(currency?: Currency, search?: string, field?: string) {
  return useQuery({
    queryKey: queryKeys.projectSummaries(currency, search, field),
    queryFn: () => projectSummaryRepo.list({ currency, search, field }),
  });
}

export function useProjectSummary(id: string, filters?: { dateFrom?: string; dateTo?: string; currency?: Currency }) {
  return useQuery({
    queryKey: queryKeys.projectSummary(id, filters?.dateFrom, filters?.dateTo, filters?.currency),
    queryFn: () => projectSummaryRepo.get(id, filters),
    enabled: !!id,
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>) =>
      projectRepo.create(data),
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
      projectRepo.update(id, data),
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
    mutationFn: (id: string) => projectRepo.archive(id),
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
    queryFn: () => categoryRepo.list(kind),
  });
}

// Settings hooks
export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings(),
    queryFn: () => settingsRepo.get(),
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: settingsRepo.update,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });
}
