/** A complete guide for the viewer's and the parser's tests. Real guides live in `src/content/guides/*.json`. */
export const FIXTURE_GUIDE = {
  id: 'fixture-guide',
  surfaces: ['portal', 'web'],
  title: { ar: 'دليل تجريبي', en: 'A test guide' },
  lead: { ar: 'سطر تمهيدي', en: 'A lead line' },
  hero: 'guide-tax-hero',
  steps: [
    { text: { ar: 'الخطوة الأولى', en: 'First step' }, scene: 'guide-tax-1' },
    { text: { ar: 'الخطوة الثانية', en: 'Second step' }, scene: 'guide-tax-2' },
  ],
  note: { ar: 'ملاحظة', en: 'A note' },
  source: { url: 'https://example.com/official', label: { ar: 'المصدر الرسمي', en: 'The official page' } },
};
