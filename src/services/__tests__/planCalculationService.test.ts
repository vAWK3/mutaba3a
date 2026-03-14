/**
 * Unit tests for planCalculationService
 *
 * Tests:
 * - generateMonthlyProjections
 * - calculateSummary
 * - calculateAsk
 * - generateInsights
 * - applyScenarioOverrides
 */

import { describe, it, expect } from 'vitest';
import {
  generateMonthlyProjections,
  calculateSummary,
  calculateAsk,
  generateInsights,
  applyScenarioOverrides,
  calculatePlan,
} from '../planCalculationService';
import type { Plan, PlanAssumption, PlanScenario } from '../../types';

// Helper to create a test plan
const createPlan = (overrides: Partial<Plan> = {}): Plan => ({
  id: 'plan-1',
  profileId: 'profile-1',
  name: 'Test Plan',
  currency: 'USD',
  startMonth: '2025-01-01',
  horizonMonths: 12,
  status: 'draft',
  askMode: 'calculated',
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
  ...overrides,
});

// Helper to create a test assumption
const createAssumption = (overrides: Partial<PlanAssumption> = {}): PlanAssumption => ({
  id: 'assumption-1',
  planId: 'plan-1',
  profileId: 'profile-1',
  category: 'revenue',
  type: 'recurring',
  label: 'Monthly Revenue',
  amountMinor: 500000, // $5,000
  currency: 'USD',
  startMonth: '2025-01',
  confidence: 'confirmed',
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
  ...overrides,
});

// Helper to create a test scenario
const createScenario = (overrides: Partial<PlanScenario> = {}): PlanScenario => ({
  id: 'scenario-1',
  planId: 'plan-1',
  profileId: 'profile-1',
  name: 'Base',
  isDefault: true,
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
  ...overrides,
});

