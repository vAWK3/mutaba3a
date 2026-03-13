/**
 * Demo Retainer Agreements Generator
 *
 * Creates 3 realistic retainer agreements with active clients,
 * inheriting profileId from the associated client.
 */

import type { RetainerAgreement } from '../../types';
import { DEMO_PREFIXES } from '../constants';
import { getDemoClientIds, getDemoClientProfileMap } from './clients';
import { getDemoProjectIds } from './projects';
import { getDemoProfileIds } from './profile';

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
  const clientIds = getDemoClientIds();
  const clientProfileMap = getDemoClientProfileMap();
  const projectIds = getDemoProjectIds();

  // Start date 12 months ago (one full year)
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - 11);
  startDate.setDate(1);

  return RETAINER_DATA.map((data, index) => {
    const now = new Date().toISOString();
    const clientId = clientIds[data.clientIndex];
    const profileId = clientProfileMap.get(clientId) || getDemoProfileIds()[0];

    return {
      id: `${DEMO_PREFIXES.retainer}${String(index + 1).padStart(3, '0')}`,
      profileId,
      clientId,
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
  const clientProfileMap = getDemoClientProfileMap();
  const projectIds = getDemoProjectIds();

  return RETAINER_DATA.map((data, index) => {
    const clientId = clientIds[data.clientIndex];
    return {
      id: `${DEMO_PREFIXES.retainer}${String(index + 1).padStart(3, '0')}`,
      clientId,
      projectId: projectIds[data.projectIndex],
      profileId: clientProfileMap.get(clientId) || getDemoProfileIds()[0],
      amountMinor: data.amountILS * 100,
      cadence: data.cadence,
      paymentDay: data.paymentDay,
    };
  });
}
