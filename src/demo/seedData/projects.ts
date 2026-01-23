/**
 * Demo Projects Generator
 *
 * Creates 15 realistic projects linked to demo clients.
 */

import type { Project } from '../../types';
import { SeededRandom } from '../prng';
import { DEMO_SEED, DEMO_PREFIXES } from '../constants';
import { getDemoClientIds } from './clients';

const rng = new SeededRandom(DEMO_SEED + 1); // Different seed for variety

// Project templates with client associations
const PROJECT_DATA = [
  { name: 'تصميم الموقع الإلكتروني', field: 'Design', clientIndex: 0 },
  { name: 'تطوير تطبيق الطلبات', field: 'Development', clientIndex: 0 },
  { name: 'إدارة القضايا القانونية', field: 'Legal', clientIndex: 1 },
  { name: 'نظام إدارة المرضى', field: 'Development', clientIndex: 2 },
  { name: 'تصميم الهوية البصرية', field: 'Design', clientIndex: 3 },
  { name: 'موقع التسجيل الإلكتروني', field: 'Development', clientIndex: 4 },
  { name: 'حملة إعلانية رقمية', field: 'Marketing', clientIndex: 5 },
  { name: 'نظام إدارة المخزون', field: 'Development', clientIndex: 6 },
  { name: 'استشارات تسويقية', field: 'Consulting', clientIndex: 7 },
  { name: 'تطبيق الحجز', field: 'Development', clientIndex: 8 },
  { name: 'متجر إلكتروني', field: 'Development', clientIndex: 9 },
  { name: 'صيانة الموقع الشهرية', field: 'Support', clientIndex: 0 },
  { name: 'تحسين محركات البحث', field: 'Marketing', clientIndex: 7 },
  { name: 'تصميم المطبوعات', field: 'Design', clientIndex: 3 },
  { name: 'تدريب الموظفين', field: 'Consulting', clientIndex: 4 },
] as const;

export function createDemoProjects(): Project[] {
  const clientIds = getDemoClientIds();
  const baseDate = new Date();
  baseDate.setMonth(baseDate.getMonth() - 7); // Created 7 months ago

  return PROJECT_DATA.map((data, index) => {
    const createdAt = new Date(baseDate);
    createdAt.setDate(createdAt.getDate() + rng.int(0, 45));

    return {
      id: `${DEMO_PREFIXES.project}${String(index + 1).padStart(3, '0')}`,
      name: data.name,
      clientId: clientIds[data.clientIndex],
      field: data.field,
      notes: `مشروع ${data.field} للعميل`,
      createdAt: createdAt.toISOString(),
      updatedAt: createdAt.toISOString(),
    };
  });
}

export function getDemoProjectIds(): string[] {
  return PROJECT_DATA.map((_, index) =>
    `${DEMO_PREFIXES.project}${String(index + 1).padStart(3, '0')}`
  );
}

export function getDemoProjectClientMap(): Map<string, string> {
  const clientIds = getDemoClientIds();
  const map = new Map<string, string>();

  PROJECT_DATA.forEach((data, index) => {
    const projectId = `${DEMO_PREFIXES.project}${String(index + 1).padStart(3, '0')}`;
    map.set(projectId, clientIds[data.clientIndex]);
  });

  return map;
}
