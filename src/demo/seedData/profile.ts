/**
 * Demo Business Profile Generator
 *
 * Creates a realistic Arabic/English bilingual freelancer business profile.
 */

import type { BusinessProfile } from '../../types';
import { DEMO_PREFIXES } from '../constants';

export function createDemoProfile(): BusinessProfile {
  const now = new Date().toISOString();

  return {
    id: `${DEMO_PREFIXES.businessProfile}001`,
    name: 'شركة التقنية المتقدمة',
    nameEn: 'Advanced Tech Solutions',
    email: 'info@advtech.co.il',
    phone: '054-555-1234',
    taxId: '514789632',
    businessType: 'authorized',
    address1: 'شارع يافا 120',
    address1En: '120 Jaffa Street',
    city: 'حيفا',
    cityEn: 'Haifa',
    country: 'إسرائيل',
    countryEn: 'Israel',
    postalCode: '3100001',
    primaryColor: '#2563eb',
    defaultCurrency: 'ILS',
    defaultLanguage: 'ar',
    isDefault: true,
    website: 'https://advtech.co.il',
    defaultTemplateId: 'template1',
    defaultTaxRate: 0.17,
    allowedCurrencies: ['ILS', 'USD'],
    bankName: 'بنك لئومي',
    bankBranch: '001',
    bankAccountNumber: '12345678',
    bankIban: 'IL620108000000012345678',
    paymentNotes: 'الدفع خلال 30 يوم من تاريخ الفاتورة',
    createdAt: now,
    updatedAt: now,
  };
}

export function getDemoProfileId(): string {
  return `${DEMO_PREFIXES.businessProfile}001`;
}
