import type { DocumentLanguage } from '../labels.js';
import { DOC_TYPE_TITLES } from '../labels.js';

/**
 * MUT-640: the words printed on a document, per language. Formal register (Basel, 2026-11-22): Modern Standard Arabic,
 * formal Hebrew, plain professional English. The type titles are the ledger's (issuing/labels.ts), one source.
 */
export interface PdfLabels {
  no: string;
  original: string;
  copy: string;
  draft: string;
  billTo: string;
  from: string;
  issuerId: Record<'LICENSED' | 'EXEMPT' | 'COMPANY' | 'NONPROFIT', string>;
  customerId: string;
  date: string;
  due: string;
  allocation: string;
  creditFor: string;
  receiptFor: string;
  colIndex: string;
  colDescription: string;
  colQty: string;
  colUnitPrice: string;
  colAmount: string;
  vatExemptLine: string;
  subtotal: string;
  discount: string;
  taxable: string;
  exempt: string;
  net: string;
  vat: (percent: string) => string;
  vatIncluded: string;
  total: string;
  totalCredit: string;
  received: string;
  paymentHeading: string;
  method: Record<'CASH' | 'BANK', string>;
  reference: string;
  receivedOn: string;
  notes: string;
  footer: string;
  page: (n: number, of: number) => string;
}

export const PDF_LABELS: Readonly<Record<DocumentLanguage, PdfLabels>> = {
  he: {
    no: 'מס׳',
    original: 'מקור',
    copy: 'העתק',
    draft: 'טיוטה',
    billTo: 'לכבוד',
    from: 'מאת',
    issuerId: { LICENSED: 'עוסק מורשה', EXEMPT: 'עוסק פטור', COMPANY: 'ח.פ.', NONPROFIT: 'ע״ר' },
    customerId: 'ח.פ./ע.מ.',
    date: 'תאריך',
    due: 'לתשלום עד',
    allocation: 'מספר הקצאה',
    creditFor: 'זיכוי לחשבונית מס',
    receiptFor: 'בגין חשבונית מס',
    colIndex: '#',
    colDescription: 'תיאור',
    colQty: 'כמות',
    colUnitPrice: 'מחיר ליחידה',
    colAmount: 'סה״כ',
    vatExemptLine: 'פטור ממע״מ',
    subtotal: 'סה״כ לפני הנחה',
    discount: 'הנחה',
    taxable: 'חייב במע״מ',
    exempt: 'פטור ממע״מ',
    net: 'סה״כ לפני מע״מ',
    vat: (p) => `מע״מ ${p}%`,
    vatIncluded: 'המחירים כוללים מע״מ',
    total: 'סה״כ לתשלום',
    totalCredit: 'סה״כ זיכוי',
    received: 'סה״כ שהתקבל',
    paymentHeading: 'פרטי התשלום',
    method: { CASH: 'מזומן', BANK: 'העברה בנקאית' },
    reference: 'אסמכתא',
    receivedOn: 'תאריך התשלום',
    notes: 'הערות',
    footer: 'הופק באמצעות MTB3A',
    page: (n, of) => `עמוד ${n} מתוך ${of}`,
  },
  ar: {
    no: 'رقم',
    original: 'أصل',
    copy: 'نسخة',
    draft: 'مسودة',
    billTo: 'إلى',
    from: 'من',
    issuerId: { LICENSED: 'مشتغل مرخّص', EXEMPT: 'مشتغل معفى', COMPANY: 'رقم الشركة', NONPROFIT: 'رقم الجمعية' },
    customerId: 'رقم المشتغل',
    date: 'التاريخ',
    due: 'تاريخ الاستحقاق',
    allocation: 'رقم التخصيص',
    creditFor: 'إشعار دائن للفاتورة الضريبية',
    receiptFor: 'عن الفاتورة الضريبية',
    colIndex: '#',
    colDescription: 'الوصف',
    colQty: 'الكمية',
    colUnitPrice: 'سعر الوحدة',
    colAmount: 'المجموع',
    vatExemptLine: 'معفى من ضريبة القيمة المضافة',
    subtotal: 'المجموع قبل الخصم',
    discount: 'الخصم',
    taxable: 'الخاضع للضريبة',
    exempt: 'المعفى من الضريبة',
    net: 'المجموع قبل الضريبة',
    vat: (p) => `ضريبة القيمة المضافة ${p}%`,
    vatIncluded: 'الأسعار تشمل ضريبة القيمة المضافة',
    total: 'المبلغ المستحق',
    totalCredit: 'مجموع الإشعار الدائن',
    received: 'المبلغ المستلم',
    paymentHeading: 'تفاصيل الدفع',
    method: { CASH: 'نقدًا', BANK: 'تحويل بنكي' },
    reference: 'المرجع',
    receivedOn: 'تاريخ الدفع',
    notes: 'ملاحظات',
    footer: 'صدر عبر MTB3A',
    page: (n, of) => `صفحة ${n} من ${of}`,
  },
  en: {
    no: 'No.',
    original: 'Original',
    copy: 'Copy',
    draft: 'Draft',
    billTo: 'Bill to',
    from: 'From',
    issuerId: { LICENSED: 'Licensed dealer no.', EXEMPT: 'Exempt dealer no.', COMPANY: 'Company no.', NONPROFIT: 'Nonprofit no.' },
    customerId: 'VAT no.',
    date: 'Date',
    due: 'Due date',
    allocation: 'Allocation no.',
    creditFor: 'Credit for tax invoice',
    receiptFor: 'For tax invoice',
    colIndex: '#',
    colDescription: 'Description',
    colQty: 'Qty',
    colUnitPrice: 'Unit price',
    colAmount: 'Amount',
    vatExemptLine: 'VAT exempt',
    subtotal: 'Subtotal',
    discount: 'Discount',
    taxable: 'Taxable',
    exempt: 'VAT exempt',
    net: 'Total before VAT',
    vat: (p) => `VAT ${p}%`,
    vatIncluded: 'Prices include VAT',
    total: 'Total due',
    totalCredit: 'Total credited',
    received: 'Total received',
    paymentHeading: 'Payment',
    method: { CASH: 'Cash', BANK: 'Bank transfer' },
    reference: 'Reference',
    receivedOn: 'Received on',
    notes: 'Notes',
    footer: 'Issued with MTB3A',
    page: (n, of) => `Page ${n} of ${of}`,
  },
};

export { DOC_TYPE_TITLES };
