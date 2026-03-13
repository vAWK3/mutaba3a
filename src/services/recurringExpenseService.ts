/**
 * Recurring Expense Service
 *
 * Service layer for recurring expense operations. Orchestrates between
 * repositories and implements business logic for virtual occurrence
 * computation, payment confirmation, skipping, and snoozing.
 *
 * @see .claude/designs/recurring-expenses.md for design decisions
 */

import type {
  RecurringRule,
  RecurringOccurrence,
  VirtualOccurrenceDisplay,
  ComputedOccurrenceState,
  Currency,
  Expense,
} from '../types';
import {
  recurringRuleRepo,
  recurringOccurrenceRepo,
  expenseRepo,
  expenseCategoryRepo,
  vendorRepo,
} from '../db/expenseRepository';
import { projectRepo } from '../db';

// ============================================================================
// Date Helpers
// ============================================================================

function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}

function nowISO(): string {
  return new Date().toISOString();
}

/**
 * Parse ISO date string to local date parts (avoids timezone issues)
 */
function parseISODate(isoString: string): { year: number; month: number; day: number } {
  const [year, month, day] = isoString.split('-').map(Number);
  return { year, month, day }; // month is 1-indexed here
}

/**
 * Format date parts to ISO string
 */
function formatISODate(year: number, month: number, day: number): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * Get the last day of a month
 */
function getLastDayOfMonth(year: number, month: number): number {
  // month is 1-indexed
  return new Date(year, month, 0).getDate();
}

/**
 * Create an ISO date for a specific day of month, clamping to valid day
 */
function createDateForDayOfMonth(year: number, month: number, dayOfMonth: number): string {
  // month is 1-indexed
  const lastDay = getLastDayOfMonth(year, month);
  const clampedDay = Math.min(dayOfMonth, lastDay);
  return formatISODate(year, month, clampedDay);
}

/**
 * Add months to a date (1-indexed month)
 */
function addMonthsToDate(year: number, month: number, monthsToAdd: number): { year: number; month: number } {
  let newMonth = month + monthsToAdd;
  let newYear = year;

  while (newMonth > 12) {
    newMonth -= 12;
    newYear += 1;
  }
  while (newMonth < 1) {
    newMonth += 12;
    newYear -= 1;
  }

  return { year: newYear, month: newMonth };
}

/**
 * Get days between two dates
 */
function daysBetween(dateA: string, dateB: string): number {
  const a = parseISODate(dateA);
  const b = parseISODate(dateB);
  const dateAMs = new Date(a.year, a.month - 1, a.day).getTime();
  const dateBMs = new Date(b.year, b.month - 1, b.day).getTime();
  return Math.floor((dateAMs - dateBMs) / (1000 * 60 * 60 * 24));
}

// ============================================================================
// Core Service Functions
// ============================================================================

/**
 * Generate expected occurrence dates for a recurring rule within a date range.
 *
 * @param rule - The recurring rule
 * @param startDate - Start of date range (ISO string, inclusive)
 * @param endDate - End of date range (ISO string, inclusive)
 * @returns Array of ISO date strings
 */
