/**
 * Demo Clients Generator
 *
 * Creates 10 realistic Arabic business clients with varied industries,
 * distributed across multiple business profiles.
 */

import type { Client } from '../../types';
import { SeededRandom } from '../prng';
import { DEMO_SEED, DEMO_PREFIXES } from '../constants';
import { getDemoProfileIdByIndex } from './profile';

const rng = new SeededRandom(DEMO_SEED);

// Arabic business names with industries and profile assignment
// Profile 0 (Tech): tech-related clients
// Profile 1 (Design): creative/design clients
// Profile 2 (Consulting): business/professional clients
const CLIENT_DATA = [
  { name: 'مطعم الشرق', industry: 'restaurant', email: 'info@alsharq.rest', profileIndex: 0 },
  { name: 'مكتب المحاماة الدولي', industry: 'legal', email: 'contact@intlaw.co.il', profileIndex: 2 },
  { name: 'عيادة الصحة الشاملة', industry: 'healthcare', email: 'clinic@health.co.il', profileIndex: 2 },
  { name: 'شركة البناء الحديث', industry: 'construction', email: 'build@modern.co.il', profileIndex: 0 },
  { name: 'مؤسسة التعليم المتميز', industry: 'education', email: 'edu@excellence.org', profileIndex: 2 },
  { name: 'وكالة السفر والسياحة', industry: 'travel', email: 'travel@trips.co.il', profileIndex: 1 },
  { name: 'مصنع الأثاث الفاخر', industry: 'manufacturing', email: 'sales@furniture.co.il', profileIndex: 1 },
  { name: 'شركة التسويق الرقمي', industry: 'marketing', email: 'hello@digimarket.co.il', profileIndex: 1 },
  { name: 'مركز اللياقة البدنية', industry: 'fitness', email: 'fit@gymcenter.co.il', profileIndex: 0 },
  { name: 'محل الإلكترونيات', industry: 'retail', email: 'shop@electronics.co.il', profileIndex: 0 },
] as const;

export function createDemoClients(): Client[] {
  const baseDate = new Date();
  baseDate.setMonth(baseDate.getMonth() - 8); // Created 8 months ago

  return CLIENT_DATA.map((data, index) => {
    const createdAt = new Date(baseDate);
    createdAt.setDate(createdAt.getDate() + rng.int(0, 30));

    return {
      id: `${DEMO_PREFIXES.client}${String(index + 1).padStart(3, '0')}`,
      name: data.name,
      email: data.email,
      phone: rng.phoneNumber(),
      notes: `عميل في قطاع ${getIndustryArabic(data.industry)}`,
      profileId: getDemoProfileIdByIndex(data.profileIndex),
      createdAt: createdAt.toISOString(),
      updatedAt: createdAt.toISOString(),
    };
  });
}

export function getDemoClientIds(): string[] {
  return CLIENT_DATA.map((_, index) =>
    `${DEMO_PREFIXES.client}${String(index + 1).padStart(3, '0')}`
  );
}

/**
 * Get a map of client ID to profile ID for multi-profile support
 */
export function getDemoClientProfileMap(): Map<string, string> {
  const map = new Map<string, string>();
  CLIENT_DATA.forEach((data, index) => {
    const clientId = `${DEMO_PREFIXES.client}${String(index + 1).padStart(3, '0')}`;
    map.set(clientId, getDemoProfileIdByIndex(data.profileIndex));
  });
  return map;
}

function getIndustryArabic(industry: string): string {
  const map: Record<string, string> = {
    restaurant: 'المطاعم',
    legal: 'القانون',
    healthcare: 'الصحة',
    construction: 'البناء',
    education: 'التعليم',
    travel: 'السياحة',
    manufacturing: 'التصنيع',
    marketing: 'التسويق',
    fitness: 'اللياقة',
    retail: 'التجزئة',
  };
  return map[industry] || industry;
}
