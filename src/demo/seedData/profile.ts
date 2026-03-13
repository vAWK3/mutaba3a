/**
 * Demo Business Profile Generator
 *
 * Creates multiple realistic Arabic/English bilingual business profiles
 * to demonstrate multi-profile functionality.
 */

import type { BusinessProfile } from '../../types';
import { DEMO_PREFIXES } from '../constants';

// Profile definitions for multi-profile demo
const DEMO_PROFILES = [
  {
    id: '001',
    name: 'شركة التقنية المتقدمة',
    nameEn: 'Advanced Tech Solutions',
    email: 'info@advtech.co.il',
    phone: '054-555-1234',
    taxId: '514789632',
    businessType: 'authorized' as const,
    address1: 'شارع يافا 120',
    address1En: '120 Jaffa Street',
    city: 'حيفا',
    cityEn: 'Haifa',
    primaryColor: '#2563eb',
    defaultCurrency: 'ILS' as const,
    website: 'https://advtech.co.il',
    bankName: 'بنك لئومي',
    bankBranch: '001',
    bankAccountNumber: '12345678',
    bankIban: 'IL620108000000012345678',
  },
  {
    id: '002',
    name: 'استوديو التصميم الإبداعي',
    nameEn: 'Creative Design Studio',
    email: 'hello@creativestudio.co.il',
    phone: '052-333-9876',
    taxId: '523456789',
    businessType: 'exempt' as const,
    address1: 'شارع هرتسل 45',
    address1En: '45 Herzl Street',
    city: 'تل أبيب',
    cityEn: 'Tel Aviv',
    primaryColor: '#8b5cf6',
    defaultCurrency: 'USD' as const,
    website: 'https://creativestudio.co.il',
    bankName: 'بنك هبوعليم',
    bankBranch: '012',
    bankAccountNumber: '87654321',
    bankIban: 'IL620127000000087654321',
  },
  {
    id: '003',
    name: 'مكتب الاستشارات المهنية',
    nameEn: 'Professional Consulting Office',
    email: 'consult@proconsult.co.il',
    phone: '050-777-4321',
    taxId: '534567890',
    businessType: 'company' as const,
    address1: 'برج الأعمال، طابق 12',
    address1En: 'Business Tower, Floor 12',
    city: 'القدس',
    cityEn: 'Jerusalem',
    primaryColor: '#059669',
    defaultCurrency: 'ILS' as const,
    website: 'https://proconsult.co.il',
    bankName: 'بنك ديسكونت',
    bankBranch: '005',
    bankAccountNumber: '11223344',
    bankIban: 'IL620115000000011223344',
  },
] as const;

export function createDemoProfiles(): BusinessProfile[] {
  const now = new Date().toISOString();

  return DEMO_PROFILES.map((profile, index) => ({
    id: `${DEMO_PREFIXES.businessProfile}${profile.id}`,
    name: profile.name,
    nameEn: profile.nameEn,
    email: profile.email,
    phone: profile.phone,
    taxId: profile.taxId,
    businessType: profile.businessType,
    address1: profile.address1,
    address1En: profile.address1En,
    city: profile.city,
    cityEn: profile.cityEn,
    country: 'إسرائيل',
    countryEn: 'Israel',
    postalCode: `310000${index + 1}`,
    primaryColor: profile.primaryColor,
    defaultCurrency: profile.defaultCurrency,
    defaultLanguage: 'ar' as const,
    isDefault: index === 0, // First profile is default
    website: profile.website,
    defaultTemplateId: 'template1',
    defaultTaxRate: 0.17,
    allowedCurrencies: ['ILS', 'USD'],
    bankName: profile.bankName,
    bankBranch: profile.bankBranch,
    bankAccountNumber: profile.bankAccountNumber,
    bankIban: profile.bankIban,
    paymentNotes: 'الدفع خلال 30 يوم من تاريخ الفاتورة',
    createdAt: now,
    updatedAt: now,
  }));
}

/** @deprecated Use createDemoProfiles() for multi-profile support */
export function createDemoProfile(): BusinessProfile {
  return createDemoProfiles()[0];
}

export function getDemoProfileIds(): string[] {
  return DEMO_PROFILES.map((p) => `${DEMO_PREFIXES.businessProfile}${p.id}`);
}

/** @deprecated Use getDemoProfileIds() for multi-profile support */
export function getDemoProfileId(): string {
  return getDemoProfileIds()[0];
}

/**
 * Get profile ID by index (for distributing entities across profiles)
 */
export function getDemoProfileIdByIndex(index: number): string {
  const ids = getDemoProfileIds();
  return ids[index % ids.length];
}

/**
 * Get the number of demo profiles
 */
export function getDemoProfileCount(): number {
  return DEMO_PROFILES.length;
}