export function generateExpectedDates(
  rule: RecurringRule,
  startDate: string,
  endDate: string
): string[] {
  const dates: string[] = [];

  // Determine effective start date (max of rule.startDate and requested startDate)
  const effectiveStart = rule.startDate > startDate ? rule.startDate : startDate;

  // Determine effective end date based on rule's end mode
  let effectiveEnd = endDate;
  if (rule.endMode === 'endOfYear') {
    const ruleStartParsed = parseISODate(rule.startDate);
    const yearEnd = `${ruleStartParsed.year}-12-31`;
    if (yearEnd < effectiveEnd) {
      effectiveEnd = yearEnd;
    }
  } else if (rule.endMode === 'untilDate' && rule.endDate) {
    if (rule.endDate < effectiveEnd) {
      effectiveEnd = rule.endDate;
    }
  }
  // 'noEnd' - no modification needed

  const startParsed = parseISODate(effectiveStart);

  if (rule.frequency === 'monthly') {
    // Start from the first occurrence in the effective range
    let currentYear = startParsed.year;
    let currentMonth = startParsed.month;

    let currentDate = createDateForDayOfMonth(currentYear, currentMonth, rule.dayOfMonth);

    // If the created date is before effectiveStart, move to next month
    if (currentDate < effectiveStart) {
      const next = addMonthsToDate(currentYear, currentMonth, 1);
      currentYear = next.year;
      currentMonth = next.month;
      currentDate = createDateForDayOfMonth(currentYear, currentMonth, rule.dayOfMonth);
    }

    while (currentDate <= effectiveEnd) {
      dates.push(currentDate);
      const next = addMonthsToDate(currentYear, currentMonth, 1);
      currentYear = next.year;
      currentMonth = next.month;
      currentDate = createDateForDayOfMonth(currentYear, currentMonth, rule.dayOfMonth);
    }
  } else if (rule.frequency === 'yearly') {
    const monthOfYear = rule.monthOfYear ?? 1; // 1-indexed

    let currentYear = startParsed.year;
    let currentDate = createDateForDayOfMonth(currentYear, monthOfYear, rule.dayOfMonth);

    // If the created date is before effectiveStart, move to next year
    if (currentDate < effectiveStart) {
      currentYear += 1;
      currentDate = createDateForDayOfMonth(currentYear, monthOfYear, rule.dayOfMonth);
    }

    while (currentDate <= effectiveEnd) {
      dates.push(currentDate);
      currentYear += 1;
      currentDate = createDateForDayOfMonth(currentYear, monthOfYear, rule.dayOfMonth);
    }
  }

  return dates;
}

/**
 * Compute the display state for an occurrence based on date and persisted state.
 *
 * @param expectedDate - The expected date of the occurrence
 * @param reminderDaysBefore - Days before due to show as "due"
 * @param persisted - The persisted occurrence if any
 * @returns The computed display state
 */
export function computeState(
  expectedDate: string,
  reminderDaysBefore: number,
  persisted?: RecurringOccurrence
): ComputedOccurrenceState {
  // If persisted and resolved, the state is determined by status
  if (persisted) {
    if (persisted.status === 'resolved_paid' || persisted.status === 'resolved_skipped') {
      // These are terminal states - the UI will show them differently
      // For virtual occurrence, we don't generate these
      return 'projected';
    }
    if (persisted.status === 'snoozed' && persisted.snoozeUntil) {
      const today = todayISO();
      // If still within snooze period, show as projected
      if (today < persisted.snoozeUntil) {
        return 'projected';
      }
      // Snooze expired - fall through to normal logic
    }
  }

  const today = todayISO();
  const daysUntil = daysBetween(expectedDate, today);

  if (daysUntil < 0) {
    // Past the expected date
    return 'overdue';
  } else if (daysUntil <= reminderDaysBefore) {
    // Within reminder window
    return 'due';
  } else {
    // Future
    return 'projected';
  }
}

/**
 * Get virtual occurrences for a profile within a date range.
 * Merges computed dates with persisted occurrences.
 *
 * @param profileId - The business profile ID
 * @param dateFrom - Start date (ISO string)
 * @param dateTo - End date (ISO string)
 * @returns Array of virtual occurrences with display data
 */
