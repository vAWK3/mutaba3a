/**
 * Demo Clients Generator
 *
 * Creates 10 realistic Arabic business clients with varied industries.
 */

import type { Client } from '../../types';
import { SeededRandom } from '../prng';
import { DEMO_SEED, DEMO_PREFIXES } from '../constants';

const rng = new SeededRandom(DEMO_SEED);

// Arabic business names with industries
const CLIENT_DATA = [
  { name: 'مطعم الشرق', industry: 'restaurant', email: 'info@alsharq.rest' },
  { name: 'مكتب المحاماة الدولي', industry: 'legal', email: 'contact@intlaw.co.il' },
  { name: 'عيادة الصحة الشاملة', industry: 'healthcare', email: 'clinic@health.co.il' },
  { name: 'شركة البناء الحديث', industry: 'construction', email: 'build@modern.co.il' },
  { name: 'مؤسسة التعليم المتميز', industry: 'education', email: 'edu@excellence.org' },
  { name: 'وكالة السفر والسياحة', industry: 'travel', email: 'travel@trips.co.il' },
  { name: 'مصنع الأثاث الفاخر', industry: 'manufacturing', email: 'sales@furniture.co.il' },
  { name: 'شركة التسويق الرقمي', industry: 'marketing', email: 'hello@digimarket.co.il' },
  { name: 'مركز اللياقة البدنية', industry: 'fitness', email: 'fit@gymcenter.co.il' },
  { name: 'محل الإلكترونيات', industry: 'retail', email: 'shop@electronics.co.il' },
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