describe('generateMonthlyProjections', () => {
  it('generates correct number of months based on horizon', () => {
    const plan = createPlan({ horizonMonths: 12, startMonth: '2025-01' });
    const assumptions: PlanAssumption[] = [];

    const projections = generateMonthlyProjections(plan, assumptions);

    expect(projections).toHaveLength(12);
    expect(projections[0].month).toBe('2025-01');
    expect(projections[11].month).toBe('2025-12');
  });

  it('generates 18-month horizon correctly', () => {
    const plan = createPlan({ horizonMonths: 18, startMonth: '2025-01' });
    const assumptions: PlanAssumption[] = [];

    const projections = generateMonthlyProjections(plan, assumptions);

    expect(projections).toHaveLength(18);
    expect(projections[17].month).toBe('2026-06');
  });

  it('generates 24-month horizon correctly', () => {
    const plan = createPlan({ horizonMonths: 24, startMonth: '2025-01' });
    const assumptions: PlanAssumption[] = [];

    const projections = generateMonthlyProjections(plan, assumptions);

    expect(projections).toHaveLength(24);
    expect(projections[23].month).toBe('2026-12');
  });

  it('calculates recurring revenue correctly', () => {
    const plan = createPlan({ horizonMonths: 12, startMonth: '2025-01' });
    const assumptions = [
      createAssumption({
        category: 'revenue',
        type: 'recurring',
        amountMinor: 500000, // $5,000/month
        frequency: 'monthly',
        startMonth: '2025-01',
      }),
    ];

    const projections = generateMonthlyProjections(plan, assumptions);

    // Each month should have $5,000 cash in
    projections.forEach((p) => {
      expect(p.cashInMinor).toBe(500000);
    });
  });

  it('calculates recurring expenses correctly', () => {
    const plan = createPlan({ horizonMonths: 12, startMonth: '2025-01' });
    const assumptions = [
      createAssumption({
        category: 'expense',
        type: 'recurring',
        amountMinor: 200000, // $2,000/month
        frequency: 'monthly',
        startMonth: '2025-01',
      }),
    ];

    const projections = generateMonthlyProjections(plan, assumptions);

    // Each month should have $2,000 cash out
    projections.forEach((p) => {
      expect(p.cashOutMinor).toBe(200000);
    });
  });

  it('handles one-time funding correctly', () => {
    const plan = createPlan({ horizonMonths: 12, startMonth: '2025-01' });
    const assumptions = [
      createAssumption({
        category: 'funding',
        type: 'one_time',
        amountMinor: 10000000, // $100,000
        startMonth: '2025-03', // March
      }),
    ];

    const projections = generateMonthlyProjections(plan, assumptions);

    // January and February should have no funding
    expect(projections[0].cashInMinor).toBe(0);
    expect(projections[1].cashInMinor).toBe(0);
    // March should have $100,000
    expect(projections[2].cashInMinor).toBe(10000000);
    // April onwards should have no funding
    expect(projections[3].cashInMinor).toBe(0);
  });

  it('handles hiring costs correctly', () => {
    const plan = createPlan({ horizonMonths: 12, startMonth: '2025-01' });
    const assumptions = [
      createAssumption({
        category: 'hiring',
        type: 'recurring',
        amountMinor: 800000, // $8,000/month salary
        frequency: 'monthly',
        startMonth: '2025-04', // Start in April
      }),
    ];

    const projections = generateMonthlyProjections(plan, assumptions);

    // Jan-Mar should have no hiring cost
    expect(projections[0].cashOutMinor).toBe(0);
    expect(projections[1].cashOutMinor).toBe(0);
    expect(projections[2].cashOutMinor).toBe(0);
    // April onwards should have $8,000
    expect(projections[3].cashOutMinor).toBe(800000);
    expect(projections[11].cashOutMinor).toBe(800000);
  });

  it('respects assumption end month', () => {
    const plan = createPlan({ horizonMonths: 12, startMonth: '2025-01' });
    const assumptions = [
      createAssumption({
        category: 'expense',
        type: 'recurring',
        amountMinor: 100000, // $1,000/month
        frequency: 'monthly',
        startMonth: '2025-01',
        endMonth: '2025-06', // End in June
      }),
    ];

    const projections = generateMonthlyProjections(plan, assumptions);

    // Jan-June should have expense
    for (let i = 0; i < 6; i++) {
      expect(projections[i].cashOutMinor).toBe(100000);
    }
    // July onwards should have no expense
    for (let i = 6; i < 12; i++) {
      expect(projections[i].cashOutMinor).toBe(0);
    }
  });

  it('calculates running balance correctly', () => {
    const plan = createPlan({ horizonMonths: 6, startMonth: '2025-01' });
    const assumptions = [
      createAssumption({
        category: 'revenue',
        type: 'recurring',
        amountMinor: 1000000, // $10,000/month
        frequency: 'monthly',
        startMonth: '2025-01',
      }),
      createAssumption({
        id: 'assumption-2',
        category: 'expense',
        type: 'recurring',
        amountMinor: 600000, // $6,000/month
        frequency: 'monthly',
        startMonth: '2025-01',
      }),
    ];

    const projections = generateMonthlyProjections(plan, assumptions);

    // Net flow each month = $10,000 - $6,000 = $4,000
    // Opening starts at 0
    expect(projections[0].openingCashMinor).toBe(0);
    expect(projections[0].netFlowMinor).toBe(400000);
    expect(projections[0].closingCashMinor).toBe(400000);

    // Month 2 opens with $4,000
    expect(projections[1].openingCashMinor).toBe(400000);
    expect(projections[1].closingCashMinor).toBe(800000);

    // Month 6 should have accumulated balance
    expect(projections[5].closingCashMinor).toBe(2400000); // 6 * $4,000
  });

  it('calculates confidence score based on assumptions', () => {
    const plan = createPlan({ horizonMonths: 3, startMonth: '2025-01' });
    const assumptions = [
      createAssumption({
        category: 'revenue',
        type: 'recurring',
        amountMinor: 500000,
        confidence: 'confirmed',
        startMonth: '2025-01',
      }),
      createAssumption({
        id: 'assumption-2',
        category: 'expense',
        type: 'recurring',
        amountMinor: 200000,
        confidence: 'rough_guess',
        startMonth: '2025-01',
      }),
    ];

    const projections = generateMonthlyProjections(plan, assumptions);

    // Confidence should be weighted average
    // confirmed = 100, rough_guess = 50
    // Average = (100 + 50) / 2 = 75
    projections.forEach((p) => {
      expect(p.confidenceScore).toBeGreaterThan(0);
      expect(p.confidenceScore).toBeLessThanOrEqual(100);
    });
  });

  it('handles quarterly frequency correctly', () => {
    const plan = createPlan({ horizonMonths: 12, startMonth: '2025-01' });
    const assumptions = [
      createAssumption({
        category: 'revenue',
        type: 'recurring',
        amountMinor: 3000000, // $30,000 quarterly
        frequency: 'quarterly',
        startMonth: '2025-01',
      }),
    ];

    const projections = generateMonthlyProjections(plan, assumptions);

    // Quarterly revenue should appear in months 1, 4, 7, 10
    expect(projections[0].cashInMinor).toBe(3000000); // January
    expect(projections[1].cashInMinor).toBe(0); // February
    expect(projections[2].cashInMinor).toBe(0); // March
    expect(projections[3].cashInMinor).toBe(3000000); // April
    expect(projections[6].cashInMinor).toBe(3000000); // July
    expect(projections[9].cashInMinor).toBe(3000000); // October
  });
});

