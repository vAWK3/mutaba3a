import { db } from './database';
import type {
  Plan,
  PlanAssumption,
  PlanScenario,
  PlanFilters,
  PlanStatus,
  AssumptionCategory,
  Currency,
} from '../types';

// ============================================================================
// Utility Functions
// ============================================================================

function generateId(): string {
  return crypto.randomUUID();
}

function nowISO(): string {
  return new Date().toISOString();
}

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// ============================================================================
// Plan Repository
// ============================================================================

export const planRepo = {
  /**
   * List plans with optional filters
   */
  async list(filters: PlanFilters = {}): Promise<Plan[]> {
    let plans = await db.plans.toArray();

    // Apply filters
    plans = plans.filter((p) => {
      // Exclude archived unless filtering for archived
      if (filters.status !== 'archived' && p.archivedAt) return false;

      if (filters.profileId && p.profileId !== filters.profileId) return false;
      if (filters.status && p.status !== filters.status) return false;

      return true;
    });

    // Sort by createdAt desc
    plans.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return plans;
  },

  /**
   * Get a single plan by ID
   */
  async get(id: string): Promise<Plan | undefined> {
    return db.plans.get(id);
  },

  /**
   * Create a new plan with default Base scenario
   */
  async create(
    data: Omit<Plan, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<Plan> {
    const now = nowISO();
    const plan: Plan = {
      ...data,
      id: generateId(),
      createdAt: now,
      updatedAt: now,
    };
    await db.plans.add(plan);

    // Auto-create default "Base" scenario
    await planScenarioRepo.create({
      planId: plan.id,
      profileId: plan.profileId,
      name: 'Base',
      isDefault: true,
    });

    return plan;
  },

  /**
   * Update a plan
   */
  async update(id: string, data: Partial<Plan>): Promise<void> {
    await db.plans.update(id, { ...data, updatedAt: nowISO() });
  },

  /**
   * Archive a plan (soft delete)
   */
  async archive(id: string): Promise<void> {
    const now = nowISO();
    await db.plans.update(id, {
      status: 'archived' as PlanStatus,
      archivedAt: now,
      updatedAt: now,
    });
  },

  /**
   * Duplicate a plan with all assumptions and scenarios
   */
  async duplicate(id: string, newName?: string): Promise<Plan | undefined> {
    const original = await this.get(id);
    if (!original) return undefined;

    const now = nowISO();
    const newPlan: Plan = {
      ...original,
      id: generateId(),
      name: newName || `${original.name} (Copy)`,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      archivedAt: undefined,
    };
    await db.plans.add(newPlan);

    // Duplicate scenarios
    const scenarios = await planScenarioRepo.getByPlan(id);
    const scenarioIdMap = new Map<string, string>();

    for (const scenario of scenarios) {
      const newScenario = await planScenarioRepo.create({
        planId: newPlan.id,
        profileId: newPlan.profileId,
        name: scenario.name,
        description: scenario.description,
        isDefault: scenario.isDefault,
        revenueMultiplier: scenario.revenueMultiplier,
        expenseMultiplier: scenario.expenseMultiplier,
        revenueDelayMonths: scenario.revenueDelayMonths,
        fundingDelayMonths: scenario.fundingDelayMonths,
      });
      scenarioIdMap.set(scenario.id, newScenario.id);
    }

    // Duplicate assumptions with mapped scenario IDs
    const assumptions = await planAssumptionRepo.getByPlan(id);
    for (const assumption of assumptions) {
      await planAssumptionRepo.create({
        planId: newPlan.id,
        profileId: newPlan.profileId,
        category: assumption.category,
        type: assumption.type,
        label: assumption.label,
        amountMinor: assumption.amountMinor,
        currency: assumption.currency,
        startMonth: assumption.startMonth,
        endMonth: assumption.endMonth,
        frequency: assumption.frequency,
        dayOfMonth: assumption.dayOfMonth,
        confidence: assumption.confidence,
        scenarioId: assumption.scenarioId
          ? scenarioIdMap.get(assumption.scenarioId)
          : undefined,
        notes: assumption.notes,
      });
    }

    return newPlan;
  },

  /**
   * Activate a draft plan
   */
  async activate(id: string): Promise<void> {
    const plan = await this.get(id);
    if (!plan || plan.status !== 'draft') return;

    await db.plans.update(id, {
      status: 'active' as PlanStatus,
      updatedAt: nowISO(),
    });
  },
};

// ============================================================================
// Plan Assumption Repository
// ============================================================================

export const planAssumptionRepo = {
  /**
   * Get all assumptions for a plan
   */
  async getByPlan(planId: string): Promise<PlanAssumption[]> {
    return db.planAssumptions.where('planId').equals(planId).toArray();
  },

  /**
   * Get assumptions by plan and category
   */
  async getByPlanAndCategory(
    planId: string,
    category: AssumptionCategory
  ): Promise<PlanAssumption[]> {
    return db.planAssumptions
      .where('[planId+category]')
      .equals([planId, category])
      .toArray();
  },

  /**
   * Get assumptions for a specific scenario (including base assumptions)
   */
  async getForScenario(
    planId: string,
    scenarioId?: string
  ): Promise<PlanAssumption[]> {
    const all = await this.getByPlan(planId);
    // Return assumptions that apply to all scenarios (no scenarioId) or to the specific scenario
    return all.filter((a) => !a.scenarioId || a.scenarioId === scenarioId);
  },

  /**
   * Get a single assumption by ID
   */
  async get(id: string): Promise<PlanAssumption | undefined> {
    return db.planAssumptions.get(id);
  },

  /**
   * Create a new assumption
   */
  async create(
    data: Omit<PlanAssumption, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<PlanAssumption> {
    const now = nowISO();
    const assumption: PlanAssumption = {
      ...data,
      id: generateId(),
      createdAt: now,
      updatedAt: now,
    };
    await db.planAssumptions.add(assumption);
    return assumption;
  },

  /**
   * Update an assumption
   */
  async update(id: string, data: Partial<PlanAssumption>): Promise<void> {
    await db.planAssumptions.update(id, { ...data, updatedAt: nowISO() });
  },

  /**
   * Delete an assumption
   */
  async delete(id: string): Promise<void> {
    await db.planAssumptions.delete(id);
  },

  /**
   * Delete all assumptions for a plan
   */
  async deleteByPlan(planId: string): Promise<void> {
    await db.planAssumptions.where('planId').equals(planId).delete();
  },

  /**
   * Get summary stats by category
   */
  async getCategorySummary(
    planId: string,
    currency: Currency
  ): Promise<Record<AssumptionCategory, { count: number; totalMinor: number }>> {
    const assumptions = await this.getByPlan(planId);
    const summary: Record<AssumptionCategory, { count: number; totalMinor: number }> = {
      revenue: { count: 0, totalMinor: 0 },
      expense: { count: 0, totalMinor: 0 },
      funding: { count: 0, totalMinor: 0 },
      hiring: { count: 0, totalMinor: 0 },
      other: { count: 0, totalMinor: 0 },
    };

    for (const a of assumptions) {
      // Only count assumptions in the plan's currency
      if (a.currency !== currency) continue;

      summary[a.category].count += 1;
      summary[a.category].totalMinor += a.amountMinor;
    }

    return summary;
  },
};

// ============================================================================
// Plan Scenario Repository
// ============================================================================

export const planScenarioRepo = {
  /**
   * Get all scenarios for a plan
   */
  async getByPlan(planId: string): Promise<PlanScenario[]> {
    const scenarios = await db.planScenarios
      .where('planId')
      .equals(planId)
      .toArray();

    // Sort: default first, then by name
    return scenarios.sort((a, b) => {
      if (a.isDefault && !b.isDefault) return -1;
      if (!a.isDefault && b.isDefault) return 1;
      return a.name.localeCompare(b.name);
    });
  },

  /**
   * Get the default scenario for a plan
   */
  async getDefault(planId: string): Promise<PlanScenario | undefined> {
    // Use simple filter approach since compound index with booleans can be tricky in Dexie
    const scenarios = await db.planScenarios
      .where('planId')
      .equals(planId)
      .filter((s) => s.isDefault === true)
      .toArray();
    return scenarios[0];
  },

  /**
   * Get a single scenario by ID
   */
  async get(id: string): Promise<PlanScenario | undefined> {
    return db.planScenarios.get(id);
  },

  /**
   * Create a new scenario
   */
  async create(
    data: Omit<PlanScenario, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<PlanScenario> {
    const now = nowISO();
    const scenario: PlanScenario = {
      ...data,
      id: generateId(),
      createdAt: now,
      updatedAt: now,
    };
    await db.planScenarios.add(scenario);
    return scenario;
  },

  /**
   * Update a scenario
   */
  async update(id: string, data: Partial<PlanScenario>): Promise<void> {
    await db.planScenarios.update(id, { ...data, updatedAt: nowISO() });
  },

  /**
   * Delete a scenario (cannot delete default)
   */
  async delete(id: string): Promise<boolean> {
    const scenario = await this.get(id);
    if (!scenario || scenario.isDefault) return false;

    // Also delete scenario-specific assumptions
    const assumptions = await db.planAssumptions
      .where('scenarioId')
      .equals(id)
      .toArray();
    for (const a of assumptions) {
      await db.planAssumptions.delete(a.id);
    }

    await db.planScenarios.delete(id);
    return true;
  },

  /**
   * Set a scenario as default (unsets others)
   */
  async setDefault(id: string): Promise<void> {
    const scenario = await this.get(id);
    if (!scenario) return;

    // Unset all other defaults for this plan
    const others = await this.getByPlan(scenario.planId);
    for (const other of others) {
      if (other.id !== id && other.isDefault) {
        await db.planScenarios.update(other.id, {
          isDefault: false,
          updatedAt: nowISO(),
        });
      }
    }

    // Set this one as default
    await db.planScenarios.update(id, {
      isDefault: true,
      updatedAt: nowISO(),
    });
  },

  /**
   * Create default scenarios for a plan (Base, Conservative, Optimistic)
   */
  async createDefaultScenarios(planId: string, profileId: string): Promise<void> {
    await this.create({
      planId,
      profileId,
      name: 'Base',
      description: 'Expected case scenario',
      isDefault: true,
    });

    await this.create({
      planId,
      profileId,
      name: 'Conservative',
      description: 'Pessimistic assumptions with delayed revenue',
      isDefault: false,
      revenueMultiplier: 0.7,
      expenseMultiplier: 1.2,
      revenueDelayMonths: 2,
    });

    await this.create({
      planId,
      profileId,
      name: 'Optimistic',
      description: 'Best case scenario',
      isDefault: false,
      revenueMultiplier: 1.3,
      expenseMultiplier: 0.9,
    });
  },
};

// Re-export for convenience
export { getCurrentMonth };
