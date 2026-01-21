// ============================================================================
// Milestone Service - Auto-generate milestones from deliverables
// ============================================================================

import { nanoid } from 'nanoid';
import type { Deliverable, Milestone } from '../types';

/**
 * Calculate evenly distributed dates between start and end
 * For n milestones: date[i] = start + round((i+1) * (duration / (n+1)))
 */
export function calculateMilestoneDates(
  count: number,
  startDate?: string,
  endDate?: string
): (string | undefined)[] {
  if (!startDate || !endDate || count === 0) {
    return Array(count).fill(undefined);
  }

  const start = new Date(startDate);
  const end = new Date(endDate);
  const duration = end.getTime() - start.getTime();

  if (duration <= 0) {
    return Array(count).fill(undefined);
  }

  const dates: string[] = [];
  for (let i = 0; i < count; i++) {
    const offset = Math.round(((i + 1) * duration) / (count + 1));
    const date = new Date(start.getTime() + offset);
    dates.push(date.toISOString().split('T')[0]);
  }

  return dates;
}

/**
 * Generate milestones from deliverables
 * Creates one milestone per deliverable with distributed dates
 */
export function generateMilestonesFromDeliverables(
  deliverables: Deliverable[],
  startDate?: string,
  endDate?: string,
  existingMilestones: Milestone[] = []
): Milestone[] {
  if (deliverables.length === 0) {
    return existingMilestones;
  }

  // Keep user-edited milestones
  const userEditedMilestones = existingMilestones.filter(m => m.userEdited);

  // Filter out deliverables that already have a user-edited milestone
  const userEditedDeliverableIds = new Set(
    userEditedMilestones.flatMap(m => m.generatedFromDeliverableId ? [m.generatedFromDeliverableId] : [])
  );

  const deliverablesNeedingMilestones = deliverables.filter(
    d => !userEditedDeliverableIds.has(d.id)
  );

  // Calculate dates for new milestones
  const dates = calculateMilestoneDates(
    deliverablesNeedingMilestones.length,
    startDate,
    endDate
  );

  // Create new milestones
  const newMilestones: Milestone[] = deliverablesNeedingMilestones.map((deliverable, index) => ({
    id: nanoid(),
    title: deliverable.description || `Milestone ${index + 1}`,
    targetDate: dates[index],
    deliverableIds: [deliverable.id],
    generated: true,
    userEdited: false,
    generatedFromDeliverableId: deliverable.id,
  }));

  // Combine user-edited with newly generated
  return [...userEditedMilestones, ...newMilestones];
}

/**
 * Mark a milestone as user-edited
 */
export function markMilestoneAsEdited(milestone: Milestone): Milestone {
  return {
    ...milestone,
    userEdited: true,
  };
}

/**
 * Check if a milestone was generated (not manually created)
 */
export function isGeneratedMilestone(milestone: Milestone): boolean {
  return milestone.generated === true;
}

/**
 * Remove milestones for removed deliverables (only non-user-edited ones)
 */
export function syncMilestonesWithDeliverables(
  milestones: Milestone[],
  deliverables: Deliverable[]
): Milestone[] {
  const deliverableIds = new Set(deliverables.map(d => d.id));

  return milestones.filter(milestone => {
    // Keep user-edited milestones
    if (milestone.userEdited) {
      return true;
    }

    // Keep milestones without a linked deliverable
    if (!milestone.generatedFromDeliverableId) {
      return true;
    }

    // Keep only if the deliverable still exists
    return deliverableIds.has(milestone.generatedFromDeliverableId);
  });
}