describe('calculateSummary', () => {
  it('calculates monthly burn correctly', () => {
    const plan = createPlan({ horizonMonths: 12 });
    const projections = [
      { month: '2025-01', openingCashMinor: 0, cashInMinor: 0, cashOutMinor: 500000, netFlowMinor: -500000, closingCashMinor: -500000, confidenceScore: 100, events: [] },
      { month: '2025-02', openingCashMinor: -500000, cashInMinor: 0, cashOutMinor: 500000, netFlowMinor: -500000, closingCashMinor: -1000000, confidenceScore: 100, events: [] },
      { month: '2025-03', openingCashMinor: -1000000, cashInMinor: 0, cashOutMinor: 500000, netFlowMinor: -500000, closingCashMinor: -1500000, confidenceScore: 100, events: [] },
    ];

    const summary = calculateSummary(projections, plan);

    expect(summary.monthlyBurnMinor).toBe(500000); // Average burn
  });

  it('calculates runway correctly with burn', () => {
    const plan = createPlan({ horizonMonths: 12 });
    // Starting with $1.5M, burning $500k/month = 3 months runway
    const projections = [
      { month: '2025-01', openingCashMinor: 1500000, cashInMinor: 0, cashOutMinor: 500000, netFlowMinor: -500000, closingCashMinor: 1000000, confidenceScore: 100, events: [] },
      { month: '2025-02', openingCashMinor: 1000000, cashInMinor: 0, cashOutMinor: 500000, netFlowMinor: -500000, closingCashMinor: 500000, confidenceScore: 100, events: [] },
      { month: '2025-03', openingCashMinor: 500000, cashInMinor: 0, cashOutMinor: 500000, netFlowMinor: -500000, closingCashMinor: 0, confidenceScore: 100, events: [] },
      { month: '2025-04', openingCashMinor: 0, cashInMinor: 0, cashOutMinor: 500000, netFlowMinor: -500000, closingCashMinor: -500000, confidenceScore: 100, events: [] },
    ];

    const summary = calculateSummary(projections, plan);

    expect(summary.runwayMonths).toBe(3); // Goes negative in month 4
  });

  it('identifies break-even month correctly', () => {
    const plan = createPlan({ horizonMonths: 12 });
    // Loss initially, then profitable
    const projections = [
      { month: '2025-01', openingCashMinor: 0, cashInMinor: 400000, cashOutMinor: 500000, netFlowMinor: -100000, closingCashMinor: -100000, confidenceScore: 100, events: [] },
      { month: '2025-02', openingCashMinor: -100000, cashInMinor: 450000, cashOutMinor: 500000, netFlowMinor: -50000, closingCashMinor: -150000, confidenceScore: 100, events: [] },
      { month: '2025-03', openingCashMinor: -150000, cashInMinor: 500000, cashOutMinor: 500000, netFlowMinor: 0, closingCashMinor: -150000, confidenceScore: 100, events: [] },
      { month: '2025-04', openingCashMinor: -150000, cashInMinor: 600000, cashOutMinor: 500000, netFlowMinor: 100000, closingCashMinor: -50000, confidenceScore: 100, events: [] },
    ];

    const summary = calculateSummary(projections, plan);

    expect(summary.breakEvenMonth).toBe('2025-04'); // First month with positive net flow
  });

  it('calculates worst cash dip correctly', () => {
    const plan = createPlan({ horizonMonths: 12 });
    const projections = [
      { month: '2025-01', openingCashMinor: 0, cashInMinor: 0, cashOutMinor: 500000, netFlowMinor: -500000, closingCashMinor: -500000, confidenceScore: 100, events: [] },
      { month: '2025-02', openingCashMinor: -500000, cashInMinor: 0, cashOutMinor: 700000, netFlowMinor: -700000, closingCashMinor: -1200000, confidenceScore: 100, events: [] },
      { month: '2025-03', openingCashMinor: -1200000, cashInMinor: 2000000, cashOutMinor: 500000, netFlowMinor: 1500000, closingCashMinor: 300000, confidenceScore: 100, events: [] },
    ];

    const summary = calculateSummary(projections, plan);

    expect(summary.worstCashDipMinor).toBe(-1200000); // Lowest closing cash
  });

  it('calculates expected monthly revenue', () => {
    const plan = createPlan({ horizonMonths: 12 });
    const projections = [
      { month: '2025-01', openingCashMinor: 0, cashInMinor: 500000, cashOutMinor: 300000, netFlowMinor: 200000, closingCashMinor: 200000, confidenceScore: 100, events: [] },
      { month: '2025-02', openingCashMinor: 200000, cashInMinor: 600000, cashOutMinor: 300000, netFlowMinor: 300000, closingCashMinor: 500000, confidenceScore: 100, events: [] },
      { month: '2025-03', openingCashMinor: 500000, cashInMinor: 700000, cashOutMinor: 300000, netFlowMinor: 400000, closingCashMinor: 900000, confidenceScore: 100, events: [] },
    ];

    const summary = calculateSummary(projections, plan);

    // Average revenue = (500000 + 600000 + 700000) / 3 = 600000
    expect(summary.expectedMonthlyRevenueMinor).toBe(600000);
  });
});

