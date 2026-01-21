import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { engagementRepo } from '../db/engagementRepository';
import type {
  Engagement,
  EngagementFilters,
  EngagementSnapshot,
} from '../types';

// ============================================================================
// Query Keys
// ============================================================================

export const engagementQueryKeys = {
  // Engagements
  engagements: (filters: EngagementFilters) => ['engagements', filters] as const,
  engagement: (id: string) => ['engagement', id] as const,
  engagementDisplay: (id: string) => ['engagementDisplay', id] as const,

  // Versions
  engagementVersions: (engagementId: string) => ['engagementVersions', engagementId] as const,
  engagementVersion: (versionId: string) => ['engagementVersion', versionId] as const,
  latestVersion: (engagementId: string) => ['latestVersion', engagementId] as const,

  // Counts
  countByStatus: () => ['engagementCountByStatus'] as const,

  // By relations
  byProfile: (profileId: string) => ['engagementsByProfile', profileId] as const,
  byClient: (clientId: string) => ['engagementsByClient', clientId] as const,
  byProject: (projectId: string) => ['engagementsByProject', projectId] as const,
};

// ============================================================================
// Invalidation Helpers
// ============================================================================

function invalidateEngagementQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['engagements'] });
  queryClient.invalidateQueries({ queryKey: ['engagement'] });
  queryClient.invalidateQueries({ queryKey: ['engagementDisplay'] });
  queryClient.invalidateQueries({ queryKey: ['engagementCountByStatus'] });
  queryClient.invalidateQueries({ queryKey: ['engagementsByProfile'] });
  queryClient.invalidateQueries({ queryKey: ['engagementsByClient'] });
  queryClient.invalidateQueries({ queryKey: ['engagementsByProject'] });
}

function invalidateVersionQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['engagementVersions'] });
  queryClient.invalidateQueries({ queryKey: ['engagementVersion'] });
  queryClient.invalidateQueries({ queryKey: ['latestVersion'] });
}

function invalidateAllEngagementQueries(queryClient: ReturnType<typeof useQueryClient>) {
  invalidateEngagementQueries(queryClient);
  invalidateVersionQueries(queryClient);
}

// ============================================================================
// Engagement Queries
// ============================================================================

/**
 * List engagements with filters
 */
export function useEngagements(filters: EngagementFilters = {}) {
  return useQuery({
    queryKey: engagementQueryKeys.engagements(filters),
    queryFn: () => engagementRepo.list(filters),
  });
}

/**
 * Get a single engagement by ID
 */
export function useEngagement(id: string) {
  return useQuery({
    queryKey: engagementQueryKeys.engagement(id),
    queryFn: () => engagementRepo.get(id),
    enabled: !!id,
  });
}

/**
 * Get a single engagement with display enrichment
 */
export function useEngagementDisplay(id: string) {
  return useQuery({
    queryKey: engagementQueryKeys.engagementDisplay(id),
    queryFn: () => engagementRepo.getDisplay(id),
    enabled: !!id,
  });
}

/**
 * Get engagements for a specific profile
 */
export function useEngagementsByProfile(profileId: string) {
  return useQuery({
    queryKey: engagementQueryKeys.byProfile(profileId),
    queryFn: () => engagementRepo.getByProfile(profileId),
    enabled: !!profileId,
  });
}

/**
 * Get engagements for a specific client
 */
export function useEngagementsByClient(clientId: string) {
  return useQuery({
    queryKey: engagementQueryKeys.byClient(clientId),
    queryFn: () => engagementRepo.getByClient(clientId),
    enabled: !!clientId,
  });
}

/**
 * Get engagements for a specific project
 */
export function useEngagementsByProject(projectId: string) {
  return useQuery({
    queryKey: engagementQueryKeys.byProject(projectId),
    queryFn: () => engagementRepo.getByProject(projectId),
    enabled: !!projectId,
  });
}

/**
 * Get engagement count by status
 */
export function useEngagementCountByStatus() {
  return useQuery({
    queryKey: engagementQueryKeys.countByStatus(),
    queryFn: () => engagementRepo.countByStatus(),
  });
}

// ============================================================================
// Version Queries
// ============================================================================

/**
 * Get all versions for an engagement
 */
export function useEngagementVersions(engagementId: string) {
  return useQuery({
    queryKey: engagementQueryKeys.engagementVersions(engagementId),
    queryFn: () => engagementRepo.getVersions(engagementId),
    enabled: !!engagementId,
  });
}

/**
 * Get a specific version
 */
export function useEngagementVersion(versionId: string) {
  return useQuery({
    queryKey: engagementQueryKeys.engagementVersion(versionId),
    queryFn: () => engagementRepo.getVersion(versionId),
    enabled: !!versionId,
  });
}

/**
 * Get the latest version for an engagement
 */
export function useLatestVersion(engagementId: string) {
  return useQuery({
    queryKey: engagementQueryKeys.latestVersion(engagementId),
    queryFn: () => engagementRepo.getLatestVersion(engagementId),
    enabled: !!engagementId,
  });
}

// ============================================================================
// Engagement Mutations
// ============================================================================

/**
 * Create a new engagement
 */
export function useCreateEngagement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Omit<Engagement, 'id' | 'createdAt' | 'updatedAt'>) =>
      engagementRepo.create(data),
    onSuccess: () => invalidateEngagementQueries(queryClient),
  });
}

/**
 * Update an engagement
 */
export function useUpdateEngagement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Engagement> }) =>
      engagementRepo.update(id, data),
    onSuccess: () => invalidateEngagementQueries(queryClient),
  });
}

/**
 * Archive an engagement
 */
export function useArchiveEngagement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => engagementRepo.archive(id),
    onSuccess: () => invalidateEngagementQueries(queryClient),
  });
}

/**
 * Restore an archived engagement
 */
export function useRestoreEngagement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => engagementRepo.restore(id),
    onSuccess: () => invalidateEngagementQueries(queryClient),
  });
}

/**
 * Permanently delete an engagement
 */
export function useDeleteEngagement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => engagementRepo.delete(id),
    onSuccess: () => invalidateAllEngagementQueries(queryClient),
  });
}

/**
 * Duplicate an engagement
 */
export function useDuplicateEngagement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, newClientId }: { id: string; newClientId?: string }) =>
      engagementRepo.duplicate(id, newClientId),
    onSuccess: () => invalidateAllEngagementQueries(queryClient),
  });
}

// ============================================================================
// Version Mutations
// ============================================================================

/**
 * Save a new version (draft)
 */
export function useSaveEngagementVersion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      engagementId,
      snapshot,
      status = 'draft',
    }: {
      engagementId: string;
      snapshot: EngagementSnapshot;
      status?: 'draft' | 'final';
    }) => engagementRepo.saveVersion(engagementId, snapshot, status),
    onSuccess: () => invalidateAllEngagementQueries(queryClient),
  });
}

/**
 * Finalize an engagement
 */
export function useFinalizeEngagement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      engagementId,
      snapshot,
    }: {
      engagementId: string;
      snapshot: EngagementSnapshot;
    }) => engagementRepo.finalize(engagementId, snapshot),
    onSuccess: () => invalidateAllEngagementQueries(queryClient),
  });
}
