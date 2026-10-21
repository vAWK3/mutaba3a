
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

// Law and accounting firm categories: the general list plus a firm's own costs
export const LAW_FIRM_CATEGORIES: CategoryTemplate[] = [
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