describe('calculateAsk', () => {
  it('calculates minimum survivable ask', () => {
    const result = calculateAsk({
      worstCashDipMinor: -1000000, // $10,000 dip
      monthlyBurnMinor: 500000,    // $5,000 burn
      runwayMonths: 0,
    });

    // Minimum = worst dip (absolute value)
    expect(result.minimumSurvivableMinor).toBe(1000000);
  });

  it('calculates comfortable ask with buffer', () => {
    const result = calculateAsk({
      worstCashDipMinor: -1000000,
      monthlyBurnMinor: 500000,
      runwayMonths: 0,
    });

    // Comfortable = minimum + 3 months buffer
    expect(result.comfortableMinor).toBe(2500000); // $10,000 + 3 * $5,000
  });

  it('calculates growth ask', () => {
    const result = calculateAsk({
      worstCashDipMinor: -1000000,
      monthlyBurnMinor: 500000,
      runwayMonths: 0,
    });

    // Growth = comfortable + 6 months runway
    expect(result.growthMinor).toBe(5500000); // $25,000 + 6 * $5,000
  });

  it('returns zero when no funding needed', () => {
    const result = calculateAsk({
      worstCashDipMinor: 500000, // Positive - no dip
      monthlyBurnMinor: 0,      // No burn
      runwayMonths: 12,
    });

    expect(result.minimumSurvivableMinor).toBe(0);
  });
});

