import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  planRepo,
  planAssumptionRepo,
  planScenarioRepo,
} from '../db/planRepository';
import { calculatePlan, type FxRates } from '../services/planCalculationService';
import { useFxRate } from './useFxRate';
import type {
  Plan,
  PlanAssumption,
  PlanScenario,
  PlanFilters,
  AssumptionCategory,
} from '../types';

// ============================================================================
// Query Keys
// ============================================================================

export const planQueryKeys = {
  // Plans
  plans: (filters: PlanFilters) => ['plans', filters] as const,
  plan: (id: string) => ['plan', id] as const,

  // Assumptions
  planAssumptions: (planId: string) => ['planAssumptions', planId] as const,
  planAssumptionsByCategory: (planId: string, category: AssumptionCategory) =>
    ['planAssumptions', planId, category] as const,
  planAssumption: (id: string) => ['planAssumption', id] as const,

  // Scenarios
  planScenarios: (planId: string) => ['planScenarios', planId] as const,
  planScenario: (id: string) => ['planScenario', id] as const,
  planDefaultScenario: (planId: string) => ['planDefaultScenario', planId] as const,

  // Projections (computed)
  planProjections: (planId: string, scenarioId?: string) =>
    ['planProjections', planId, scenarioId] as const,
};

// ============================================================================
// Invalidation Helpers
// ============================================================================

function invalidatePlanQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['plans'] });
  queryClient.invalidateQueries({ queryKey: ['plan'] });
}

function invalidateAssumptionQueries(queryClient: ReturnType<typeof useQueryClient>) {
  // Invalidate assumptions queries - this will trigger refetch
  queryClient.invalidateQueries({ queryKey: ['planAssumptions'] });
  queryClient.invalidateQueries({ queryKey: ['planAssumption'] });
  // Projections will auto-recalculate because dataUpdatedAt is in their query key
  queryClient.invalidateQueries({ queryKey: ['planProjections'] });
  queryClient.invalidateQueries({ queryKey: ['planCategorySummary'] });
}

function invalidateScenarioQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['planScenarios'] });
  queryClient.invalidateQueries({ queryKey: ['planScenario'] });
  queryClient.invalidateQueries({ queryKey: ['planDefaultScenario'] });
  queryClient.invalidateQueries({ queryKey: ['planProjections'] });
}

function invalidateAllPlanQueries(queryClient: ReturnType<typeof useQueryClient>) {
  invalidatePlanQueries(queryClient);
  invalidateAssumptionQueries(queryClient);
  invalidateScenarioQueries(queryClient);
}

// ============================================================================
// Plan Queries
// ============================================================================

/**
 * List plans with filters
 */
export function usePlans(filters: PlanFilters = {}) {
  return useQuery({
    queryKey: planQueryKeys.plans(filters),
    queryFn: () => planRepo.list(filters),
  });
}

/**
 * Get a single plan by ID
 */
export function usePlan(id: string) {
  return useQuery({
    queryKey: planQueryKeys.plan(id),
    queryFn: () => planRepo.get(id),
    enabled: !!id,
  });
}

// ============================================================================
// Plan Mutations
// ============================================================================

/**
 * Create a new plan
 */
export function useCreatePlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Omit<Plan, 'id' | 'createdAt' | 'updatedAt'>) =>
      planRepo.create(data),
    onSuccess: () => invalidateAllPlanQueries(queryClient),
  });
}

/**
 * Update a plan
 */
export function useUpdatePlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Plan> }) =>
      planRepo.update(id, data),
    onSuccess: () => invalidatePlanQueries(queryClient),
  });
}

/**
 * Archive a plan
 */
export function useArchivePlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => planRepo.archive(id),
    onSuccess: () => invalidatePlanQueries(queryClient),
  });
}

/**
 * Duplicate a plan with all assumptions and scenarios
 */
export function useDuplicatePlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, newName }: { id: string; newName?: string }) =>
      planRepo.duplicate(id, newName),
    onSuccess: () => invalidateAllPlanQueries(queryClient),
  });
}

/**
 * Activate a draft plan
 */
export function useActivatePlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => planRepo.activate(id),
    onSuccess: () => invalidatePlanQueries(queryClient),
  });
}

// ============================================================================
// Assumption Queries
// ============================================================================

/**
 * Get all assumptions for a plan
 */
export function usePlanAssumptions(planId: string) {
  return useQuery({
    queryKey: planQueryKeys.planAssumptions(planId),
    queryFn: () => planAssumptionRepo.getByPlan(planId),
    enabled: !!planId,
  });
}

/**
 * Get assumptions by plan and category
 */
export function usePlanAssumptionsByCategory(
  planId: string,
  category: AssumptionCategory
) {
  return useQuery({
    queryKey: planQueryKeys.planAssumptionsByCategory(planId, category),
    queryFn: () => planAssumptionRepo.getByPlanAndCategory(planId, category),
    enabled: !!planId,
  });
}

