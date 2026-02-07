import type { DocumentLanguage, DocumentType } from '../../../types';

export interface DocumentTexts {
  item: string;
  subject: string;
  quantity: string;
  rate: string;
  price: string;
  subtotal: string;
  tax: string;
  discount: string;
  total: string;
  notes: string;
  issued: string;
  due: string;
  original: string;
  copy: string;
  // Document types
  invoice: string;
  receipt: string;
  invoice_receipt: string;
  credit_note: string;
  price_offer: string;
  proforma_invoice: string;
  donation_receipt: string;
  payment_request: string;
  // Additional
  to: string;
  from: string;
  bill_to: string;
  payment_method: string;
  cash: string;
  bank_transfer: string;
  cheque: string;
  credit_card: string;
  other: string;
  digitally_certified: string;
  // Footer / Payment details
  page_of: string;
  bank_details: string;
  bank_name: string;
  branch: string;
  account: string;
  iban: string;
  payment_instructions: string;
  // Disclaimers
  not_tax_document: string;
}

export const texts: Record<DocumentLanguage, DocumentTexts> = {
  ar: {
    item: 'بند',
    subject: 'موضوع',
    quantity: 'كمية',
    rate: 'سعر',
    price: 'مجموع',
    subtotal: 'المجموع الفرعي',
    tax: 'ضريبة',
    discount: 'خصم',
    total: 'المجموع',
    notes: 'ملاحظات',
    issued: 'تاريخ الإصدار',
    due: 'تاريخ الاستحقاق',
    original: 'الأصل',
    copy: 'نسخة طبق الأصل',
    invoice: 'فاتورة',
    receipt: 'سند قبض',
    invoice_receipt: 'فاتورة/إيصال',
    credit_note: 'إشعار دائن',
    price_offer: 'عرض سعر',
    proforma_invoice: 'فاتورة أولية',
    donation_receipt: 'سند تبرّع',
    payment_request: 'طلب دفع',
    to: 'إلى',
    from: 'من',
    bill_to: 'فاتورة إلى',
    payment_method: 'طريقة الدفع',
    cash: 'نقداً',
    bank_transfer: 'تحويل بنكي',
    cheque: 'شيك',
    credit_card: 'بطاقة ائتمان',
    other: 'أخرى',
    digitally_certified: 'موثّق رقمياً',
    page_of: 'صفحة {0} من {1}',
    bank_details: 'تفاصيل الحساب البنكي',
    bank_name: 'البنك',
    branch: 'الفرع',
    account: 'رقم الحساب',
    iban: 'IBAN',
    payment_instructions: 'تعليمات الدفع',
    not_tax_document: 'هذا المستند ليس مستند ضريبي / This is not a tax document',
  },
  en: {
    item: 'Item',
    subject: 'Subject',
    quantity: 'Qty',
    rate: 'Rate',
    price: 'Price',
    subtotal: 'Subtotal',
    tax: 'Tax',
    discount: 'Discount',
    total: 'Total',
    notes: 'Notes',
    issued: 'Issue Date',
    due: 'Due Date',
    original: 'Original',
    copy: 'Certified Copy',
    invoice: 'Invoice',
    receipt: 'Receipt',
    invoice_receipt: 'Invoice Receipt',
    credit_note: 'Credit Note',
    price_offer: 'Price Offer',
    proforma_invoice: 'Proforma Invoice',
    donation_receipt: 'Donation Receipt',
    payment_request: 'Payment Request',
    to: 'To',
    from: 'From',
    bill_to: 'Bill To',
    payment_method: 'Payment Method',
    cash: 'Cash',
    bank_transfer: 'Bank Transfer',
    cheque: 'Cheque',
    credit_card: 'Credit Card',
    other: 'Other',
    digitally_certified: 'Digitally Certified',
    page_of: 'Page {0} of {1}',
    bank_details: 'Bank Details',
    bank_name: 'Bank',
    branch: 'Branch',
    account: 'Account',
    iban: 'IBAN',
    payment_instructions: 'Payment Instructions',
    not_tax_document: 'This document is not a tax document',
  },
};

export function getTexts(language: DocumentLanguage): DocumentTexts {
  return texts[language];
}

export function getDocumentTypeLabel(type: DocumentType, language: DocumentLanguage): string {
  return texts[language][type];
}
