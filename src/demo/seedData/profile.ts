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
    primaryColor: '#2563eb',
    defaultCurrency: 'ILS' as const,
  },
  {
    id: '002',
    name: 'استوديو التصميم الإبداعي',
    nameEn: 'Creative Design Studio',
    email: 'hello@creativestudio.co.il',
    phone: '052-333-9876',
    primaryColor: '#8b5cf6',
    defaultCurrency: 'USD' as const,
  },
  {
    id: '003',
    name: 'مكتب الاستشارات المهنية',
    nameEn: 'Professional Consulting Office',
    email: 'consult@proconsult.co.il',
    phone: '050-777-4321',
    primaryColor: '#059669',
    defaultCurrency: 'ILS' as const,
  },
] as const;

interface CreateDemoProfilesOptions {
  /** A non-sample profile is already the default; the sample must not add a second. */
  existingDefault?: boolean;
}

export function createDemoProfiles({ existingDefault = false }: CreateDemoProfilesOptions = {}): BusinessProfile[] {
  const now = new Date().toISOString();

  return DEMO_PROFILES.map((profile, index) => ({
    id: `${DEMO_PREFIXES.businessProfile}${profile.id}`,
    name: profile.name,
    nameEn: profile.nameEn,
    email: profile.email,
    phone: profile.phone,
    primaryColor: profile.primaryColor,
    defaultCurrency: profile.defaultCurrency,
    isDefault: !existingDefault && index === 0, // First profile is default unless one already is
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
