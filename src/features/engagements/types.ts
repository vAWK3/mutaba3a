// ============================================================================
// Engagement Kit Types
// ============================================================================

import type { Currency } from '../../types';

// Engagement type (task-based vs. ongoing retainer)
export type EngagementType = 'task' | 'retainer';

// Engagement category (service area)
export type EngagementCategory =
  | 'design'
  | 'development'
  | 'consulting'
  | 'legal'
  | 'marketing'
  | 'other';

// Engagement status
export type EngagementStatus = 'draft' | 'final' | 'archived';

// Document language
export type EngagementLanguage = 'en' | 'ar';

// Dispute resolution path
export type DisputePath = 'negotiation' | 'mediation' | 'arbitration';

// Term type for relationship
export type TermType = 'fixed' | 'month-to-month';

// Rollover rule for retainer capacity
export type RolloverRule = 'none' | 'carry' | 'expire';

// Payment trigger types
export type PaymentTrigger =
  | 'on_signing'
  | 'on_milestone'
  | 'on_completion'
  | 'monthly';

// ============================================================================
// Main Entities
// ============================================================================

/**
 * Engagement - Main engagement agreement entity
 */
export interface Engagement {
  id: string;
  profileId: string;
  clientId: string;
  projectId?: string;
  type: EngagementType;
  category: EngagementCategory;
  primaryLanguage: EngagementLanguage;
  status: EngagementStatus;
  currentVersionId?: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

/**
 * EngagementVersion - Immutable snapshot of engagement at a point in time
 */
export interface EngagementVersion {
  id: string;
  engagementId: string;
  versionNumber: number;
  status: 'draft' | 'final';
  snapshot: EngagementSnapshot;
  createdAt: string;
}

// ============================================================================
// Engagement Snapshot (Full Form State)
// ============================================================================

/**
 * Deliverable source type
 */
export type DeliverableSource = 'preset' | 'custom';

/**
 * Deliverable - A specific work item/output
 */
export interface Deliverable {
  id: string;
  description: string;
  quantity?: number;
  format?: string;
  // Input reduction fields
  source?: DeliverableSource;
  presetId?: string;
}

/**
 * Milestone - Project checkpoint with target date
 */
export interface Milestone {
  id: string;
  title: string;
  targetDate?: string;
  deliverableIds: string[];
  // Input reduction fields
  generated?: boolean;
  userEdited?: boolean;
  generatedFromDeliverableId?: string;
}

/**
 * PaymentScheduleItem - Payment entry in the schedule
 */
export interface PaymentScheduleItem {
  id: string;
  label: string;
  trigger: PaymentTrigger;
  milestoneId?: string;
  amountMinor: number;
  currency: Currency;
  // Input reduction fields
  generated?: boolean;
  userEdited?: boolean;
  generatedFromMilestoneId?: string;
}

/**
 * EngagementSnapshot - Complete form state stored as JSON
 */
export interface EngagementSnapshot {
  // Step 0-1: Profile, Client & Summary
  profileId: string;
  profileName: string;
  clientId: string;
  clientName: string;
  projectId?: string;
  projectName?: string;
  title: string;
  summary: string;
  clientGoal?: string;

  // Step 2: Scope
  deliverables: Deliverable[];
  exclusions: string[];
  dependencies: string[];

  // Step 3: Timeline
  startDate?: string;
  endDate?: string;
  milestones: Milestone[];
  reviewWindowDays: number;
  silenceEqualsApproval: boolean;

  // Step 4: Reviews (task) or Capacity (retainer)
  revisionRounds: number;
  revisionDefinition: string[];
  bugFixDays?: number;
  changeRequestRule: boolean;
  // Retainer-specific
  scopeCategories?: string[];
  monthlyCapacity?: string;
  responseTimeDays?: number;

  // Step 5: Payment
  currency: Currency;
  totalAmountMinor?: number;
  depositPercent?: number;
  scheduleItems: PaymentScheduleItem[];
  lateFeeEnabled: boolean;
  // Retainer-specific
  retainerAmountMinor?: number;
  billingDay?: number;
  rolloverRule?: RolloverRule;
  outOfScopeRateMinor?: number;

  // Step 6: Relationship
  termType: TermType;
  terminationNoticeDays: number;
  cancellationCoveragePercent?: number;
  ownershipTransferRule: string;

  // Step 7: Standard Terms (toggles)
  confidentiality: boolean;
  ipOwnership: boolean;
  warrantyDisclaimer: boolean;
  limitationOfLiability: boolean;
  nonSolicitation: boolean;
  disputePath: DisputePath;
  governingLaw?: string;

  // Input reduction tracking
  defaultsApplied?: boolean;
  defaultsVersion?: string;
}

// ============================================================================
// Display Types
// ============================================================================

/**
 * EngagementDisplay - Engagement with resolved names for display
 */
export interface EngagementDisplay extends Engagement {
  profileName?: string;
  clientName?: string;
  projectName?: string;
  title?: string;
  versionCount: number;
  lastVersionAt?: string;
}

// ============================================================================
// Filter Types
// ============================================================================

/**
 * EngagementFilters - Query filters for engagements
 */
export interface EngagementFilters {
  profileId?: string;
  clientId?: string;
  projectId?: string;
  type?: EngagementType;
  status?: EngagementStatus;
  category?: EngagementCategory;
  search?: string;
  includeArchived?: boolean;
  limit?: number;
  offset?: number;
  sort?: { by: string; dir: 'asc' | 'desc' };
}

// ============================================================================
// Clarity Check Types
// ============================================================================

/**
 * ClarityRisk - A flagged risk/warning from clarity check
 */
export interface ClarityRisk {
  id: string;
  severity: 'high' | 'medium' | 'low';
  stepIndex: number;
  fieldPath: string;
  messageKey: string; // i18n key for the message
}

// ============================================================================
// Wizard State Types
// ============================================================================

/**
 * WizardStep - Steps in the engagement wizard
 */
export type WizardStep =
  | 0 // Client Setup
  | 1 // Summary
  | 2 // Scope
  | 3 // Timeline
  | 4 // Reviews
  | 5 // Payment
  | 6 // Relationship
  | 7 // Standard Terms
  | 8; // Review & Export

/**
 * WizardMode - Create or edit mode
 */
export type WizardMode = 'create' | 'edit';

// ============================================================================
// Default Values
// ============================================================================

export const DEFAULT_SNAPSHOT: EngagementSnapshot = {
  profileId: '',
  profileName: '',
  clientId: '',
  clientName: '',
  title: '',
  summary: '',
  deliverables: [],
  exclusions: [],
  dependencies: [],
  milestones: [],
  reviewWindowDays: 3,
  silenceEqualsApproval: false,
  revisionRounds: 2,
  revisionDefinition: [],
  changeRequestRule: true,
  currency: 'USD',
  scheduleItems: [],
  lateFeeEnabled: false,
  termType: 'fixed',
  terminationNoticeDays: 14,
  ownershipTransferRule: 'upon_full_payment',
  confidentiality: true,
  ipOwnership: true,
  warrantyDisclaimer: true,
  limitationOfLiability: true,
  nonSolicitation: false,
  disputePath: 'negotiation',
};