export async function getVirtualOccurrences(
  profileId: string,
  dateFrom: string,
  dateTo: string
): Promise<VirtualOccurrenceDisplay[]> {
  // Get active rules for the profile
  const rules = await recurringRuleRepo.listActive(profileId);

  // Get persisted occurrences in the date range
  const persistedOccurrences = await recurringOccurrenceRepo.list({
    profileId,
    dateFrom,
    dateTo,
  });

  // Build lookup map: ruleId+expectedDate -> occurrence
  const persistedMap = new Map<string, RecurringOccurrence>();
  for (const occ of persistedOccurrences) {
    persistedMap.set(`${occ.ruleId}:${occ.expectedDate}`, occ);
  }

  // Load categories, vendors, projects for display names
  const categories = await expenseCategoryRepo.list(profileId);
  const vendors = await vendorRepo.list(profileId);
  const projects = await projectRepo.list({ profileId });

  const categoryMap = new Map(categories.map((c) => [c.id, c]));
  const vendorMap = new Map(vendors.map((v) => [v.id, v]));
  const projectMap = new Map(projects.map((p) => [p.id, p]));

  const results: VirtualOccurrenceDisplay[] = [];
  const today = todayISO();

  for (const rule of rules) {
    // Generate expected dates for this rule
    const expectedDates = generateExpectedDates(rule, dateFrom, dateTo);

    for (const expectedDate of expectedDates) {
      const key = `${rule.id}:${expectedDate}`;
      const persisted = persistedMap.get(key);

      // Skip if already resolved
      if (persisted && (persisted.status === 'resolved_paid' || persisted.status === 'resolved_skipped')) {
        continue;
      }

      const computedState = computeState(expectedDate, rule.reminderDaysBefore, persisted);
      const daysUntilDue = daysBetween(expectedDate, today);

      // Resolve display names
      const category = rule.categoryId ? categoryMap.get(rule.categoryId) : undefined;
      const vendor = rule.vendorId ? vendorMap.get(rule.vendorId) : undefined;
      const project = rule.projectId ? projectMap.get(rule.projectId) : undefined;

      const occurrence: VirtualOccurrenceDisplay = {
        ruleId: rule.id,
        profileId: rule.profileId,
        expectedDate,
        amountMinor: persisted?.actualAmountMinor ?? rule.amountMinor,
        currency: rule.currency,
        computedState,
        persistedOccurrence: persisted,

        // Resolved names
        ruleTitle: rule.title,
        vendor: rule.vendor,
        vendorName: vendor?.canonicalName,
        categoryId: rule.categoryId,
        categoryName: category?.name,
        categoryColor: category?.color,
        projectId: rule.projectId,
        projectName: project?.name,

        // Computed
        daysUntilDue,
        isOverdue: computedState === 'overdue',
        isUpcoming: computedState === 'due',

        // Display helpers
        effectiveAmount: persisted?.actualAmountMinor ?? rule.amountMinor,
        effectiveCurrency: rule.currency,
      };

      results.push(occurrence);
    }
  }

  // Sort by expected date
  results.sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));

  return results;
}

/**
 * Get due and overdue occurrences for attention display.
 *
 * @param profileId - The business profile ID
 * @returns Array of virtual occurrences that need attention
 */
export async function getDueOccurrences(
  profileId: string
): Promise<VirtualOccurrenceDisplay[]> {
  // Look back 90 days for overdue, look ahead 30 days for upcoming
  const dateFrom = new Date(new Date().setDate(new Date().getDate() - 90))
    .toISOString()
    .split('T')[0];
  const dateTo = new Date(new Date().setDate(new Date().getDate() + 30))
    .toISOString()
    .split('T')[0];

  const allOccurrences = await getVirtualOccurrences(profileId, dateFrom, dateTo);

  // Filter to only due and overdue
  return allOccurrences.filter(
    (occ) => occ.computedState === 'due' || occ.computedState === 'overdue'
  );
}

// ============================================================================
// Action Functions
// ============================================================================

export interface ConfirmPaymentParams {
  ruleId: string;
  profileId: string;
  expectedDate: string;
  amountMinor?: number;          // Override amount
  actualPaidDate?: string;       // Actual payment date
  notes?: string;
}

/**
 * Confirm payment for a recurring expense occurrence.
 * Creates an Expense and marks the occurrence as resolved_paid.
 *
 * @param params - Payment confirmation parameters
 * @returns The created expense
 */
