import type { EngagementSnapshot, EngagementLanguage, EngagementType, EngagementCategory } from '../../types';
import type { Client } from '../../../../types';

export interface KeyTermRow {
  label: string;
  value: string;
  emphasize?: boolean;
}

interface KeyTermsTexts {
  services: string;
  startDate: string;
  deliveryDate: string;
  fee: string;
  deposit: string;
  revisions: string;
  reviewWindow: string;
  ownership: string;
  cancellation: string;
  retainerFee: string;
  billingDate: string;
  termRenewal: string;
  outOfScope: string;
  notSpecified: string;
  asAgreed: string;
  none: string;
  seeScheduleA: string;
  rounds: string;
  days: string;
  dueOn: string;
  billedOnDay: string;
  monthlyAutoRenew: string;
  quotedSeparately: string;
  uponFullPayment: string;
  daysNotice: string;
  perMonth: string;
}

const textsEn: KeyTermsTexts = {
  services: 'Services/Deliverables',
  startDate: 'Start Date',
  deliveryDate: 'Delivery Date',
  fee: 'Fee',
  deposit: 'Deposit',
  revisions: 'Revisions Included',
  reviewWindow: 'Review Window',
  ownership: 'Ownership Transfer',
  cancellation: 'Cancellation Notice',
  retainerFee: 'Retainer Fee',
  billingDate: 'Billing Date',
  termRenewal: 'Term & Renewal',
  outOfScope: 'Out of Scope Work',
  notSpecified: 'Not specified',
  asAgreed: 'As agreed',
  none: 'None',
  seeScheduleA: 'See Schedule A',
  rounds: 'rounds',
  days: 'days',
  dueOn: 'due on signing',
  billedOnDay: 'Billed on day',
  monthlyAutoRenew: 'Monthly, auto-renewing',
  quotedSeparately: 'Quoted separately',
  uponFullPayment: 'Upon full payment',
  daysNotice: 'days notice',
  perMonth: 'per month',
};

const textsAr: KeyTermsTexts = {
  services: 'الخدمات/التسليمات',
  startDate: 'تاريخ البدء',
  deliveryDate: 'تاريخ التسليم',
  fee: 'الأتعاب',
  deposit: 'الدفعة المقدمة',
  revisions: 'التعديلات المشمولة',
  reviewWindow: 'فترة المراجعة',
  ownership: 'نقل الملكية',
  cancellation: 'إشعار الإلغاء',
  retainerFee: 'رسوم العقد الشهري',
  billingDate: 'تاريخ الفوترة',
  termRenewal: 'المدة والتجديد',
  outOfScope: 'العمل خارج النطاق',
  notSpecified: 'غير محدد',
  asAgreed: 'حسب الاتفاق',
  none: 'لا يوجد',
  seeScheduleA: 'انظر الجدول أ',
  rounds: 'جولات',
  days: 'أيام',
  dueOn: 'مستحق عند التوقيع',
  billedOnDay: 'يُفوتر في اليوم',
  monthlyAutoRenew: 'شهري، يتجدد تلقائياً',
  quotedSeparately: 'يُسعّر بشكل منفصل',
  uponFullPayment: 'عند السداد الكامل',
  daysNotice: 'يوم إشعار',
  perMonth: 'شهرياً',
};

function getKeyTermsTexts(language: EngagementLanguage): KeyTermsTexts {
  return language === 'ar' ? textsAr : textsEn;
}

// Format amount from minor units to display string
function formatAmount(amountMinor: number, currency: string): string {
  const amount = amountMinor / 100;
  const symbols: Record<string, string> = { USD: '$', ILS: '₪', EUR: '€' };
  const symbol = symbols[currency] || '';

  const formatted = amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return `${symbol}${formatted}`;
}

