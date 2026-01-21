// ============================================================================
// Scope Presets by Category
// ============================================================================

import type { ScopePresetsMap, BilingualText, DeliverablePreset } from './types';

/**
 * Default dependencies for each category
 */
const DESIGN_DEPENDENCIES: BilingualText[] = [
  { en: 'Brand guidelines', ar: 'إرشادات العلامة التجارية' },
  { en: 'Content copy', ar: 'المحتوى النصي' },
  { en: 'Logo assets (vector format)', ar: 'ملفات الشعار (بصيغة فيكتور)' },
  { en: 'Image assets', ar: 'الصور والوسائط' },
  { en: 'Access to existing design files', ar: 'الوصول لملفات التصميم الحالية' },
];

const DEVELOPMENT_DEPENDENCIES: BilingualText[] = [
  { en: 'API documentation', ar: 'توثيق واجهات البرمجة' },
  { en: 'Server/hosting access', ar: 'الوصول للخادم/الاستضافة' },
  { en: 'Database credentials', ar: 'بيانات قاعدة البيانات' },
  { en: 'Design mockups', ar: 'تصاميم الواجهات' },
  { en: 'Functional requirements', ar: 'المتطلبات الوظيفية' },
];

const LEGAL_DEPENDENCIES: BilingualText[] = [
  { en: 'Relevant contracts and agreements', ar: 'العقود والاتفاقيات ذات الصلة' },
  { en: 'Business registration documents', ar: 'وثائق تسجيل الشركة' },
  { en: 'Identification documents', ar: 'وثائق الهوية' },
  { en: 'Previous correspondence', ar: 'المراسلات السابقة' },
];

const CONSULTING_DEPENDENCIES: BilingualText[] = [
  { en: 'Access to key stakeholders', ar: 'الوصول لأصحاب المصلحة الرئيسيين' },
  { en: 'Relevant internal documents', ar: 'المستندات الداخلية ذات الصلة' },
  { en: 'Current process documentation', ar: 'توثيق العمليات الحالية' },
  { en: 'Financial data (if applicable)', ar: 'البيانات المالية (إن وجدت)' },
];

const MARKETING_DEPENDENCIES: BilingualText[] = [
  { en: 'Brand guidelines', ar: 'إرشادات العلامة التجارية' },
  { en: 'Target audience profiles', ar: 'ملفات الجمهور المستهدف' },
  { en: 'Competitor analysis', ar: 'تحليل المنافسين' },
  { en: 'Access to analytics', ar: 'الوصول للتحليلات' },
  { en: 'Social media credentials', ar: 'بيانات حسابات التواصل الاجتماعي' },
];

const OTHER_DEPENDENCIES: BilingualText[] = [
  { en: 'Project requirements document', ar: 'وثيقة متطلبات المشروع' },
  { en: 'Access to relevant stakeholders', ar: 'الوصول لأصحاب المصلحة' },
];

/**
 * Default exclusions for each category
 */
const DESIGN_EXCLUSIONS: BilingualText[] = [
  { en: 'Photography or photo shoots', ar: 'التصوير الفوتوغرافي' },
  { en: 'Copywriting or content creation', ar: 'كتابة المحتوى' },
  { en: 'Development or coding', ar: 'البرمجة والتطوير' },
  { en: 'Print production', ar: 'الإنتاج الطباعي' },
  { en: 'Stock images or fonts licensing', ar: 'ترخيص الصور والخطوط' },
];

const DEVELOPMENT_EXCLUSIONS: BilingualText[] = [
  { en: 'UI/UX design', ar: 'تصميم الواجهات' },
  { en: 'Content creation', ar: 'إنشاء المحتوى' },
  { en: 'Server hosting fees', ar: 'رسوم الاستضافة' },
  { en: 'Third-party API costs', ar: 'تكاليف واجهات الطرف الثالث' },
  { en: 'Ongoing maintenance', ar: 'الصيانة المستمرة' },
];

const LEGAL_EXCLUSIONS: BilingualText[] = [
  { en: 'Court representation', ar: 'التمثيل أمام المحاكم' },
  { en: 'Government filing fees', ar: 'رسوم التسجيل الحكومية' },
  { en: 'Notarization costs', ar: 'تكاليف التوثيق' },
  { en: 'Translation services', ar: 'خدمات الترجمة' },
];