export async function confirmPayment(params: ConfirmPaymentParams): Promise<Expense> {
  const { ruleId, profileId, expectedDate, amountMinor, actualPaidDate, notes } = params;

  // Get the rule
  const rule = await recurringRuleRepo.get(ruleId);
  if (!rule) {
    throw new Error(`Recurring rule not found: ${ruleId}`);
  }

  // Determine effective values
  const effectiveAmount = amountMinor ?? rule.amountMinor;
  const effectiveDate = actualPaidDate ?? expectedDate;
  const effectiveNotes = notes ?? rule.notes;

  // Create the expense
  const expense = await expenseRepo.create({
    profileId,
    title: rule.title,
    vendor: rule.vendor,
    vendorId: rule.vendorId,
    categoryId: rule.categoryId,
    amountMinor: effectiveAmount,
    currency: rule.currency,
    occurredAt: effectiveDate,
    notes: effectiveNotes,
    recurringRuleId: ruleId,
    // recurringOccurrenceId will be set after creating occurrence
  });

  // Check if a persisted occurrence already exists
  let occurrence = await recurringOccurrenceRepo.getByRuleAndDate(ruleId, expectedDate);

  if (occurrence) {
    // Update existing occurrence
    await recurringOccurrenceRepo.update(occurrence.id, {
      status: 'resolved_paid',
      fulfilledExpenseId: expense.id,
      resolvedAt: nowISO(),
      actualAmountMinor: amountMinor,
      actualPaidDate,
      notes,
    });
  } else {
    // Create new occurrence
    occurrence = await recurringOccurrenceRepo.create({
      ruleId,
      profileId,
      expectedDate,
      amountMinorSnapshot: rule.amountMinor,
      currencySnapshot: rule.currency,
      status: 'resolved_paid',
      fulfilledExpenseId: expense.id,
      resolvedAt: nowISO(),
      actualAmountMinor: amountMinor,
      actualPaidDate,
      notes,
    });
  }

  // Update expense with occurrence reference
  await expenseRepo.update(expense.id, {
    recurringOccurrenceId: occurrence.id,
  });

  return { ...expense, recurringOccurrenceId: occurrence.id };
}

export interface SkipOccurrenceParams {
  ruleId: string;
  profileId: string;
  expectedDate: string;
  notes?: string;
}

/**
 * Skip a recurring expense occurrence.
 * Marks the occurrence as resolved_skipped without creating an expense.
 */
export async function skipOccurrence(params: SkipOccurrenceParams): Promise<RecurringOccurrence> {
  const { ruleId, profileId, expectedDate, notes } = params;

  // Get the rule for snapshot values
  const rule = await recurringRuleRepo.get(ruleId);
  if (!rule) {
    throw new Error(`Recurring rule not found: ${ruleId}`);
  }

  // Check if a persisted occurrence already exists
  let occurrence = await recurringOccurrenceRepo.getByRuleAndDate(ruleId, expectedDate);

  if (occurrence) {
    // Update existing occurrence
    await recurringOccurrenceRepo.update(occurrence.id, {
      status: 'resolved_skipped',
      resolvedAt: nowISO(),
      notes,
      snoozeUntil: undefined, // Clear snooze if any
    });
    occurrence = await recurringOccurrenceRepo.get(occurrence.id);
  } else {
    // Create new occurrence
    occurrence = await recurringOccurrenceRepo.create({
      ruleId,
      profileId,
      expectedDate,
      amountMinorSnapshot: rule.amountMinor,
      currencySnapshot: rule.currency,
      status: 'resolved_skipped',
      resolvedAt: nowISO(),
      notes,
    });
  }

  return occurrence!;
}

export interface SnoozeOccurrenceParams {
  ruleId: string;
  profileId: string;
  expectedDate: string;
  snoozeUntil: string;            // ISO date string
  notes?: string;
}

