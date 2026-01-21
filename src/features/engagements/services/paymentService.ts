// ============================================================================
// Payment Service - Auto-fill payment schedule
// ============================================================================

import { nanoid } from 'nanoid';
import type { Milestone, Deliverable, PaymentScheduleItem, PaymentTrigger } from '../types';
import type { Currency } from '../../../types';

const MAX_PAYMENTS_FROM_MILESTONES = 6;

/**
 * Generate payment schedule from milestones
 * Max 6 payments, groups if more milestones exist
 */
export function generateFromMilestones(
  milestones: Milestone[],
  totalAmountMinor: number,
  currency: Currency
): PaymentScheduleItem[] {
  if (milestones.length === 0 || totalAmountMinor <= 0) {
    return [];
  }

  const milestonesToUse = milestones.slice(0, MAX_PAYMENTS_FROM_MILESTONES);
  const amountPerPayment = Math.floor(totalAmountMinor / milestonesToUse.length);
  const remainder = totalAmountMinor - (amountPerPayment * milestonesToUse.length);

  return milestonesToUse.map((milestone, index) => ({
    id: nanoid(),
    label: milestone.title || `Payment ${index + 1}`,
    trigger: 'on_milestone' as PaymentTrigger,
    milestoneId: milestone.id,
    amountMinor: amountPerPayment + (index === milestonesToUse.length - 1 ? remainder : 0),
    currency,
    generated: true,
    userEdited: false,
    generatedFromMilestoneId: milestone.id,
  }));
}

/**
 * Generate payment schedule from deliverables (fallback when no milestones)
 */
export function generateFromDeliverables(
  deliverables: Deliverable[],
  totalAmountMinor: number,
  currency: Currency
): PaymentScheduleItem[] {
  if (deliverables.length === 0 || totalAmountMinor <= 0) {
    return [];
  }

  const deliverablesCount = Math.min(deliverables.length, MAX_PAYMENTS_FROM_MILESTONES);
  const amountPerPayment = Math.floor(totalAmountMinor / deliverablesCount);
  const remainder = totalAmountMinor - (amountPerPayment * deliverablesCount);

  return deliverables.slice(0, deliverablesCount).map((deliverable, index) => ({
    id: nanoid(),
    label: deliverable.description || `Payment ${index + 1}`,
    trigger: 'on_completion' as PaymentTrigger,
    amountMinor: amountPerPayment + (index === deliverablesCount - 1 ? remainder : 0),
    currency,
    generated: true,
    userEdited: false,
  }));
}

/**
 * Generate default 30/40/30 payment split
 */
export function generateDefaultSplit(
  totalAmountMinor: number,
  currency: Currency,
  language: 'en' | 'ar' = 'en'
): PaymentScheduleItem[] {
  if (totalAmountMinor <= 0) {
    return [];
  }

  const labels = {
    en: {
      deposit: 'Deposit (30%)',
      agreement: 'Agreement (40%)',
      completion: 'Completion (30%)',
    },
    ar: {
      deposit: 'الدفعة الأولى (30%)',
      agreement: 'الاتفاق (40%)',
      completion: 'عند الإنجاز (30%)',
    },
  };

  const deposit = Math.round(totalAmountMinor * 0.3);
  const agreement = Math.round(totalAmountMinor * 0.4);
  const completion = totalAmountMinor - deposit - agreement;

  return [
    {
      id: nanoid(),
      label: labels[language].deposit,
      trigger: 'on_signing' as PaymentTrigger,
      amountMinor: deposit,
      currency,
      generated: true,
      userEdited: false,
    },
    {
      id: nanoid(),
      label: labels[language].agreement,
      trigger: 'on_milestone' as PaymentTrigger,
      amountMinor: agreement,
      currency,
      generated: true,
      userEdited: false,
    },
    {
      id: nanoid(),
      label: labels[language].completion,
      trigger: 'on_completion' as PaymentTrigger,
      amountMinor: completion,
      currency,
      generated: true,
      userEdited: false,
    },
  ];
}

/**
 * Generate payment schedule with priority:
 * 1. From milestones (if any, max 6)
 * 2. From deliverables (fallback)
 * 3. Default 30/40/30 split (final fallback)
 */
export function generatePaymentSchedule(
  milestones: Milestone[],
  deliverables: Deliverable[],
  totalAmountMinor: number,
  currency: Currency,
  existingSchedule: PaymentScheduleItem[] = [],
  language: 'en' | 'ar' = 'en'
): PaymentScheduleItem[] {
  // Keep user-edited items
  const userEditedItems = existingSchedule.filter(item => item.userEdited);

  // Calculate remaining amount after user-edited items
  const userEditedTotal = userEditedItems.reduce((sum, item) => sum + item.amountMinor, 0);
  const remainingAmount = totalAmountMinor - userEditedTotal;

  if (remainingAmount <= 0) {
    return userEditedItems;
  }

  // Generate new items based on priority
  let newItems: PaymentScheduleItem[];

  if (milestones.length > 0) {
    // Filter out milestones already covered by user-edited items
    const coveredMilestoneIds = new Set(
      userEditedItems.filter(i => i.generatedFromMilestoneId).map(i => i.generatedFromMilestoneId)
    );
    const uncoveredMilestones = milestones.filter(m => !coveredMilestoneIds.has(m.id));

    newItems = generateFromMilestones(uncoveredMilestones, remainingAmount, currency);
  } else if (deliverables.length > 0) {
    newItems = generateFromDeliverables(deliverables, remainingAmount, currency);
  } else {
    newItems = generateDefaultSplit(remainingAmount, currency, language);
  }

  return [...userEditedItems, ...newItems];
}

/**
 * Reset payment schedule (force regeneration)
 */
export function resetPaymentSchedule(
  milestones: Milestone[],
  deliverables: Deliverable[],
  totalAmountMinor: number,
  currency: Currency,
  language: 'en' | 'ar' = 'en'
): PaymentScheduleItem[] {
  return generatePaymentSchedule(
    milestones,
    deliverables,
    totalAmountMinor,
    currency,
    [], // Empty existing to force full regeneration
    language
  );
}

/**
 * Mark a payment item as user-edited
 */
export function markPaymentAsEdited(payment: PaymentScheduleItem): PaymentScheduleItem {
  return {
    ...payment,
    userEdited: true,
  };
}

/**
 * Check if auto-fill should happen
 */
export function shouldAutoFillSchedule(
  scheduleItems: PaymentScheduleItem[],
  totalAmountMinor: number
): boolean {
  return scheduleItems.length === 0 && totalAmountMinor > 0;
}