describe('generateInsights', () => {
  it('generates critical insight for negative cash', () => {
    const plan = createPlan();
    const projections = [
      { month: '2025-01', openingCashMinor: 0, cashInMinor: 0, cashOutMinor: 500000, netFlowMinor: -500000, closingCashMinor: -500000, confidenceScore: 100, events: [] },
    ];
    const assumptions: PlanAssumption[] = [];
    const summary = calculateSummary(projections, plan);

    const insights = generateInsights(summary, projections, assumptions);

    expect(insights.some((i) => i.severity === 'critical')).toBe(true);
    expect(insights.some((i) => i.messageKey === 'planning.insights.negativeCash')).toBe(true);
  });

  it('generates warning for low runway', () => {
    const summary = {
      askMinor: 1000000,
      askRange: { minimumSurvivableMinor: 1000000, comfortableMinor: 2000000, growthMinor: 3000000 },
      monthlyBurnMinor: 500000,
      expectedMonthlyRevenueMinor: 300000,
      runwayMonths: 4, // Less than 6 months
      breakEvenMonth: undefined,
      worstCashDipMinor: -1000000,
      bufferNeededMinor: 500000,
    };
    const projections = [
      { month: '2025-01', openingCashMinor: 0, cashInMinor: 300000, cashOutMinor: 500000, netFlowMinor: -200000, closingCashMinor: -200000, confidenceScore: 100, events: [] },
    ];

    const insights = generateInsights(summary, projections, []);

    expect(insights.some((i) => i.severity === 'warning' && i.messageKey === 'planning.insights.lowRunway')).toBe(true);
  });

  it('generates warning for low confidence assumptions', () => {
    const plan = createPlan();
    const assumptions = [
      createAssumption({
        category: 'revenue',
        confidence: 'rough_guess',
        amountMinor: 1000000, // Large amount with low confidence
      }),
    ];
    const projections = [
      { month: '2025-01', openingCashMinor: 0, cashInMinor: 1000000, cashOutMinor: 500000, netFlowMinor: 500000, closingCashMinor: 500000, confidenceScore: 50, events: [] },
    ];
    const summary = calculateSummary(projections, plan);

    const insights = generateInsights(summary, projections, assumptions);

    expect(insights.some((i) => i.messageKey === 'planning.insights.lowConfidenceAssumptions')).toBe(true);
  });

  it('generates info insight for break-even', () => {
    const summary = {
      askMinor: 0,
      askRange: { minimumSurvivableMinor: 0, comfortableMinor: 0, growthMinor: 0 },
      monthlyBurnMinor: 0,
      expectedMonthlyRevenueMinor: 500000,
      runwayMonths: 12,
      breakEvenMonth: '2025-06',
      worstCashDipMinor: 0,
      bufferNeededMinor: 0,
    };
    const projections = [
      { month: '2025-06', openingCashMinor: 0, cashInMinor: 500000, cashOutMinor: 400000, netFlowMinor: 100000, closingCashMinor: 100000, confidenceScore: 100, events: [] },
    ];

    const insights = generateInsights(summary, projections, []);

    expect(insights.some((i) => i.severity === 'info' && i.messageKey === 'planning.insights.breakEvenReached')).toBe(true);
  });
});