/**
 * Get a single assumption by ID
 */
export function usePlanAssumption(id: string) {
  return useQuery({
    queryKey: planQueryKeys.planAssumption(id),
    queryFn: () => planAssumptionRepo.get(id),
    enabled: !!id,
  });
}

// ============================================================================
// Assumption Mutations
// ============================================================================

/**
 * Create a new assumption
 */
export function useCreateAssumption() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Omit<PlanAssumption, 'id' | 'createdAt' | 'updatedAt'>) =>
      planAssumptionRepo.create(data),
    onSuccess: () => invalidateAssumptionQueries(queryClient),
  });
}

/**
 * Update an assumption
 */
export function useUpdateAssumption() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<PlanAssumption> }) =>
      planAssumptionRepo.update(id, data),
    onSuccess: () => invalidateAssumptionQueries(queryClient),
  });
}

/**
 * Delete an assumption
 */
export function useDeleteAssumption() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => planAssumptionRepo.delete(id),
    onSuccess: () => invalidateAssumptionQueries(queryClient),
  });
}

// ============================================================================
// Scenario Queries
// ============================================================================

/**
 * Get all scenarios for a plan
 */
export function usePlanScenarios(planId: string) {
  return useQuery({
    queryKey: planQueryKeys.planScenarios(planId),
    queryFn: () => planScenarioRepo.getByPlan(planId),
    enabled: !!planId,
  });
}

/**
 * Get the default scenario for a plan
 */
export function usePlanDefaultScenario(planId: string) {
  return useQuery({
    queryKey: planQueryKeys.planDefaultScenario(planId),
    queryFn: () => planScenarioRepo.getDefault(planId),
    enabled: !!planId,
  });
}

/**
 * Get a single scenario by ID
 */
export function usePlanScenario(id: string) {
  return useQuery({
    queryKey: planQueryKeys.planScenario(id),
    queryFn: () => planScenarioRepo.get(id),
    enabled: !!id,
  });
}

// ============================================================================
// Scenario Mutations
// ============================================================================

/**
 * Create a new scenario
 */
export function useCreateScenario() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Omit<PlanScenario, 'id' | 'createdAt' | 'updatedAt'>) =>
      planScenarioRepo.create(data),
    onSuccess: () => invalidateScenarioQueries(queryClient),
  });
}

/**
 * Update a scenario
 */
export function useUpdateScenario() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<PlanScenario> }) =>
      planScenarioRepo.update(id, data),
    onSuccess: () => invalidateScenarioQueries(queryClient),
  });
}

/**
 * Delete a scenario
 */
export function useDeleteScenario() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => planScenarioRepo.delete(id),
    onSuccess: () => invalidateScenarioQueries(queryClient),
  });
}

/**
 * Set a scenario as default
 */
export function useSetDefaultScenario() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => planScenarioRepo.setDefault(id),
    onSuccess: () => invalidateScenarioQueries(queryClient),
  });
}

// ============================================================================
// Projections Query (Computed)
// ============================================================================

/**
 * Calculate projections for a plan and scenario
 */
export function usePlanProjections(planId: string, scenarioId?: string) {
  const { data: plan } = usePlan(planId);
  const { data: assumptions, dataUpdatedAt } = usePlanAssumptions(planId);
  const { data: scenario } = usePlanScenario(scenarioId || '');
  const { data: defaultScenario } = usePlanDefaultScenario(planId);

  // Get FX rate for multi-currency support
  const fxResult = useFxRate('USD', 'ILS');
  const usdToIlsRate = fxResult.rate;

  // Use provided scenario or default scenario
  const activeScenario = scenario || defaultScenario;

  return useQuery({
    // Include assumptions update timestamp in query key to force recalculation
    queryKey: [...planQueryKeys.planProjections(planId, scenarioId), usdToIlsRate, dataUpdatedAt],
    queryFn: () => {
      if (!plan || !assumptions || !activeScenario) {
        throw new Error('Missing data for projection calculation');
      }
      const fxRates: FxRates = {
        usdToIls: usdToIlsRate,
      };
      return calculatePlan(plan, assumptions, activeScenario, fxRates);
    },
    enabled: !!plan && !!assumptions && !!activeScenario,
  });
}

/**
 * Hook to get category summary for a plan
 */
export function usePlanCategorySummary(planId: string) {
  const { data: plan } = usePlan(planId);

  return useQuery({
    queryKey: ['planCategorySummary', planId],
    queryFn: () => {
      if (!plan) throw new Error('Plan not found');
      return planAssumptionRepo.getCategorySummary(planId, plan.currency);
    },
    enabled: !!plan,
  });
}
