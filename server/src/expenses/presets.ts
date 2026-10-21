import type { ExpenseCategoryInput, ProfileType } from '../repositories/ports.js';
import type { ProfileWriter } from '../auth/writability.js';

/**
 * Expense category presets (MUT-42 D2). The general and law-firm ones are
 * copied from the offline app's `src/db/defaultExpenseCategories.ts` because
 * the server is a separate package; `presets.test.ts` reads that file and
 * fails if the two drift. The personal one (MAL-1118) is server-only: the
 * offline app has no personal profile to give it to.
 *
 * A hosted profile's first category list seeds one of them in the signed-in
 * user's language: law-firm (general plus legal and accounting costs) where
 * Malafat is the writer of record, personal on
 * a PERSONAL profile (MUT-120's, or one a person created as personal, MUT-182),
 * general on a BUSINESS one or any other firm.
 */
export interface CategoryTemplate {
  name: string;
  nameAr: string;
  color: string;
}

export const GENERAL_PRESET: readonly CategoryTemplate[] = [
  { name: 'Office Rent', nameAr: 'إيجار المكتب', color: '#6366f1' },
  { name: 'Utilities', nameAr: 'المرافق', color: '#8b5cf6' },
  { name: 'Software & Subscriptions', nameAr: 'البرمجيات والاشتراكات', color: '#3b82f6' },
  { name: 'AI Services', nameAr: 'خدمات الذكاء الاصطناعي', color: '#06b6d4' },
  { name: 'Cloud & Hosting', nameAr: 'الاستضافة والسحابة', color: '#0ea5e9' },
  { name: 'Communication', nameAr: 'الاتصالات', color: '#10b981' },
  { name: 'Marketing & Ads', nameAr: 'التسويق والإعلانات', color: '#f59e0b' },
  { name: 'Travel & Transport', nameAr: 'السفر والمواصلات', color: '#ef4444' },
  { name: 'Equipment & Hardware', nameAr: 'المعدات والأجهزة', color: '#ec4899' },
  { name: 'Professional Services', nameAr: 'الخدمات المهنية', color: '#14b8a6' },
  { name: 'Insurance', nameAr: 'التأمين', color: '#f97316' },
  { name: 'Bank Fees', nameAr: 'رسوم بنكية', color: '#64748b' },
  { name: 'Taxes & Licenses', nameAr: 'الضرائب والتراخيص', color: '#a855f7' },
  { name: 'Office Supplies', nameAr: 'مستلزمات المكتب', color: '#22c55e' },
  { name: 'Salaries', nameAr: 'معاشات', color: '#64748b' },
  { name: 'Other', nameAr: 'أخرى', color: '#78716c' },
];

/**
 * A Malafat-connected firm's list. Malafat serves law and accounting firms, so
 * it is the general business list with the costs only such a firm has added
 * before "Other" (Basel, 2026-10-22). Most of a firm's spending is ordinary
 * business spending; the old legal-only list had no utilities, software,
 * bank fees or taxes.
 */
