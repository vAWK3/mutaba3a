import type { ExpenseCategoryInput, ProfileType, UserLocale } from '../repositories/ports.js';
import { categoryNameKey } from './names.js';
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
  /** MUT-464: the entry's identity across languages and presets ("Other" is `other` everywhere). Never stored. */
  key: string;
  name: string;
  nameAr: string;
  color: string;
}

export const GENERAL_PRESET: readonly CategoryTemplate[] = [
  { key: 'office_rent', name: 'Office Rent', nameAr: 'إيجار المكتب', color: '#6366f1' },
  { key: 'utilities', name: 'Utilities', nameAr: 'المرافق', color: '#8b5cf6' },
  { key: 'software_subscriptions', name: 'Software & Subscriptions', nameAr: 'البرمجيات والاشتراكات', color: '#3b82f6' },
  { key: 'ai_services', name: 'AI Services', nameAr: 'خدمات الذكاء الاصطناعي', color: '#06b6d4' },
  { key: 'cloud_hosting', name: 'Cloud & Hosting', nameAr: 'الاستضافة والسحابة', color: '#0ea5e9' },
  { key: 'communication', name: 'Communication', nameAr: 'الاتصالات', color: '#10b981' },
  { key: 'marketing_ads', name: 'Marketing & Ads', nameAr: 'التسويق والإعلانات', color: '#f59e0b' },
  { key: 'travel_transport', name: 'Travel & Transport', nameAr: 'السفر والمواصلات', color: '#ef4444' },
  { key: 'equipment_hardware', name: 'Equipment & Hardware', nameAr: 'المعدات والأجهزة', color: '#ec4899' },
  { key: 'professional_services', name: 'Professional Services', nameAr: 'الخدمات المهنية', color: '#14b8a6' },
  { key: 'insurance', name: 'Insurance', nameAr: 'التأمين', color: '#f97316' },
  { key: 'bank_fees', name: 'Bank Fees', nameAr: 'رسوم بنكية', color: '#64748b' },
  { key: 'taxes_licenses', name: 'Taxes & Licenses', nameAr: 'الضرائب والتراخيص', color: '#a855f7' },
  { key: 'office_supplies', name: 'Office Supplies', nameAr: 'مستلزمات المكتب', color: '#22c55e' },
  { key: 'salaries', name: 'Salaries', nameAr: 'معاشات', color: '#64748b' },
  { key: 'other', name: 'Other', nameAr: 'أخرى', color: '#78716c' },
];

/**
 * A Malafat-connected firm's list. Malafat serves law and accounting firms, so
 * it is the general business list with the costs only such a firm has added
 * before "Other" (Basel, 2026-10-22). Most of a firm's spending is ordinary
 * business spending; the old legal-only list had no utilities, software,
 * bank fees or taxes.
 */
export const LAW_FIRM_PRESET: readonly CategoryTemplate[] = [
  { key: 'office_rent', name: 'Office Rent', nameAr: 'إيجار المكتب', color: '#6366f1' },
  { key: 'utilities', name: 'Utilities', nameAr: 'المرافق', color: '#8b5cf6' },
  { key: 'software_subscriptions', name: 'Software & Subscriptions', nameAr: 'البرمجيات والاشتراكات', color: '#3b82f6' },
  { key: 'ai_services', name: 'AI Services', nameAr: 'خدمات الذكاء الاصطناعي', color: '#06b6d4' },
  { key: 'cloud_hosting', name: 'Cloud & Hosting', nameAr: 'الاستضافة والسحابة', color: '#0ea5e9' },
  { key: 'communication', name: 'Communication', nameAr: 'الاتصالات', color: '#10b981' },
  { key: 'marketing_ads', name: 'Marketing & Ads', nameAr: 'التسويق والإعلانات', color: '#f59e0b' },
  { key: 'travel_transport', name: 'Travel & Transport', nameAr: 'السفر والمواصلات', color: '#ef4444' },
  { key: 'equipment_hardware', name: 'Equipment & Hardware', nameAr: 'المعدات والأجهزة', color: '#ec4899' },
  { key: 'professional_services', name: 'Professional Services', nameAr: 'الخدمات المهنية', color: '#14b8a6' },
  { key: 'insurance', name: 'Insurance', nameAr: 'التأمين', color: '#f97316' },
  { key: 'bank_fees', name: 'Bank Fees', nameAr: 'رسوم بنكية', color: '#64748b' },
  { key: 'taxes_licenses', name: 'Taxes & Licenses', nameAr: 'الضرائب والتراخيص', color: '#a855f7' },
  { key: 'office_supplies', name: 'Office Supplies', nameAr: 'مستلزمات المكتب', color: '#22c55e' },
  { key: 'salaries', name: 'Salaries', nameAr: 'معاشات', color: '#64748b' },
  { key: 'court_filing_fees', name: 'Court & Filing Fees', nameAr: 'رسوم المحاكم والتسجيل', color: '#b45309' },
  { key: 'notary_service_fees', name: 'Notary & Service Fees', nameAr: 'رسوم الكاتب العدل والتبليغ', color: '#0f766e' },
  { key: 'experts_translation', name: 'Experts & Translation', nameAr: 'الخبراء والترجمة', color: '#be185d' },
  { key: 'professional_association_fees', name: 'Professional Association Fees', nameAr: 'رسوم النقابات المهنية', color: '#7c3aed' },
  { key: 'professional_liability_insurance', name: 'Professional Liability Insurance', nameAr: 'تأمين المسؤولية المهنية', color: '#dc2626' },
  { key: 'continuing_professional_education', name: 'Continuing Professional Education', nameAr: 'التعليم المهني المستمر', color: '#4f46e5' },
  { key: 'other', name: 'Other', nameAr: 'أخرى', color: '#78716c' },
];

