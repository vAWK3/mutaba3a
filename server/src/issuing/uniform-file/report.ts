import { DOC_TYPE_TITLES } from '../labels.js';
import { DOC_TYPE_CODES } from '../types.js';
import type { UniformFile } from './export.js';
import type { RecordCode } from './layout.js';

/**
 * MUT-569: what the software prints after producing the file (spec §2.6 b and appendix 4): the business, the folder, the
 * dates, the records written per type, and the documents report (count and shekel total per document type). A
 * self-contained HTML page in the person's language (ar | en), put in the download next to the files.
 */
export type ReportLanguage = 'ar' | 'en';

export interface ReportMeta {
  businessName: string;
  vatId: string;
  range: { from: string; to: string };
  producedAt: Date;
  software: { name: string; registrationNumber: string; version: string };
}

const LABELS = {
  ar: {
    title: 'إنتاج الملف الموحّد (מבנה אחיד 1.31)',
    done: 'تمّ إنتاج الملف الموحّد بنجاح.',
    vatId: 'رقم المشتغل المرخّص',
    business: 'اسم العمل',
    folder: 'حُفظت الملفات في',
    range: 'المدة',
    produced: 'تاريخ الإنتاج',
    software: 'البرنامج',
    registration: 'رقم شهادة التسجيل',
    records: 'السجلات في BKMVDATA.TXT',
    code: 'الرمز',
    description: 'الوصف',
    count: 'العدد',
    total: 'المجموع',
    documents: 'تقرير المستندات',
    docNumber: 'نوع المستند',
    docType: 'المستند',
    amount: 'المجموع (₪)',
    none: 'لا مستندات في هذه التواريخ.',
    recordNames: { A100: 'سجل الافتتاح', C100: 'رأس مستند', D110: 'سطر مستند', D120: 'تفاصيل دفعة', Z900: 'سجل الإغلاق' },
  },
  en: {
    title: 'Uniform file production (מבנה אחיד 1.31)',
    done: 'The uniform file was produced successfully.',
    vatId: 'VAT number',
    business: 'Business name',
    folder: 'Files saved in',
    range: 'Dates',
    produced: 'Produced',
    software: 'Software',
    registration: 'Registration certificate',
    records: 'Records in BKMVDATA.TXT',
    code: 'Code',
    description: 'Description',
    count: 'Count',
    total: 'Total',
    documents: 'Documents report',
    docNumber: 'Type',
    docType: 'Document',
    amount: 'Total (₪)',
    none: 'No documents in these dates.',
    recordNames: { A100: 'Opening record', C100: 'Document header', D110: 'Document line', D120: 'Payment details', Z900: 'Closing record' },
  },
} as const;

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const day = (iso: string) => iso.split('-').reverse().join('/');
const shekels = (minor: bigint) =>
  new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(minor) / 100);
const israelStamp = (at: Date) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(at)
    .replace(',', '');

const ltr = (s: string) => `<bdi dir="ltr">${escape(s)}</bdi>`;

export function uniformFileReport(file: UniformFile, meta: ReportMeta, language: ReportLanguage): string {
  const l = LABELS[language];
  const row = (label: string, value: string) => `<tr><th>${label}</th><td>${value}</td></tr>`;
  const recordRows = file.recordCounts
    .map(({ code, count }) => `<tr><td>${code}</td><td>${l.recordNames[code as Exclude<RecordCode, 'A000' | 'INI_SUMMARY'>] ?? ''}</td><td class="n">${count}</td></tr>`)
    .join('');
  const documentRows = file.byType
    .map((t) => `<tr><td>${DOC_TYPE_CODES[t.docType]}</td><td>${escape(DOC_TYPE_TITLES[language][t.docType])}</td><td class="n">${t.count}</td><td class="n">${shekels(t.grossMinor)}</td></tr>`)
    .join('');
  return `<!doctype html>
<html lang="${language}" dir="${language === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><title>${l.title}</title>
<style>body{font:14px/1.5 system-ui,sans-serif;margin:32px;color:#392F4B}h1{font-size:20px}h2{font-size:16px;margin-top:24px}
table{border-collapse:collapse;margin-top:8px}th,td{border:1px solid #E6E2ED;padding:6px 10px;text-align:start}.n{text-align:end;font-variant-numeric:tabular-nums}</style>
</head><body>
<h1>${l.title}</h1><p>${l.done}</p>
<table>${row(l.vatId, ltr(meta.vatId))}${row(l.business, escape(meta.businessName))}${row(l.folder, ltr(file.folder.replace(/\//g, '\\')))}${row(l.range, `${ltr(day(meta.range.from))} – ${ltr(day(meta.range.to))}`)}${row(l.produced, ltr(israelStamp(meta.producedAt)))}${row(l.software, ltr(`${meta.software.name} ${meta.software.version}`))}${row(l.registration, ltr(meta.software.registrationNumber))}</table>
<h2>${l.records}</h2>
<table><tr><th>${l.code}</th><th>${l.description}</th><th>${l.count}</th></tr>${recordRows}<tr><th colspan="2">${l.total}</th><td class="n">${file.totalRecords}</td></tr></table>
<h2>${l.documents}</h2>
${file.byType.some((t) => t.count > 0) ? '' : `<p>${l.none}</p>`}<table><tr><th>${l.docNumber}</th><th>${l.docType}</th><th>${l.count}</th><th>${l.amount}</th></tr>${documentRows}</table>
</body></html>
`;
}