export const LAW_FIRM_PRESET: readonly CategoryTemplate[] = [
  { name: 'Office Rent', nameAr: 'إيجار المكتب', color: '#6366f1' },
  { name: 'Utilities', nameAr: 'المرافق', color: '#8b5cf6' },
  { name: 'Software & Subscriptions', nameAr: 'البرمجيات والاشتراكات', color: '#3b82f6' },
  { name: 'AI Services', nameAr: 'خدمات الذكاء الاصطناعي', color: '#06b6d4' },
  { name: 'Cloud & Hosting', nameAr: 'الاستضافة والسحابة', color: '#0ea5e9' },
  { name: 'Communication', nameAr: 'الاتصالات', color: '#10b981' },
  { name: 'Marketing & Ads', nameAr: 'التسويق والإعلانات', color: '#f59e0b' },
  { name: 'Travel & Transport', nameAr: 'السفر والمواصلات', color: '#ef4444' },
  { name: 'Equipment & Hardware', nameAr: 'المعدات والأجهزة', color: '#ec4899' },
  { name: 'Professional Services', nameAr: 'الخدمات المهنية', color: '#14b8a6' },
  { name: 'Insurance', nameAr: 'التأمين', color: '#f97316' },
  { name: 'Bank Fees', nameAr: 'رسوم بنكية', color: '#64748b' },
  { name: 'Taxes & Licenses', nameAr: 'الضرائب والتراخيص', color: '#a855f7' },
  { name: 'Office Supplies', nameAr: 'مستلزمات المكتب', color: '#22c55e' },
  { name: 'Salaries', nameAr: 'معاشات', color: '#64748b' },
  { name: 'Court & Filing Fees', nameAr: 'رسوم المحاكم والتسجيل', color: '#b45309' },
  { name: 'Notary & Service Fees', nameAr: 'رسوم الكاتب العدل والتبليغ', color: '#0f766e' },
  { name: 'Experts & Translation', nameAr: 'الخبراء والترجمة', color: '#be185d' },
  { name: 'Professional Association Fees', nameAr: 'رسوم النقابات المهنية', color: '#7c3aed' },
  { name: 'Professional Liability Insurance', nameAr: 'تأمين المسؤولية المهنية', color: '#dc2626' },
  { name: 'Continuing Professional Education', nameAr: 'التعليم المهني المستمر', color: '#4f46e5' },
  { name: 'Other', nameAr: 'أخرى', color: '#78716c' },
];

/**
 * MAL-1118: a person's day-to-day spending, not a business ledger. MAL-1137
 * dropped "Projects" — a freelance-ledger item that didn't belong here — for
 * Shopping, Communications & Internet and Health & Insurance.
 */
export const PERSONAL_PRESET: readonly CategoryTemplate[] = [
  { name: 'Groceries', nameAr: 'البقالة', color: '#22c55e' },
  { name: 'Transportation', nameAr: 'المواصلات', color: '#0ea5e9' },
  { name: 'Car', nameAr: 'السيارة', color: '#ef4444' },
  { name: 'Rent', nameAr: 'الإيجار', color: '#6366f1' },
  { name: 'Shopping', nameAr: 'التسوق', color: '#f97316' },
  { name: 'Communications & Internet', nameAr: 'الاتصالات والإنترنت', color: '#3b82f6' },
  { name: 'Health & Insurance', nameAr: 'الصحة والتأمين', color: '#d946ef' },
  { name: 'Investments', nameAr: 'الاستثمارات', color: '#a855f7' },
  { name: 'Leisure', nameAr: 'الترفيه', color: '#f59e0b' },
  { name: 'Gifts', nameAr: 'الهدايا', color: '#ec4899' },
  { name: 'Supplies', nameAr: 'المستلزمات', color: '#14b8a6' },
  { name: 'Other', nameAr: 'أخرى', color: '#78716c' },
];

export type PresetName = 'lawFirm' | 'personal' | 'general';

const PRESETS: Record<PresetName, readonly CategoryTemplate[]> = { lawFirm: LAW_FIRM_PRESET, personal: PERSONAL_PRESET, general: GENERAL_PRESET };

/**
 * The profile's type picks the preset (MUT-182): PERSONAL — the MUT-120
 * profile, or one a person created as personal — gets the personal preset;
 * BUSINESS and every operator firm (type null) get the general one. Not "no
 * Malafat link" (ADR-066): a firm without one keeps the general preset, and
 * Malafat as writer of record wins over everything.
 */
export function presetFor(profile: { writerOfRecord: ProfileWriter; profileType: ProfileType | null }, locale: 'en' | 'ar'): { preset: PresetName; categories: ExpenseCategoryInput[] } {
  const preset: PresetName = profile.writerOfRecord === 'MALAFAT' ? 'lawFirm' : profile.profileType === 'PERSONAL' ? 'personal' : 'general';
  return { preset, categories: PRESETS[preset].map((t) => ({ name: locale === 'ar' ? t.nameAr : t.name, color: t.color })) };
}
