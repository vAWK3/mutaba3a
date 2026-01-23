/**
 * Demo Projected Income Generator
 *
 * Creates projected income entries from retainer agreements.
 * Includes past payments (received), current due, and upcoming.
 */

import type { ProjectedIncome, ProjectedIncomeState } from '../../types';
import { SeededRandom } from '../prng';
import { DEMO_SEED, DEMO_PREFIXES, DEFAULT_FROZEN_TIME } from '../constants';
import { getDemoProfileId } from './profile';
import { getDemoRetainerData } from './retainers';

const rng = new SeededRandom(DEMO_SEED + 3);

export function createDemoProjectedIncome(): ProjectedIncome[] {
  const profileId = getDemoProfileId();
  const retainers = getDemoRetainerData();
  const projectedIncomes: ProjectedIncome[] = [];

  // Use frozen time as reference for "today"
  const referenceDate = new Date(DEFAULT_FROZEN_TIME);
  const currentYear = referenceDate.getFullYear();
  const currentMonth = referenceDate.getMonth();

  let projectedIndex = 1;

  retainers.forEach((retainer) => {
    const isQuarterly = retainer.cadence === 'quarterly';
    const monthsToGenerate = isQuarterly ? 3 : 8; // Generate past + current + future

    for (let i = -6; i < monthsToGenerate - 6; i++) {
      // For quarterly, only generate every 3 months
      if (isQuarterly && i % 3 !== 0) continue;

      const periodMonth = new Date(currentYear, currentMonth + i, 1);
      const periodStart = periodMonth.toISOString().split('T')[0];

      let periodEndDate: Date;
      if (isQuarterly) {
        periodEndDate = new Date(currentYear, currentMonth + i + 3, 0);
      } else {
        periodEndDate = new Date(currentYear, currentMonth + i + 1, 0);
      }
      const periodEnd = periodEndDate.toISOString().split('T')[0];

      const expectedDate = new Date(
        currentYear,
        currentMonth + i,
        retainer.paymentDay
      ).toISOString().split('T')[0];

      // Determine state based on date relative to reference
      let state: ProjectedIncomeState;
      let receivedAmountMinor = 0;
      let receivedAt: string | undefined;
      const matchedTransactionIds: string[] = [];

      const expectedDateObj = new Date(expectedDate);
      const daysDiff = Math.floor(
        (referenceDate.getTime() - expectedDateObj.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (daysDiff > 7) {
        // Past - most are received, some missed
        if (rng.chance(0.9)) {
          state = 'received';
          receivedAmountMinor = retainer.amountMinor;
          receivedAt = new Date(
            expectedDateObj.getTime() + rng.int(0, 5) * 24 * 60 * 60 * 1000
          ).toISOString();
        } else {
          state = 'missed';
        }
      } else if (daysDiff > 0) {
        // Recently due - mostly received, some still due
        if (rng.chance(0.7)) {
          state = 'received';
          receivedAmountMinor = retainer.amountMinor;
          receivedAt = new Date(
            expectedDateObj.getTime() + rng.int(0, 3) * 24 * 60 * 60 * 1000
          ).toISOString();
        } else {
          state = 'due';
        }
      } else if (daysDiff >= -7) {
        // Due soon (within a week)
        state = 'due';
      } else {
        // Future
        state = 'upcoming';
      }

      const now = new Date().toISOString();

      projectedIncomes.push({
        id: `${DEMO_PREFIXES.projectedIncome}${String(projectedIndex++).padStart(3, '0')}`,
        profileId,
        sourceType: 'retainer',
        sourceId: retainer.id,
        clientId: retainer.clientId,
        projectId: retainer.projectId,
        currency: 'ILS',
        expectedAmountMinor: retainer.amountMinor,
        expectedDate,
        periodStart,
        periodEnd,
        state,
        receivedAmountMinor,
        receivedAt,
        matchedTransactionIds,
        createdAt: now,
        updatedAt: now,
      });
    }
  });

  return projectedIncomes;
}

export function getDemoProjectedIncomeIds(): string[] {
  const count = 20; // Approximate count
  return Array.from({ length: count }, (_, i) =>
    `${DEMO_PREFIXES.projectedIncome}${String(i + 1).padStart(3, '0')}`
  );
}