const CONSULTING_EXCLUSIONS: BilingualText[] = [
  { en: 'Implementation of recommendations', ar: 'تنفيذ التوصيات' },
  { en: 'Ongoing operational support', ar: 'الدعم التشغيلي المستمر' },
  { en: 'Staff training', ar: 'تدريب الموظفين' },
  { en: 'Technology procurement', ar: 'شراء التقنيات' },
];

const MARKETING_EXCLUSIONS: BilingualText[] = [
  { en: 'Ad spend budget', ar: 'ميزانية الإعلانات' },
  { en: 'Video production', ar: 'إنتاج الفيديو' },
  { en: 'Influencer fees', ar: 'أتعاب المؤثرين' },
  { en: 'Print production', ar: 'الإنتاج الطباعي' },
  { en: 'Event management', ar: 'إدارة الفعاليات' },
];

const OTHER_EXCLUSIONS: BilingualText[] = [
  { en: 'Ongoing support after delivery', ar: 'الدعم المستمر بعد التسليم' },
  { en: 'Third-party costs', ar: 'تكاليف الأطراف الثالثة' },
];

/**
 * Deliverable presets for each category
 */
const DESIGN_DELIVERABLES: DeliverablePreset[] = [
  { id: 'logo-design', description: { en: 'Logo design', ar: 'تصميم الشعار' }, defaultQuantity: 1 },
  { id: 'brand-guidelines', description: { en: 'Brand guidelines document', ar: 'دليل الهوية البصرية' }, defaultQuantity: 1, defaultFormat: 'PDF' },
  { id: 'website-mockup', description: { en: 'Website mockup', ar: 'تصميم الموقع' }, defaultQuantity: 1, defaultFormat: 'Figma' },
  { id: 'mobile-mockup', description: { en: 'Mobile app mockup', ar: 'تصميم التطبيق' }, defaultQuantity: 1, defaultFormat: 'Figma' },
  { id: 'social-templates', description: { en: 'Social media templates', ar: 'قوالب التواصل الاجتماعي' }, defaultQuantity: 5, defaultFormat: 'PNG/PSD' },
  { id: 'business-card', description: { en: 'Business card design', ar: 'تصميم بطاقة العمل' }, defaultQuantity: 1 },
  { id: 'presentation', description: { en: 'Presentation template', ar: 'قالب العرض التقديمي' }, defaultQuantity: 1, defaultFormat: 'PPTX' },
  { id: 'icon-set', description: { en: 'Custom icon set', ar: 'مجموعة أيقونات مخصصة' }, defaultQuantity: 10, defaultFormat: 'SVG' },
];

const DEVELOPMENT_DELIVERABLES: DeliverablePreset[] = [
  { id: 'website', description: { en: 'Responsive website', ar: 'موقع متجاوب' }, defaultQuantity: 1 },
  { id: 'mobile-app', description: { en: 'Mobile application', ar: 'تطبيق جوال' }, defaultQuantity: 1 },
  { id: 'web-app', description: { en: 'Web application', ar: 'تطبيق ويب' }, defaultQuantity: 1 },
  { id: 'api', description: { en: 'API development', ar: 'تطوير واجهة برمجية' }, defaultQuantity: 1 },
  { id: 'database', description: { en: 'Database design & setup', ar: 'تصميم وإعداد قاعدة البيانات' }, defaultQuantity: 1 },
  { id: 'integration', description: { en: 'Third-party integration', ar: 'تكامل مع طرف ثالث' }, defaultQuantity: 1 },
  { id: 'testing', description: { en: 'Testing & QA', ar: 'الاختبار وضمان الجودة' }, defaultQuantity: 1 },
  { id: 'documentation', description: { en: 'Technical documentation', ar: 'التوثيق الفني' }, defaultQuantity: 1, defaultFormat: 'MD' },
];

const LEGAL_DELIVERABLES: DeliverablePreset[] = [
  { id: 'contract-draft', description: { en: 'Contract draft', ar: 'مسودة العقد' }, defaultQuantity: 1, defaultFormat: 'DOCX' },
  { id: 'contract-review', description: { en: 'Contract review', ar: 'مراجعة العقد' }, defaultQuantity: 1 },
  { id: 'legal-opinion', description: { en: 'Legal opinion', ar: 'الرأي القانوني' }, defaultQuantity: 1, defaultFormat: 'PDF' },
  { id: 'terms-conditions', description: { en: 'Terms & conditions', ar: 'الشروط والأحكام' }, defaultQuantity: 1 },
  { id: 'privacy-policy', description: { en: 'Privacy policy', ar: 'سياسة الخصوصية' }, defaultQuantity: 1 },
  { id: 'nda', description: { en: 'NDA draft', ar: 'اتفاقية السرية' }, defaultQuantity: 1 },
  { id: 'incorporation', description: { en: 'Incorporation documents', ar: 'وثائق التأسيس' }, defaultQuantity: 1 },
];

