import type { FeatureKey } from '../types';
/**
 * Demo/Seed Mode Types
 *
 * Types for the demo mode feature that populates the app with realistic
 * data for sales demos and website screenshots.
 */

// Demo mode state persisted in localStorage
export interface DemoModeState {
  isActive: boolean;
  seededAt?: string; // ISO timestamp when data was seeded
  frozenTime?: string; // ISO timestamp for screenshot mode
}

// Seeding status for UI feedback
export type SeedingStatus = 'idle' | 'seeding' | 'success' | 'error';

// Demo data statistics (returned after seeding)
export interface DemoDataStats {
  clients: number;
  projects: number;
  transactions: number;
  retainers: number;
  projectedIncome: number;
  expenses: number;
  expenseCategories: number;
  recurringRules: number;
  businessProfiles: number;
  /** Optional areas this seed switched on (MUT-12 auto-enable). */
  featuresEnabled: FeatureKey[];
}

// Entity prefixes for demo data identification
export type DemoEntityPrefix =
  | 'demo_client'
  | 'demo_project'
  | 'demo_tx'
  | 'demo_doc'
  | 'demo_retainer'
  | 'demo_proj_income'
  | 'demo_expense'
  | 'demo_exp_cat'
  | 'demo_recurring'
  | 'demo_profile'
  | 'demo_category'
  | 'demo_doc_seq';