/**
 * MAL-1118: a person's day-to-day spending, not a business ledger. MAL-1137
 * dropped "Projects" — a freelance-ledger item that didn't belong here — for
 * Shopping, Communications & Internet and Health & Insurance.
 */
export const PERSONAL_PRESET: readonly CategoryTemplate[] = [
  { key: 'groceries', name: 'Groceries', nameAr: 'البقالة', color: '#22c55e' },
  { key: 'transportation', name: 'Transportation', nameAr: 'المواصلات', color: '#0ea5e9' },
  { key: 'car', name: 'Car', nameAr: 'السيارة', color: '#ef4444' },
  { key: 'rent', name: 'Rent', nameAr: 'الإيجار', color: '#6366f1' },
  { key: 'shopping', name: 'Shopping', nameAr: 'التسوق', color: '#f97316' },
  { key: 'communications_internet', name: 'Communications & Internet', nameAr: 'الاتصالات والإنترنت', color: '#3b82f6' },
  { key: 'health_insurance', name: 'Health & Insurance', nameAr: 'الصحة والتأمين', color: '#d946ef' },
  { key: 'investments', name: 'Investments', nameAr: 'الاستثمارات', color: '#a855f7' },
  { key: 'leisure', name: 'Leisure', nameAr: 'الترفيه', color: '#f59e0b' },
  { key: 'gifts', name: 'Gifts', nameAr: 'الهدايا', color: '#ec4899' },
  { key: 'supplies', name: 'Supplies', nameAr: 'المستلزمات', color: '#14b8a6' },
  { key: 'other', name: 'Other', nameAr: 'أخرى', color: '#78716c' },
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

/**
 * MUT-464 D5: names profiles were seeded with before a list changed. They are recognised so those categories follow
 * the viewer's language too, and never seeded again: the Malafat firm's legal-only list (replaced in ac9c6be6) and the
 * personal "Projects" (MAL-1137). Changing a live template's wording means moving the old pair here under the same key.
 */
export const RETIRED_TEMPLATES: readonly CategoryTemplate[] = [
  { key: 'legal_research_tools', name: 'Legal Research Tools', nameAr: 'أدوات البحث القانوني', color: '#3b82f6' },
  { key: 'case_management_software', name: 'Case Management Software', nameAr: 'برنامج إدارة القضايا', color: '#06b6d4' },
  { key: 'bar_association_fees', name: 'Bar Association Fees', nameAr: 'رسوم نقابة المحامين', color: '#a855f7' },
  { key: 'continuing_legal_education', name: 'Continuing Legal Education', nameAr: 'التعليم القانوني المستمر', color: '#8b5cf6' },
  { key: 'court_filing', name: 'Court Filing Fees', nameAr: 'رسوم تقديم المحكمة', color: '#f97316' },
  { key: 'process_service', name: 'Process Service', nameAr: 'خدمة الإجراءات', color: '#14b8a6' },
  { key: 'expert_witnesses', name: 'Expert Witnesses', nameAr: 'الشهود الخبراء', color: '#ec4899' },
  { key: 'document_management', name: 'Document Management', nameAr: 'إدارة المستندات', color: '#10b981' },
  { key: 'client_entertainment', name: 'Client Entertainment', nameAr: 'ضيافة العملاء', color: '#f59e0b' },
  { key: 'travel_expenses', name: 'Travel Expenses', nameAr: 'مصاريف السفر', color: '#0ea5e9' },
  { key: 'projects', name: 'Projects', nameAr: 'المشاريع', color: '#3b82f6' },
];

/** Live entries first, so a key shows its current wording; a retired wording only adds names that resolve to it. */
const NAMES_BY_KEY = new Map<string, { en: string; ar: string }>();
const KEY_BY_NAME_KEY = new Map<string, string>();
for (const t of [...GENERAL_PRESET, ...LAW_FIRM_PRESET, ...PERSONAL_PRESET, ...RETIRED_TEMPLATES]) {
  if (!NAMES_BY_KEY.has(t.key)) NAMES_BY_KEY.set(t.key, { en: t.name, ar: t.nameAr });
  KEY_BY_NAME_KEY.set(categoryNameKey(t.name), t.key);
  KEY_BY_NAME_KEY.set(categoryNameKey(t.nameAr), t.key);
}

/** MUT-464: the preset entry a stored category name is, in either language; null for a name a person typed. */
export function presetKeyForName(name: string): string | null {
  return KEY_BY_NAME_KEY.get(categoryNameKey(name)) ?? null;
}

/**
 * MUT-464: categories as the viewer reads them. A seeded name shows in `lang`; a typed one as typed. When two rows
 * are the same entry (an "Other" next to an "أخرى" from before the cross-language check), only the oldest follows the
 * language and carries `presetKey`, so the list never shows one name twice. Order is kept.
 */
export function displayCategoryNames<T extends { id: string; name: string; createdAt: Date }>(rows: readonly T[], lang: UserLocale): Array<T & { presetKey: string | null }> {
  const holders = new Map<string, T>();
  for (const row of rows) {
    const key = presetKeyForName(row.name);
    if (key === null) continue;
    const held = holders.get(key);
    if (!held || row.createdAt < held.createdAt || (row.createdAt.getTime() === held.createdAt.getTime() && row.id < held.id)) holders.set(key, row);
  }
  return rows.map((row) => {
    const key = presetKeyForName(row.name);
    if (key === null || holders.get(key) !== row) return { ...row, presetKey: null };
    const names = NAMES_BY_KEY.get(key)!;
    return { ...row, name: lang === 'ar' ? names.ar : names.en, presetKey: key };
  });
}