// Format date string
function formatDate(dateString: string, language: EngagementLanguage): string {
  const date = new Date(dateString);
  const locale = language === 'ar' ? 'ar-EG' : 'en-GB';
  return date.toLocaleDateString(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

// Get ownership rule display text
function getOwnershipText(rule: string | undefined, t: KeyTermsTexts): string {
  if (!rule) return t.notSpecified;

  const rules: Record<string, string> = {
    'upon_full_payment': t.uponFullPayment,
    'upon_signing': 'Upon signing',
    'upon_delivery': 'Upon delivery',
  };

  return rules[rule] || rule.replace(/_/g, ' ');
}

export interface BuildKeyTermsRowsParams {
  snapshot: EngagementSnapshot;
  client?: Client;
  language: EngagementLanguage;
  type: EngagementType;
  category: EngagementCategory;
}

export function buildKeyTermsRows(params: BuildKeyTermsRowsParams): KeyTermRow[] {
  const { snapshot, language, type } = params;
  const t = getKeyTermsTexts(language);

  const isTask = type === 'task';
  const rows: KeyTermRow[] = [];

  if (isTask) {
    // Task Engagement Rows

    // 1. Services/Deliverables
    const deliverables = snapshot.deliverables || [];
    let servicesValue: string;
    if (deliverables.length === 0) {
      servicesValue = t.notSpecified;
    } else if (deliverables.length > 5) {
      servicesValue = t.seeScheduleA;
    } else if (snapshot.title) {
      servicesValue = snapshot.title;
    } else {
      servicesValue = deliverables[0]?.description || t.seeScheduleA;
    }
    rows.push({ label: t.services, value: servicesValue });

    // 2. Start Date
    rows.push({
      label: t.startDate,
      value: snapshot.startDate ? formatDate(snapshot.startDate, language) : t.notSpecified,
    });

    // 3. Delivery Date
    rows.push({
      label: t.deliveryDate,
      value: snapshot.endDate ? formatDate(snapshot.endDate, language) : t.asAgreed,
    });

    // 4. Fee
    rows.push({
      label: t.fee,
      value: snapshot.totalAmountMinor
        ? formatAmount(snapshot.totalAmountMinor, snapshot.currency)
        : t.notSpecified,
      emphasize: true,
    });

    // 5. Deposit
    let depositValue: string;
    if (snapshot.depositPercent && snapshot.totalAmountMinor) {
      const depositAmount = Math.round((snapshot.totalAmountMinor * snapshot.depositPercent) / 100);
      depositValue = `${snapshot.depositPercent}% (${formatAmount(depositAmount, snapshot.currency)}) ${t.dueOn}`;
    } else {
      depositValue = t.none;
    }
    rows.push({ label: t.deposit, value: depositValue });

    // 6. Revisions Included
    rows.push({
      label: t.revisions,
      value: snapshot.revisionRounds
        ? `${snapshot.revisionRounds} ${t.rounds}`
        : t.asAgreed,
    });

    // 7. Review Window
    rows.push({
      label: t.reviewWindow,
      value: snapshot.reviewWindowDays
        ? `${snapshot.reviewWindowDays} ${t.days}`
        : t.notSpecified,
    });

    // 8. Ownership Transfer
    rows.push({
      label: t.ownership,
      value: getOwnershipText(snapshot.ownershipTransferRule, t),
    });

    // 9. Cancellation Notice
    rows.push({
      label: t.cancellation,
      value: snapshot.terminationNoticeDays
        ? `${snapshot.terminationNoticeDays} ${t.daysNotice}`
        : t.asAgreed,
    });

  } else {
    // Retainer Engagement Rows

    // 1. Included Services
    const deliverables = snapshot.deliverables || [];
    let servicesValue: string;
    if (deliverables.length === 0) {
      servicesValue = t.notSpecified;
    } else if (deliverables.length > 3 || snapshot.scopeCategories?.length) {
      servicesValue = t.seeScheduleA;
    } else if (snapshot.title) {
      servicesValue = snapshot.title;
    } else {
      servicesValue = deliverables[0]?.description || t.seeScheduleA;
    }
    rows.push({ label: t.services, value: servicesValue });

    // 2. Retainer Fee
    rows.push({
      label: t.retainerFee,
      value: snapshot.retainerAmountMinor
        ? `${formatAmount(snapshot.retainerAmountMinor, snapshot.currency)} ${t.perMonth}`
        : t.notSpecified,
      emphasize: true,
    });

    // 3. Billing Date
    rows.push({
      label: t.billingDate,
      value: snapshot.billingDay
        ? `${t.billedOnDay} ${snapshot.billingDay}`
        : t.notSpecified,
    });

    // 4. Term & Renewal
    let termValue: string;
    if (snapshot.termType === 'month-to-month') {
      termValue = t.monthlyAutoRenew;
    } else {
      termValue = snapshot.startDate && snapshot.endDate
        ? `${formatDate(snapshot.startDate, language)} - ${formatDate(snapshot.endDate, language)}`
        : t.notSpecified;
    }
    rows.push({ label: t.termRenewal, value: termValue });

    // 5. Out of Scope Work
    rows.push({
      label: t.outOfScope,
      value: snapshot.outOfScopeRateMinor
        ? formatAmount(snapshot.outOfScopeRateMinor, snapshot.currency)
        : t.quotedSeparately,
    });

    // 6. Cancellation Notice
    rows.push({
      label: t.cancellation,
      value: snapshot.terminationNoticeDays
        ? `${snapshot.terminationNoticeDays} ${t.daysNotice}`
        : t.asAgreed,
    });

    // 7. Ownership Transfer
    rows.push({
      label: t.ownership,
      value: getOwnershipText(snapshot.ownershipTransferRule, t),
    });
  }

  return rows;
}
