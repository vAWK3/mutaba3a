/**
 * Demo Retainer Agreements Generator
 *
 * Creates 3 realistic retainer agreements with active clients.
 */

import type { RetainerAgreement } from '../../types';
import { DEMO_PREFIXES } from '../constants';
import { getDemoProfileId } from './profile';
import { getDemoClientIds } from './clients';
import { getDemoProjectIds } from './projects';

// Retainer configurations
const RETAINER_DATA = [
  {
    title: 'صيانة شهرية - مطعم الشرق',
    clientIndex: 0,
    projectIndex: 11, // صيانة الموقع الشهرية
    amountILS: 2500,
    cadence: 'monthly' as const,
    paymentDay: 1,
  },
  {
    title: 'دعم تقني - شركة التسويق',
    clientIndex: 7,
    projectIndex: 8, // استشارات تسويقية
    amountILS: 4000,
    cadence: 'monthly' as const,
    paymentDay: 15,
  },
  {
    title: 'استشارات ربع سنوية - مؤسسة التعليم',
    clientIndex: 4,
    projectIndex: 14, // تدريب الموظفين
    amountILS: 12000,
    cadence: 'quarterly' as const,
    paymentDay: 1,
  },
] as const;

export function createDemoRetainers(): RetainerAgreement[] {
  const profileId = getDemoProfileId();
  const clientIds = getDemoClientIds();
  const projectIds = getDemoProjectIds();

  // Start date 12 months ago (one full year)
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - 11);
  startDate.setDate(1);

  return RETAINER_DATA.map((data, index) => {
    const now = new Date().toISOString();

    return {
      id: `${DEMO_PREFIXES.retainer}${String(index + 1).padStart(3, '0')}`,
      profileId,
      clientId: clientIds[data.clientIndex],
      projectId: projectIds[data.projectIndex],
      title: data.title,
      currency: 'ILS',
      amountMinor: data.amountILS * 100,
      cadence: data.cadence,
      paymentDay: data.paymentDay,
      startDate: startDate.toISOString().split('T')[0],
      status: 'active',
      notes: `اتفاقية ${data.cadence === 'monthly' ? 'شهرية' : 'ربع سنوية'} مع العميل`,
      createdAt: now,
      updatedAt: now,
    };
  });
}

export function getDemoRetainerIds(): string[] {
  return RETAINER_DATA.map((_, index) =>
    `${DEMO_PREFIXES.retainer}${String(index + 1).padStart(3, '0')}`
  );
}

export function getDemoRetainerData() {
  const clientIds = getDemoClientIds();
  const projectIds = getDemoProjectIds();

  return RETAINER_DATA.map((data, index) => ({
    id: `${DEMO_PREFIXES.retainer}${String(index + 1).padStart(3, '0')}`,
    clientId: clientIds[data.clientIndex],
    projectId: projectIds[data.projectIndex],
    amountMinor: data.amountILS * 100,
    cadence: data.cadence,
    paymentDay: data.paymentDay,
  }));
}
