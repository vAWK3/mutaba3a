import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  transactionRepo,
  clientRepo,
  projectRepo,
  categoryRepo,
  projectSummaryRepo,
  clientSummaryRepo,
  settingsRepo,
  documentRepo,
  documentSequenceRepo,
  businessProfileRepo,
} from '../db';
import { syncedBusinessProfileRepo } from '../sync/core/synced-repository';
import type {
  QueryFilters,
  Transaction,
  Client,
  Project,
  Currency,
  Document,
  DocumentFilters,
  DocumentType,
  DocumentSequence,
  BusinessProfile,
} from '../types';

/**
 * Invalidates all transaction-related queries.
 * Extracted to avoid repeating 8 invalidation calls in each mutation.
 */
function invalidateTransactionQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['transactions'] });
  queryClient.invalidateQueries({ queryKey: ['transaction'] });
  queryClient.invalidateQueries({ queryKey: ['overviewTotals'] });
  queryClient.invalidateQueries({ queryKey: ['overviewTotalsByCurrency'] });
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
  overviewTotalsByCurrency: (dateFrom: string, dateTo: string) =>
    ['overviewTotalsByCurrency', { dateFrom, dateTo }] as const,
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
  fxRate: (base: Currency, quote: Currency) => ['fxRate', base, quote] as const,
  // Document/Invoice keys
  documents: (filters: DocumentFilters) => ['documents', filters] as const,
  document: (id: string) => ['document', id] as const,
  documentSequences: (businessProfileId: string) => ['documentSequences', businessProfileId] as const,
  // Business Profile keys
  businessProfiles: () => ['businessProfiles'] as const,
  businessProfile: (id: string) => ['businessProfile', id] as const,
  defaultBusinessProfile: () => ['defaultBusinessProfile'] as const,
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

export function useOverviewTotalsByCurrency(dateFrom: string, dateTo: string) {
  return useQuery({
    queryKey: queryKeys.overviewTotalsByCurrency(dateFrom, dateTo),
    queryFn: () => transactionRepo.getOverviewTotalsByCurrency({ dateFrom, dateTo }),
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

// ============================================================================
// Document/Invoice hooks
// ============================================================================

/**
 * Invalidates all document-related queries.
 */
function invalidateDocumentQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['documents'] });
  queryClient.invalidateQueries({ queryKey: ['document'] });
}

export function useDocuments(filters: DocumentFilters) {
  return useQuery({
    queryKey: queryKeys.documents(filters),
    queryFn: () => documentRepo.list(filters),
  });
}

export function useDocument(id: string) {
  return useQuery({
    queryKey: queryKeys.document(id),
    queryFn: () => documentRepo.get(id),
    enabled: !!id,
  });
}

export function useCreateDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Omit<Document, 'id' | 'number' | 'createdAt' | 'updatedAt'>) =>
      documentRepo.create(data),
    onSuccess: () => {
      invalidateDocumentQueries(queryClient);
      // Also invalidate transactions if documents create transactions
      invalidateTransactionQueries(queryClient);
    },
  });
}

export function useUpdateDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Document> }) =>
      documentRepo.update(id, data),
    onSuccess: () => invalidateDocumentQueries(queryClient),
  });
}

export function useMarkDocumentPaid() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => documentRepo.markPaid(id),
    onSuccess: () => {
      invalidateDocumentQueries(queryClient);
      invalidateTransactionQueries(queryClient);
    },
  });
}

export function useVoidDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => documentRepo.markVoided(id),
    onSuccess: () => invalidateDocumentQueries(queryClient),
  });
}

export function useIssueDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => documentRepo.markIssued(id),
    onSuccess: () => invalidateDocumentQueries(queryClient),
  });
}

export function useDeleteDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => documentRepo.softDelete(id),
    onSuccess: () => invalidateDocumentQueries(queryClient),
  });
}

export function useLinkDocumentTransactions() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ documentId, transactionIds }: { documentId: string; transactionIds: string[] }) =>
      documentRepo.linkTransactions(documentId, transactionIds),
    onSuccess: () => {
      invalidateDocumentQueries(queryClient);
      invalidateTransactionQueries(queryClient);
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
    queryFn: () => businessProfileRepo.list(),
  });
}

export function useBusinessProfile(id: string) {
  return useQuery({
    queryKey: queryKeys.businessProfile(id),
    queryFn: () => businessProfileRepo.get(id),
    enabled: !!id,
  });
}

export function useDefaultBusinessProfile() {
  return useQuery({
    queryKey: queryKeys.defaultBusinessProfile(),
    queryFn: () => businessProfileRepo.getDefault(),
  });
}

export function useCreateBusinessProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Omit<BusinessProfile, 'id' | 'createdAt' | 'updatedAt'>) =>
      businessProfileRepo.create(data),
    onSuccess: () => invalidateBusinessProfileQueries(queryClient),
  });
}

export function useUpdateBusinessProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<BusinessProfile> }) =>
      businessProfileRepo.update(id, data),
    onSuccess: () => invalidateBusinessProfileQueries(queryClient),
  });
}

export function useSetDefaultBusinessProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => businessProfileRepo.setDefault(id),
    onSuccess: () => invalidateBusinessProfileQueries(queryClient),
  });
}

export function useArchiveBusinessProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => syncedBusinessProfileRepo.archive(id),
    onSuccess: () => invalidateBusinessProfileQueries(queryClient),
  });
}

// ============================================================================
// Document Sequence hooks
// ============================================================================

export function useDocumentSequences(businessProfileId: string) {
  return useQuery({
    queryKey: queryKeys.documentSequences(businessProfileId),
    queryFn: () => documentSequenceRepo.listByBusinessProfile(businessProfileId),
    enabled: !!businessProfileId,
  });
}

export function useDocumentSequence(businessProfileId: string, documentType: DocumentType) {
  return useQuery({
    queryKey: [...queryKeys.documentSequences(businessProfileId), documentType],
    queryFn: () => documentSequenceRepo.getOrCreate(businessProfileId, documentType),
    enabled: !!businessProfileId && !!documentType,
  });
}

export function useUpdateDocumentSequence() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      businessProfileId,
      documentType,
      updates,
    }: {
      businessProfileId: string;
      documentType: DocumentType;
      updates: Partial<DocumentSequence>;
    }) => documentSequenceRepo.update(businessProfileId, documentType, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documentSequences'] });
    },
  });
}

export function useIsDocumentNumberTaken() {
  return useMutation({
    mutationFn: ({ number, excludeId }: { number: string; excludeId?: string }) =>
      documentRepo.isNumberTaken(number, excludeId),
  });
}