describe('applyScenarioOverrides', () => {
  it('applies revenue multiplier correctly', () => {
    const assumptions = [
      createAssumption({
        category: 'revenue',
        amountMinor: 1000000, // $10,000
      }),
    ];
    const scenario = createScenario({
      revenueMultiplier: 0.7, // Conservative: 70%
    });

    const adjusted = applyScenarioOverrides(assumptions, scenario);

    expect(adjusted[0].amountMinor).toBe(700000); // $7,000
  });

  it('applies expense multiplier correctly', () => {
    const assumptions = [
      createAssumption({
        category: 'expense',
        amountMinor: 500000, // $5,000
      }),
    ];
    const scenario = createScenario({
      expenseMultiplier: 1.2, // 20% higher
    });

    const adjusted = applyScenarioOverrides(assumptions, scenario);

    expect(adjusted[0].amountMinor).toBe(600000); // $6,000
  });

  it('applies revenue delay months correctly', () => {
    const assumptions = [
      createAssumption({
        category: 'revenue',
        startMonth: '2025-01',
      }),
    ];
    const scenario = createScenario({
      revenueDelayMonths: 2,
    });

    const adjusted = applyScenarioOverrides(assumptions, scenario);

    expect(adjusted[0].startMonth).toBe('2025-03'); // Delayed by 2 months
  });

  it('applies funding delay months correctly', () => {
    const assumptions = [
      createAssumption({
        category: 'funding',
        startMonth: '2025-03',
      }),
    ];
    const scenario = createScenario({
      fundingDelayMonths: 1,
    });

    const adjusted = applyScenarioOverrides(assumptions, scenario);

    expect(adjusted[0].startMonth).toBe('2025-04');
  });

  it('does not modify original assumptions', () => {
    const original = createAssumption({
      category: 'revenue',
      amountMinor: 1000000,
    });
    const assumptions = [original];
    const scenario = createScenario({
      revenueMultiplier: 0.5,
    });

    applyScenarioOverrides(assumptions, scenario);

    expect(original.amountMinor).toBe(1000000); // Original unchanged
  });

  it('handles scenario with no multipliers', () => {
    const assumptions = [
      createAssumption({
        category: 'revenue',
        amountMinor: 1000000,
      }),
    ];
    const scenario = createScenario({}); // No overrides

    const adjusted = applyScenarioOverrides(assumptions, scenario);

    expect(adjusted[0].amountMinor).toBe(1000000); // Unchanged
  });
});

describe('calculatePlan (integration)', () => {
  it('returns complete plan calculation', () => {
    const plan = createPlan({ horizonMonths: 12, startMonth: '2025-01' });
    const assumptions = [
      createAssumption({
        category: 'revenue',
        type: 'recurring',
        amountMinor: 1000000, // $10,000/month
        frequency: 'monthly',
        startMonth: '2025-01',
        confidence: 'confirmed',
      }),
      createAssumption({
        id: 'assumption-2',
        category: 'expense',
        type: 'recurring',
        amountMinor: 800000, // $8,000/month
        frequency: 'monthly',
        startMonth: '2025-01',
        confidence: 'likely',
      }),
    ];
    const scenario = createScenario();

    const result = calculatePlan(plan, assumptions, scenario);

    expect(result.monthlyProjections).toHaveLength(12);
    expect(result.summary).toBeDefined();
    expect(result.summary.monthlyBurnMinor).toBe(0); // Net positive
    expect(result.summary.expectedMonthlyRevenueMinor).toBe(1000000);
    expect(result.insights).toBeDefined();
    expect(Array.isArray(result.insights)).toBe(true);
  });

  it('applies scenario overrides in full calculation', () => {
    const plan = createPlan({ horizonMonths: 6, startMonth: '2025-01' });
    const assumptions = [
      createAssumption({
        category: 'revenue',
        type: 'recurring',
        amountMinor: 1000000,
        frequency: 'monthly',
        startMonth: '2025-01',
      }),
    ];
    const conservativeScenario = createScenario({
      name: 'Conservative',
      revenueMultiplier: 0.7,
    });

    const result = calculatePlan(plan, assumptions, conservativeScenario);

    // Revenue should be reduced by 30%
    expect(result.monthlyProjections[0].cashInMinor).toBe(700000);
  });
});