/**
 * Snooze a recurring expense occurrence until a future date.
 * The occurrence will resurface after the snooze period.
 */
export async function snoozeOccurrence(params: SnoozeOccurrenceParams): Promise<RecurringOccurrence> {
  const { ruleId, profileId, expectedDate, snoozeUntil, notes } = params;

  // Validate snooze date is in the future
  const today = todayISO();
  if (snoozeUntil <= today) {
    throw new Error('Snooze date must be in the future');
  }

  // Get the rule for snapshot values
  const rule = await recurringRuleRepo.get(ruleId);
  if (!rule) {
    throw new Error(`Recurring rule not found: ${ruleId}`);
  }

  // Check if a persisted occurrence already exists
  let occurrence = await recurringOccurrenceRepo.getByRuleAndDate(ruleId, expectedDate);

  if (occurrence) {
    // Can only snooze non-resolved occurrences
    if (occurrence.status === 'resolved_paid' || occurrence.status === 'resolved_skipped') {
      throw new Error('Cannot snooze a resolved occurrence');
    }

    // Update existing occurrence
    await recurringOccurrenceRepo.update(occurrence.id, {
      status: 'snoozed',
      snoozeUntil,
      notes,
    });
    occurrence = await recurringOccurrenceRepo.get(occurrence.id);
  } else {
    // Create new occurrence with snoozed status
    occurrence = await recurringOccurrenceRepo.create({
      ruleId,
      profileId,
      expectedDate,
      amountMinorSnapshot: rule.amountMinor,
      currencySnapshot: rule.currency,
      status: 'snoozed',
      snoozeUntil,
      notes,
    });
  }

  return occurrence!;
}

// ============================================================================
// Rule Management Functions
// ============================================================================

export interface CreateRecurringRuleParams {
  profileId: string;
  title: string;
  vendor?: string;
  vendorId?: string;
  categoryId?: string;
  amountMinor: number;
  currency: Currency;
  frequency: 'monthly' | 'yearly';
  dayOfMonth: number;
  monthOfYear?: number;
  startDate: string;
  endMode: 'endOfYear' | 'untilDate' | 'noEnd';
  endDate?: string;
  projectId?: string;
  scope?: 'general' | 'project';
  notes?: string;
  reminderDaysBefore?: number;
}

/**
 * Create a new recurring expense rule.
 */
export async function createRecurringRule(params: CreateRecurringRuleParams): Promise<RecurringRule> {
  // Validate dayOfMonth
  if (params.dayOfMonth < 1 || params.dayOfMonth > 28) {
    throw new Error('Day of month must be between 1 and 28');
  }

  // Validate monthOfYear for yearly frequency
  if (params.frequency === 'yearly' && !params.monthOfYear) {
    throw new Error('Month of year is required for yearly frequency');
  }
  if (params.monthOfYear && (params.monthOfYear < 1 || params.monthOfYear > 12)) {
    throw new Error('Month of year must be between 1 and 12');
  }

  return recurringRuleRepo.create({
    profileId: params.profileId,
    title: params.title,
    vendor: params.vendor,
    vendorId: params.vendorId,
    categoryId: params.categoryId,
    amountMinor: params.amountMinor,
    currency: params.currency,
    frequency: params.frequency,
    dayOfMonth: params.dayOfMonth,
    monthOfYear: params.monthOfYear,
    startDate: params.startDate,
    endMode: params.endMode,
    endDate: params.endDate,
    projectId: params.projectId,
    scope: params.scope ?? 'general',
    notes: params.notes,
    reminderDaysBefore: params.reminderDaysBefore ?? 0,
    isPaused: false,
  });
}

/**
 * Get occurrence history for a rule with resolved display data.
 */
export async function getRuleHistory(
  ruleId: string
): Promise<RecurringOccurrence[]> {
  return recurringOccurrenceRepo.getHistoryForRule(ruleId);
}
