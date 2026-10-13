import type { ExpenseCategoryInput } from '../repositories/ports.js';
import type { ProfileWriter } from '../auth/writability.js';

/**
 * Expense category presets (MUT-42 D2). The general and law-firm ones are
 * copied from the offline app's `src/db/defaultExpenseCategories.ts` because
 * the server is a separate package; `presets.test.ts` reads that file and
 * fails if the two drift. The personal one (MAL-1118) is server-only: the
 * offline app has no personal profile to give it to.
 *
 * A hosted profile's first category list seeds one of them in the signed-in
 * user's language: law-firm where Malafat is the writer of record, personal on
 * a person's own profile (MUT-120), general on any other firm.
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

export const LAW_FIRM_PRESET: readonly CategoryTemplate[] = [
  { name: 'Office Rent', nameAr: 'إيجار المكتب', color: '#6366f1' },
  { name: 'Legal Research Tools', nameAr: 'أدوات البحث القانوني', color: '#3b82f6' },
  { name: 'Case Management Software', nameAr: 'برنامج إدارة القضايا', color: '#06b6d4' },
  { name: 'Bar Association Fees', nameAr: 'رسوم نقابة المحامين', color: '#a855f7' },
  { name: 'Continuing Legal Education', nameAr: 'التعليم القانوني المستمر', color: '#8b5cf6' },
  { name: 'Court Filing Fees', nameAr: 'رسوم تقديم المحكمة', color: '#f97316' },
  { name: 'Process Service', nameAr: 'خدمة الإجراءات', color: '#14b8a6' },
  { name: 'Expert Witnesses', nameAr: 'الشهود الخبراء', color: '#ec4899' },
  { name: 'Professional Liability Insurance', nameAr: 'تأمين المسؤولية المهنية', color: '#ef4444' },
  { name: 'Document Management', nameAr: 'إدارة المستندات', color: '#10b981' },
  { name: 'Client Entertainment', nameAr: 'ضيافة العملاء', color: '#f59e0b' },
  { name: 'Travel Expenses', nameAr: 'مصاريف السفر', color: '#0ea5e9' },
  { name: 'Office Supplies', nameAr: 'مستلزمات المكتب', color: '#22c55e' },
  { name: 'Communication', nameAr: 'الاتصالات', color: '#64748b' },
  { name: 'Salaries', nameAr: 'معاشات', color: '#64748b' },
  { name: 'Other', nameAr: 'أخرى', color: '#78716c' },
];

/** MAL-1118: a person's day-to-day spending, not a business ledger. */
export const PERSONAL_PRESET: readonly CategoryTemplate[] = [
  { name: 'Transportation', nameAr: 'المواصلات', color: '#0ea5e9' },
  { name: 'Car', nameAr: 'السيارة', color: '#ef4444' },
  { name: 'Rent', nameAr: 'الإيجار', color: '#6366f1' },
  { name: 'Groceries', nameAr: 'البقالة', color: '#22c55e' },
  { name: 'Supplies', nameAr: 'المستلزمات', color: '#14b8a6' },
  { name: 'Gifts', nameAr: 'الهدايا', color: '#ec4899' },
  { name: 'Investments', nameAr: 'الاستثمارات', color: '#a855f7' },
  { name: 'Projects', nameAr: 'المشاريع', color: '#3b82f6' },
  { name: 'Leisure', nameAr: 'الترفيه', color: '#f59e0b' },
  { name: 'Other', nameAr: 'أخرى', color: '#78716c' },
];

export type PresetName = 'lawFirm' | 'personal' | 'general';

const PRESETS: Record<PresetName, readonly CategoryTemplate[]> = { lawFirm: LAW_FIRM_PRESET, personal: PERSONAL_PRESET, general: GENERAL_PRESET };

/**
 * `personal` is the organization's MUT-120 mark (`personalOwnerUserId` set),
 * not "no Malafat link": a firm without one keeps the general preset.
 */
export function presetFor(profile: { writerOfRecord: ProfileWriter; personal: boolean }, locale: 'en' | 'ar'): { preset: PresetName; categories: ExpenseCategoryInput[] } {
  const preset: PresetName = profile.writerOfRecord === 'MALAFAT' ? 'lawFirm' : profile.personal ? 'personal' : 'general';
  return { preset, categories: PRESETS[preset].map((t) => ({ name: locale === 'ar' ? t.nameAr : t.name, color: t.color })) };
}
