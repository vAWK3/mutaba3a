import { useMemo } from 'react';
import type { EngagementSnapshot, ClarityRisk, EngagementType, EngagementCategory } from '../types';

/**
 * Clarity check rule definition
 */
interface ClarityRule {
  id: string;
  severity: 'high' | 'medium' | 'low';
  stepIndex: number;
  fieldPath: string;
  messageKey: string;
  check: (
    snapshot: Partial<EngagementSnapshot>,
    type: EngagementType,
    category: EngagementCategory
  ) => boolean;
}

/**
 * All clarity check rules
 */
const CLARITY_RULES: ClarityRule[] = [
  // HIGH severity risks
  {
    id: 'no_deposit',
    severity: 'high',
    stepIndex: 5,
    fieldPath: 'depositPercent',
    messageKey: 'clarityCheck.noDeposit',
    check: (snapshot, type) =>
      type === 'task' && (snapshot.depositPercent === undefined || snapshot.depositPercent === 0),
  },
  {
    id: 'no_exclusions',
    severity: 'high',
    stepIndex: 2,
    fieldPath: 'exclusions',
    messageKey: 'clarityCheck.noExclusions',
    check: (snapshot) => !snapshot.exclusions || snapshot.exclusions.length === 0,
  },
  {
    id: 'no_review_window',
    severity: 'high',
    stepIndex: 3,
    fieldPath: 'reviewWindowDays',
    messageKey: 'clarityCheck.noReviewWindow',
    check: (snapshot) =>
      snapshot.reviewWindowDays === undefined || snapshot.reviewWindowDays === 0,
  },
  {
    id: 'no_capacity_cap',
    severity: 'high',
    stepIndex: 4,
    fieldPath: 'monthlyCapacity',
    messageKey: 'clarityCheck.noCapacityCap',
    check: (snapshot, type) =>
      type === 'retainer' &&
      !snapshot.monthlyCapacity &&
      (!snapshot.outOfScopeRateMinor || snapshot.outOfScopeRateMinor === 0),
  },

  // MEDIUM severity risks
  {
    id: 'no_termination_notice',
    severity: 'medium',
    stepIndex: 6,
    fieldPath: 'terminationNoticeDays',
    messageKey: 'clarityCheck.noTerminationNotice',
    check: (snapshot) =>
      snapshot.terminationNoticeDays === undefined || snapshot.terminationNoticeDays === 0,
  },
  {
    id: 'no_bug_fix_window',
    severity: 'medium',
    stepIndex: 4,
    fieldPath: 'bugFixDays',
    messageKey: 'clarityCheck.noBugFixWindow',
    check: (snapshot, _type, category) =>
      category === 'development' &&
      (snapshot.bugFixDays === undefined || snapshot.bugFixDays === 0),
  },
  {
    id: 'no_revision_limit',
    severity: 'medium',
    stepIndex: 4,
    fieldPath: 'revisionRounds',
    messageKey: 'clarityCheck.noRevisionLimit',
    check: (snapshot, _type, category) =>
      category === 'design' &&
      (snapshot.revisionRounds === undefined || snapshot.revisionRounds === 0),
  },
  {
    id: 'no_dependencies',
    severity: 'medium',
    stepIndex: 2,
    fieldPath: 'dependencies',
    messageKey: 'clarityCheck.noDependencies',
    check: (snapshot) => !snapshot.dependencies || snapshot.dependencies.length === 0,
  },
  {
    id: 'no_deliverables',
    severity: 'medium',
    stepIndex: 2,
    fieldPath: 'deliverables',
    messageKey: 'clarityCheck.noDeliverables',
    check: (snapshot) => !snapshot.deliverables || snapshot.deliverables.length === 0,
  },
  {
    id: 'no_milestones',
    severity: 'medium',
    stepIndex: 3,
    fieldPath: 'milestones',
    messageKey: 'clarityCheck.noMilestones',
    check: (snapshot, type) =>
      type === 'task' && (!snapshot.milestones || snapshot.milestones.length === 0),
  },

  // LOW severity risks
  {
    id: 'late_fee_off',
    severity: 'low',
    stepIndex: 5,
    fieldPath: 'lateFeeEnabled',
    messageKey: 'clarityCheck.lateFeeOff',
    check: (snapshot) => snapshot.lateFeeEnabled === false,
  },
  {
    id: 'no_dispute_path',
    severity: 'low',
    stepIndex: 7,
    fieldPath: 'disputePath',
    messageKey: 'clarityCheck.noDisputePath',
    check: (snapshot) => !snapshot.disputePath,
  },
  {
    id: 'no_governing_law',
    severity: 'low',
    stepIndex: 7,
    fieldPath: 'governingLaw',
    messageKey: 'clarityCheck.noGoverningLaw',
    check: (snapshot) => !snapshot.governingLaw,
  },
  {
    id: 'no_ownership_rule',
    severity: 'low',
    stepIndex: 6,
    fieldPath: 'ownershipTransferRule',
    messageKey: 'clarityCheck.noOwnershipRule',
    check: (snapshot) => !snapshot.ownershipTransferRule,
  },
  {
    id: 'no_summary',
    severity: 'low',
    stepIndex: 1,
    fieldPath: 'summary',
    messageKey: 'clarityCheck.noSummary',
    check: (snapshot) => !snapshot.summary || snapshot.summary.trim().length === 0,
  },
];

/**
 * Hook to run clarity checks on engagement snapshot
 */
