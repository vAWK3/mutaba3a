/**
 * Demo Mode Constants
 *
 * Configuration constants for the demo/seed mode feature.
 */

// Seed value for deterministic PRNG (any number works, just needs to be consistent)
export const DEMO_SEED = 42;

// Prefix for all demo entity IDs (enables easy identification and cleanup)
export const DEMO_ID_PREFIX = 'demo_';

// LocalStorage key for demo mode state
export const DEMO_STATE_KEY = 'mini_crm_demo_mode';

// Query parameter to trigger demo mode activation
export const DEMO_QUERY_PARAM = 'demo';

// Confirmation word required to seed demo data
export const DEMO_CONFIRM_WORD = 'SEED';

// Entity-specific ID prefixes
export const DEMO_PREFIXES = {
  client: 'demo_client_',
  project: 'demo_project_',
  transaction: 'demo_tx_',
  document: 'demo_doc_',
  documentSequence: 'demo_doc_seq_',
  retainer: 'demo_retainer_',
  projectedIncome: 'demo_proj_income_',
  expense: 'demo_expense_',
  expenseCategory: 'demo_exp_cat_',
  recurringRule: 'demo_recurring_',
  businessProfile: 'demo_profile_',
  category: 'demo_category_',
} as const;

// Default frozen time for screenshots (mid-month for good demo data visibility)
// January 15, 2025 - shows overdue items from December and upcoming items
export const DEFAULT_FROZEN_TIME = '2025-01-15T12:00:00.000Z';

// Demo data configuration
export const DEMO_CONFIG = {
  // Number of entities to create
  clientCount: 10,
  projectCount: 15,
  transactionCount: 60, // ~10 per month for 6 months
  documentCount: 12,
  retainerCount: 3,
  expenseCount: 25,
  recurringRuleCount: 4,

  // Time range for demo data (6 months of history)
  monthsOfHistory: 6,

  // Currency distribution (70% ILS, 30% USD)
  ilsRatio: 0.7,
  usdRatio: 0.3,

  // Transaction status distribution
  paidRatio: 0.7,
  unpaidRatio: 0.2,
  overdueRatio: 0.1,
} as const;
