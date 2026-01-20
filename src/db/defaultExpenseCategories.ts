import { expenseCategoryRepo } from './expenseRepository';

interface CategoryTemplate {
  name: string;
  nameAr: string;
  color: string;
}

// General business categories
export const GENERAL_CATEGORIES: CategoryTemplate[] = [
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

// Startup-specific categories
export const STARTUP_CATEGORIES: CategoryTemplate[] = [
  { name: 'Office Rent', nameAr: 'إيجار المكتب', color: '#6366f1' },
  { name: 'Coworking Space', nameAr: 'مساحة عمل مشتركة', color: '#8b5cf6' },
  { name: 'AI Services', nameAr: 'خدمات الذكاء الاصطناعي', color: '#06b6d4' },
  { name: 'Cloud Infrastructure', nameAr: 'البنية السحابية', color: '#0ea5e9' },
  { name: 'SaaS Subscriptions', nameAr: 'اشتراكات SaaS', color: '#3b82f6' },
  { name: 'Development Tools', nameAr: 'أدوات التطوير', color: '#10b981' },
  { name: 'Domain & Hosting', nameAr: 'النطاق والاستضافة', color: '#14b8a6' },
  { name: 'Marketing & Growth', nameAr: 'التسويق والنمو', color: '#f59e0b' },
  { name: 'Legal & Compliance', nameAr: 'القانوني والامتثال', color: '#a855f7' },
  { name: 'Accounting Services', nameAr: 'خدمات المحاسبة', color: '#ec4899' },
  { name: 'Equipment', nameAr: 'المعدات', color: '#ef4444' },
  { name: 'Team Perks', nameAr: 'امتيازات الفريق', color: '#22c55e' },
  { name: 'Contractor Payments', nameAr: 'مدفوعات المتعاقدين', color: '#f97316' },
  { name: 'Salaries', nameAr: 'معاشات', color: '#64748b' },
  { name: 'Bank & Payment Fees', nameAr: 'رسوم بنكية ومدفوعات', color: '#64748b' },
  { name: 'Other', nameAr: 'أخرى', color: '#78716c' },
];

// Law firm categories
export const LAW_FIRM_CATEGORIES: CategoryTemplate[] = [
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

// Freelancer categories
export const FREELANCER_CATEGORIES: CategoryTemplate[] = [
  { name: 'Software & Tools', nameAr: 'البرمجيات والأدوات', color: '#3b82f6' },
  { name: 'AI Services', nameAr: 'خدمات الذكاء الاصطناعي', color: '#06b6d4' },
  { name: 'Cloud Storage', nameAr: 'التخزين السحابي', color: '#0ea5e9' },
  { name: 'Communication Tools', nameAr: 'أدوات الاتصال', color: '#10b981' },
  { name: 'Domain & Hosting', nameAr: 'النطاق والاستضافة', color: '#14b8a6' },
  { name: 'Coworking Space', nameAr: 'مساحة عمل مشتركة', color: '#6366f1' },
  { name: 'Marketing', nameAr: 'التسويق', color: '#f59e0b' },
  { name: 'Equipment', nameAr: 'المعدات', color: '#ef4444' },
  { name: 'Professional Development', nameAr: 'التطوير المهني', color: '#a855f7' },
  { name: 'Accounting & Tax', nameAr: 'المحاسبة والضرائب', color: '#ec4899' },
  { name: 'Bank & Payment Fees', nameAr: 'رسوم بنكية ومدفوعات', color: '#64748b' },
  { name: 'Other', nameAr: 'أخرى', color: '#78716c' },
];

// Combined list of all unique categories from all presets (deduplicated by name)
const allCategoriesMap = new Map<string, CategoryTemplate>();
[...GENERAL_CATEGORIES, ...STARTUP_CATEGORIES, ...LAW_FIRM_CATEGORIES, ...FREELANCER_CATEGORIES]
  .forEach(cat => {
    if (!allCategoriesMap.has(cat.name)) {
      allCategoriesMap.set(cat.name, cat);
    }
  });

export const ALL_CATEGORIES: CategoryTemplate[] = Array.from(allCategoriesMap.values());

export type CategoryPreset = 'general' | 'startup' | 'lawFirm' | 'freelancer';

const PRESET_MAP: Record<CategoryPreset, CategoryTemplate[]> = {
  general: GENERAL_CATEGORIES,
  startup: STARTUP_CATEGORIES,
  lawFirm: LAW_FIRM_CATEGORIES,
  freelancer: FREELANCER_CATEGORIES,
};

/**
 * Seed default expense categories for a profile
 * @param profileId - The business profile ID
 * @param preset - Which category preset to use
 * @param language - 'en' or 'ar' for category names
 */
export async function seedExpenseCategories(
  profileId: string,
  preset: CategoryPreset = 'general',
  language: 'en' | 'ar' = 'en'
): Promise<void> {
  const categories = PRESET_MAP[preset];

  for (const cat of categories) {
    await expenseCategoryRepo.create({
      profileId,
      name: language === 'ar' ? cat.nameAr : cat.name,
      color: cat.color,
    });
  }
}

/**
 * Get category templates for a preset (without creating them)
 */
export function getCategoryTemplates(
  preset: CategoryPreset = 'general',
  language: 'en' | 'ar' = 'en'
): Array<{ name: string; color: string }> {
  const categories = PRESET_MAP[preset];
  return categories.map((cat) => ({
    name: language === 'ar' ? cat.nameAr : cat.name,
    color: cat.color,
  }));
}
