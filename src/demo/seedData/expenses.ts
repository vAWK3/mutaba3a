/**
 * Demo Expenses Generator
 *
 * Creates profile-scoped expenses with recurring rules.
 */

import type { Expense, RecurringRule } from '../../types';
import { SeededRandom } from '../prng';
import { DEMO_SEED, DEMO_PREFIXES } from '../constants';
import { getDemoProfileId } from './profile';
import { getDemoProfileExpenseCategoryIds } from './categories';

const rng = new SeededRandom(DEMO_SEED + 6);

// One-time expense templates
const ONE_TIME_EXPENSES = [
  { title: 'كرسي مكتب جديد', vendor: 'ايكيا', categoryIndex: 2, minAmount: 500, maxAmount: 1500 },
  { title: 'شاشة إضافية', vendor: 'אלקטרה', categoryIndex: 2, minAmount: 800, maxAmount: 2000 },
  { title: 'دورة تدريبية', vendor: 'Udemy', categoryIndex: 5, minAmount: 150, maxAmount: 500 },
  { title: 'كتب مهنية', vendor: 'Amazon', categoryIndex: 5, minAmount: 100, maxAmount: 400 },
  { title: 'إعلانات فيسبوك', vendor: 'Meta', categoryIndex: 3, minAmount: 200, maxAmount: 1000 },
  { title: 'إعلانات جوجل', vendor: 'Google', categoryIndex: 3, minAmount: 300, maxAmount: 1500 },
  { title: 'سفر للقاء عميل', vendor: 'Moovit', categoryIndex: 4, minAmount: 50, maxAmount: 200 },
  { title: 'غداء عمل', vendor: 'مطعم', categoryIndex: 6, minAmount: 80, maxAmount: 250 },
];

// Recurring expense templates
const RECURRING_EXPENSES = [
  { title: 'اشتراك GitHub', vendor: 'GitHub', categoryIndex: 0, amount: 40, frequency: 'monthly' as const },
  { title: 'اشتراك Figma', vendor: 'Figma', categoryIndex: 0, amount: 60, frequency: 'monthly' as const },
  { title: 'استضافة الخادم', vendor: 'DigitalOcean', categoryIndex: 1, amount: 80, frequency: 'monthly' as const },
  { title: 'نطاقات المواقع', vendor: 'Cloudflare', categoryIndex: 1, amount: 150, frequency: 'yearly' as const },
];

export function createDemoRecurringRules(): RecurringRule[] {
  const profileId = getDemoProfileId();
  const categoryIds = getDemoProfileExpenseCategoryIds();
  const now = new Date().toISOString();

  // Start date 12 months ago (one full year)
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - 11);
  startDate.setDate(1);

  return RECURRING_EXPENSES.map((expense, index) => ({
    id: `${DEMO_PREFIXES.recurringRule}${String(index + 1).padStart(3, '0')}`,
    profileId,
    title: expense.title,
    vendor: expense.vendor,
    categoryId: categoryIds[expense.categoryIndex],
    amountMinor: expense.amount * 100 * (expense.frequency === 'monthly' ? 1 : 1), // USD amounts
    currency: 'USD',
    frequency: expense.frequency,
    startDate: startDate.toISOString().split('T')[0],
    endMode: 'noEnd',
    isPaused: false,
    createdAt: now,
    updatedAt: now,
  }));
}

export function createDemoExpenses(): Expense[] {
  const profileId = getDemoProfileId();
  const categoryIds = getDemoProfileExpenseCategoryIds();
  const referenceDate = new Date(); // Use current date, not frozen time
  const expenses: Expense[] = [];
  let expenseIndex = 1;

  // Generate recurring expenses for past 12 months (one full year)
  const recurringRules = createDemoRecurringRules();

  for (let monthOffset = -11; monthOffset <= 0; monthOffset++) {
    const monthDate = new Date(referenceDate);
    monthDate.setMonth(monthDate.getMonth() + monthOffset);
    monthDate.setDate(1);

    // Add recurring expenses
    recurringRules.forEach((rule) => {
      // Skip yearly expenses except in month -11 (start of year range)
      if (rule.frequency === 'yearly' && monthOffset !== -11) return;

      const occurredAt = new Date(monthDate);
      occurredAt.setDate(rng.int(1, 15));

      const now = new Date().toISOString();

      expenses.push({
        id: `${DEMO_PREFIXES.expense}${String(expenseIndex++).padStart(3, '0')}`,
        profileId,
        title: rule.title,
        vendor: rule.vendor,
        categoryId: rule.categoryId,
        amountMinor: rule.amountMinor,
        currency: rule.currency,
        occurredAt: occurredAt.toISOString().split('T')[0],
        recurringRuleId: rule.id,
        createdAt: now,
        updatedAt: now,
      });
    });

    // Add 2-4 one-time expenses per month
    const oneTimeCount = rng.int(2, 4);
    const selectedExpenses = rng.pickMany(ONE_TIME_EXPENSES, oneTimeCount);

    selectedExpenses.forEach((template) => {
      const occurredAt = new Date(monthDate);
      occurredAt.setDate(rng.int(1, 28));

      const currency = rng.chance(0.7) ? 'ILS' : 'USD';
      const amountMinor = rng.amountMinor(
        currency === 'ILS' ? template.minAmount : template.minAmount / 3.5,
        currency === 'ILS' ? template.maxAmount : template.maxAmount / 3.5
      );

      const now = new Date().toISOString();

      expenses.push({
        id: `${DEMO_PREFIXES.expense}${String(expenseIndex++).padStart(3, '0')}`,
        profileId,
        title: template.title,
        vendor: template.vendor,
        categoryId: categoryIds[template.categoryIndex],
        amountMinor,
        currency,
        occurredAt: occurredAt.toISOString().split('T')[0],
        createdAt: now,
        updatedAt: now,
      });
    });
  }

  return expenses;
}

export function getDemoExpenseIds(): string[] {
  return Array.from({ length: 50 }, (_, i) =>
    `${DEMO_PREFIXES.expense}${String(i + 1).padStart(3, '0')}`
  );
}

export function getDemoRecurringRuleIds(): string[] {
  return RECURRING_EXPENSES.map((_, index) =>
    `${DEMO_PREFIXES.recurringRule}${String(index + 1).padStart(3, '0')}`
  );
}
