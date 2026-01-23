/**
 * Demo Documents Generator
 *
 * Creates invoices with mixed statuses for demo visibility.
 */

import type { Document, DocumentSequence, DocumentStatus, DocumentItem } from '../../types';
import { SeededRandom } from '../prng';
import { DEMO_SEED, DEMO_PREFIXES, DEFAULT_FROZEN_TIME } from '../constants';
import { getDemoProfileId } from './profile';
import { getDemoClientIds } from './clients';

const rng = new SeededRandom(DEMO_SEED + 5);

// Invoice subjects for variety
const INVOICE_SUBJECTS = [
  'خدمات تطوير الويب',
  'تصميم واجهة المستخدم',
  'استشارات تقنية',
  'صيانة شهرية',
  'تطوير تطبيق',
  'تحسين الأداء',
  'إعداد النظام',
  'دعم فني',
];

// Document configurations
const DOCUMENT_CONFIGS: Array<{
  status: DocumentStatus;
  daysAgo: number;
  dueDaysFromIssue: number;
}> = [
  { status: 'draft', daysAgo: 2, dueDaysFromIssue: 30 },
  { status: 'draft', daysAgo: 5, dueDaysFromIssue: 30 },
  { status: 'issued', daysAgo: 10, dueDaysFromIssue: 30 },
  { status: 'issued', daysAgo: 15, dueDaysFromIssue: 30 },
  { status: 'issued', daysAgo: 20, dueDaysFromIssue: 14 },
  { status: 'paid', daysAgo: 45, dueDaysFromIssue: 30 },
  { status: 'paid', daysAgo: 60, dueDaysFromIssue: 30 },
  { status: 'paid', daysAgo: 75, dueDaysFromIssue: 30 },
  { status: 'paid', daysAgo: 90, dueDaysFromIssue: 30 },
  // Overdue (issued but past due)
  { status: 'issued', daysAgo: 45, dueDaysFromIssue: 14 },
  { status: 'issued', daysAgo: 50, dueDaysFromIssue: 14 },
];

function generateLineItems(): DocumentItem[] {
  const itemCount = rng.int(1, 4);
  const items: DocumentItem[] = [];

  const itemNames = [
    'ساعات عمل تطوير',
    'تصميم واجهة',
    'استشارة',
    'إعداد وتهيئة',
    'اختبار ومراجعة',
    'توثيق',
    'تدريب',
  ];

  for (let i = 0; i < itemCount; i++) {
    const rateMinor = rng.amountMinor(200, 1500);
    const quantity = rng.int(1, 10);
    const taxRate = 0.17;
    const rateVatMinor = Math.round(rateMinor * (1 + taxRate));

    items.push({
      name: rng.pick(itemNames),
      quantity,
      rateMinor,
      rateVatMinor,
      discountMinor: 0,
      taxExempt: false,
    });
  }

  return items;
}

function calculateTotals(items: DocumentItem[], taxRate: number) {
  const subtotalMinor = items.reduce(
    (sum, item) => sum + item.rateMinor * item.quantity,
    0
  );
  const discountMinor = 0;
  const taxMinor = Math.round((subtotalMinor - discountMinor) * taxRate);
  const totalMinor = subtotalMinor - discountMinor + taxMinor;

  return { subtotalMinor, discountMinor, taxMinor, totalMinor };
}

export function createDemoDocuments(): Document[] {
  const profileId = getDemoProfileId();
  const clientIds = getDemoClientIds();
  const referenceDate = new Date(DEFAULT_FROZEN_TIME);
  const documents: Document[] = [];

  DOCUMENT_CONFIGS.forEach((config, index) => {
    const docNum = index + 1;
    const clientId = rng.pick(clientIds);

    const issueDate = new Date(referenceDate);
    issueDate.setDate(issueDate.getDate() - config.daysAgo);

    const dueDate = new Date(issueDate);
    dueDate.setDate(dueDate.getDate() + config.dueDaysFromIssue);

    const items = generateLineItems();
    const taxRate = 0.17;
    const { subtotalMinor, discountMinor, taxMinor, totalMinor } = calculateTotals(items, taxRate);

    let paidAt: string | undefined;
    if (config.status === 'paid') {
      const paidDate = new Date(dueDate);
      paidDate.setDate(paidDate.getDate() - rng.int(0, 10));
      paidAt = paidDate.toISOString();
    }

    const now = new Date().toISOString();

    documents.push({
      id: `${DEMO_PREFIXES.document}${String(docNum).padStart(3, '0')}`,
      number: `INV-${String(docNum).padStart(4, '0')}`,
      type: 'invoice',
      status: config.status,
      businessProfileId: profileId,
      clientId,
      subject: rng.pick(INVOICE_SUBJECTS),
      brief: 'خدمات مهنية حسب الاتفاق',
      items,
      payments: config.status === 'paid' ? [{
        id: `pay_${docNum}`,
        amountMinor: totalMinor,
        currency: 'ILS',
        method: rng.pick(['bank_transfer', 'cheque', 'cash']),
        paidAt: paidAt!,
      }] : [],
      subtotalMinor,
      discountMinor,
      taxMinor,
      totalMinor,
      taxRate,
      vatEnabled: true,
      currency: 'ILS',
      language: 'ar',
      issueDate: issueDate.toISOString().split('T')[0],
      dueDate: dueDate.toISOString().split('T')[0],
      paidAt,
      linkedTransactionIds: [],
      templateId: 'template1',
      createdAt: now,
      updatedAt: now,
      exportCount: config.status === 'paid' ? 1 : 0,
      pdfVersion: config.status === 'paid' ? 1 : 0,
    });
  });

  return documents;
}

export function createDemoDocumentSequences(): DocumentSequence[] {
  const profileId = getDemoProfileId();
  const now = new Date().toISOString();

  return [
    {
      id: `${DEMO_PREFIXES.documentSequence}invoice`,
      businessProfileId: profileId,
      documentType: 'invoice',
      lastNumber: DOCUMENT_CONFIGS.length,
      prefix: 'INV',
      prefixEnabled: true,
      updatedAt: now,
    },
    {
      id: `${DEMO_PREFIXES.documentSequence}receipt`,
      businessProfileId: profileId,
      documentType: 'receipt',
      lastNumber: 0,
      prefix: 'REC',
      prefixEnabled: true,
      updatedAt: now,
    },
  ];
}

export function getDemoDocumentIds(): string[] {
  return DOCUMENT_CONFIGS.map((_, index) =>
    `${DEMO_PREFIXES.document}${String(index + 1).padStart(3, '0')}`
  );
}