export function useClarityCheck(
  snapshot: Partial<EngagementSnapshot>,
  engagementType: EngagementType,
  engagementCategory: EngagementCategory
): ClarityRisk[] {
  return useMemo(() => {
    const risks: ClarityRisk[] = [];

    for (const rule of CLARITY_RULES) {
      if (rule.check(snapshot, engagementType, engagementCategory)) {
        risks.push({
          id: rule.id,
          severity: rule.severity,
          stepIndex: rule.stepIndex,
          fieldPath: rule.fieldPath,
          messageKey: rule.messageKey,
        });
      }
    }

    // Sort by severity (high first, then medium, then low)
    const severityOrder = { high: 0, medium: 1, low: 2 };
    risks.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    return risks;
  }, [snapshot, engagementType, engagementCategory]);
}

/**
 * Get risks for a specific step
 */
export function getRisksForStep(risks: ClarityRisk[], stepIndex: number): ClarityRisk[] {
  return risks.filter((r) => r.stepIndex === stepIndex);
}

/**
 * Get count of risks by severity
 */
export function getRiskCounts(risks: ClarityRisk[]): {
  high: number;
  medium: number;
  low: number;
  total: number;
} {
  return {
    high: risks.filter((r) => r.severity === 'high').length,
    medium: risks.filter((r) => r.severity === 'medium').length,
    low: risks.filter((r) => r.severity === 'low').length,
    total: risks.length,
  };
}

/**
 * Check if there are any high severity risks
 */
export function hasHighSeverityRisks(risks: ClarityRisk[]): boolean {
  return risks.some((r) => r.severity === 'high');
}

/**
 * Default clarity check messages (English)
 * These should be added to the i18n files
 */
export const CLARITY_CHECK_MESSAGES: Record<string, { en: string; ar: string }> = {
  'clarityCheck.noDeposit': {
    en: 'No deposit required - Consider requesting upfront payment to protect your work',
    ar: 'لا يوجد دفعة مقدمة - فكر في طلب دفعة مقدمة لحماية عملك',
  },
  'clarityCheck.noExclusions': {
    en: 'No exclusions defined - Clearly state what is NOT included to avoid scope creep',
    ar: 'لم يتم تحديد استثناءات - حدد بوضوح ما هو غير مشمول لتجنب توسع النطاق',
  },
  'clarityCheck.noReviewWindow': {
    en: 'No review window set - Define how long the client has to review deliverables',
    ar: 'لم يتم تحديد فترة المراجعة - حدد المدة المتاحة للعميل لمراجعة التسليمات',
  },
  'clarityCheck.noCapacityCap': {
    en: 'No capacity cap for retainer - Set monthly limits or out-of-scope rates',
    ar: 'لا يوجد حد للقدرة في الاشتراك - حدد الحدود الشهرية أو أسعار العمل خارج النطاق',
  },
  'clarityCheck.noTerminationNotice': {
    en: 'No termination notice period - Define how much notice is required to end the agreement',
    ar: 'لا يوجد فترة إشعار للإنهاء - حدد مدة الإشعار المطلوبة لإنهاء الاتفاقية',
  },
  'clarityCheck.noBugFixWindow': {
    en: 'No bug fix window defined - For development work, specify how long you will fix bugs after delivery',
    ar: 'لم يتم تحديد فترة إصلاح الأخطاء - لأعمال التطوير، حدد مدة إصلاح الأخطاء بعد التسليم',
  },
  'clarityCheck.noRevisionLimit': {
    en: 'No revision limit set - For design work, specify how many revision rounds are included',
    ar: 'لم يتم تحديد حد للمراجعات - لأعمال التصميم، حدد عدد جولات المراجعة المشمولة',
  },
  'clarityCheck.noDependencies': {
    en: 'No dependencies listed - Document what you need from the client to proceed',
    ar: 'لم يتم تحديد متطلبات - وثق ما تحتاجه من العميل للمتابعة',
  },
  'clarityCheck.noDeliverables': {
    en: 'No deliverables defined - List specific outputs the client will receive',
    ar: 'لم يتم تحديد التسليمات - حدد المخرجات التي سيستلمها العميل',
  },
  'clarityCheck.noMilestones': {
    en: 'No milestones set - Breaking work into milestones helps track progress',
    ar: 'لم يتم تحديد معالم - تقسيم العمل إلى معالم يساعد في تتبع التقدم',
  },
  'clarityCheck.lateFeeOff': {
    en: 'Late payment fee disabled - Consider enabling to encourage timely payments',
    ar: 'رسوم التأخير معطلة - فكر في تفعيلها لتشجيع الدفع في الوقت المحدد',
  },
  'clarityCheck.noDisputePath': {
    en: 'No dispute resolution path - Define how disagreements will be resolved',
    ar: 'لم يتم تحديد مسار حل النزاعات - حدد كيفية حل الخلافات',
  },
  'clarityCheck.noGoverningLaw': {
    en: 'No governing law specified - Consider stating which jurisdiction applies',
    ar: 'لم يتم تحديد القانون المعمول به - فكر في تحديد الاختصاص القضائي المطبق',
  },
  'clarityCheck.noOwnershipRule': {
    en: 'No ownership transfer rule - Define when work ownership transfers to the client',
    ar: 'لم يتم تحديد قاعدة نقل الملكية - حدد متى تنتقل ملكية العمل للعميل',
  },
  'clarityCheck.noSummary': {
    en: 'No project summary - A brief description helps set expectations',
    ar: 'لا يوجد ملخص للمشروع - وصف موجز يساعد في تحديد التوقعات',
  },
};