const CONSULTING_DELIVERABLES: DeliverablePreset[] = [
  { id: 'assessment', description: { en: 'Current state assessment', ar: 'تقييم الوضع الحالي' }, defaultQuantity: 1, defaultFormat: 'PDF' },
  { id: 'strategy', description: { en: 'Strategic recommendations', ar: 'التوصيات الاستراتيجية' }, defaultQuantity: 1, defaultFormat: 'PDF' },
  { id: 'roadmap', description: { en: 'Implementation roadmap', ar: 'خارطة التنفيذ' }, defaultQuantity: 1, defaultFormat: 'PDF' },
  { id: 'workshop', description: { en: 'Workshop facilitation', ar: 'تيسير ورشة العمل' }, defaultQuantity: 1 },
  { id: 'report', description: { en: 'Final report', ar: 'التقرير النهائي' }, defaultQuantity: 1, defaultFormat: 'PDF' },
  { id: 'presentation', description: { en: 'Executive presentation', ar: 'العرض التنفيذي' }, defaultQuantity: 1, defaultFormat: 'PPTX' },
];

const MARKETING_DELIVERABLES: DeliverablePreset[] = [
  { id: 'marketing-strategy', description: { en: 'Marketing strategy', ar: 'استراتيجية التسويق' }, defaultQuantity: 1, defaultFormat: 'PDF' },
  { id: 'social-strategy', description: { en: 'Social media strategy', ar: 'استراتيجية التواصل الاجتماعي' }, defaultQuantity: 1 },
  { id: 'content-calendar', description: { en: 'Content calendar', ar: 'تقويم المحتوى' }, defaultQuantity: 1, defaultFormat: 'Sheet' },
  { id: 'ad-campaign', description: { en: 'Ad campaign setup', ar: 'إعداد الحملة الإعلانية' }, defaultQuantity: 1 },
  { id: 'seo-audit', description: { en: 'SEO audit', ar: 'تدقيق السيو' }, defaultQuantity: 1, defaultFormat: 'PDF' },
  { id: 'analytics-report', description: { en: 'Analytics report', ar: 'تقرير التحليلات' }, defaultQuantity: 1, defaultFormat: 'PDF' },
  { id: 'email-campaign', description: { en: 'Email campaign', ar: 'حملة البريد الإلكتروني' }, defaultQuantity: 1 },
];

const OTHER_DELIVERABLES: DeliverablePreset[] = [
  { id: 'deliverable-1', description: { en: 'Project deliverable', ar: 'مخرج المشروع' }, defaultQuantity: 1 },
  { id: 'report', description: { en: 'Project report', ar: 'تقرير المشروع' }, defaultQuantity: 1, defaultFormat: 'PDF' },
];

/**
 * Complete scope presets map
 */
export const SCOPE_PRESETS: ScopePresetsMap = {
  design: {
    dependencies: DESIGN_DEPENDENCIES,
    exclusions: DESIGN_EXCLUSIONS,
    deliverablePresets: DESIGN_DELIVERABLES,
  },
  development: {
    dependencies: DEVELOPMENT_DEPENDENCIES,
    exclusions: DEVELOPMENT_EXCLUSIONS,
    deliverablePresets: DEVELOPMENT_DELIVERABLES,
  },
  legal: {
    dependencies: LEGAL_DEPENDENCIES,
    exclusions: LEGAL_EXCLUSIONS,
    deliverablePresets: LEGAL_DELIVERABLES,
  },
  consulting: {
    dependencies: CONSULTING_DEPENDENCIES,
    exclusions: CONSULTING_EXCLUSIONS,
    deliverablePresets: CONSULTING_DELIVERABLES,
  },
  marketing: {
    dependencies: MARKETING_DEPENDENCIES,
    exclusions: MARKETING_EXCLUSIONS,
    deliverablePresets: MARKETING_DELIVERABLES,
  },
  other: {
    dependencies: OTHER_DEPENDENCIES,
    exclusions: OTHER_EXCLUSIONS,
    deliverablePresets: OTHER_DELIVERABLES,
  },
};

/**
 * Get scope defaults for a category
 */
export function getCategoryScopeDefaults(category: keyof ScopePresetsMap) {
  return SCOPE_PRESETS[category];
}
