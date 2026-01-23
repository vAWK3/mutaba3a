/**
 * Demo Transactions Generator
 *
 * Creates 12 months of realistic transactions with:
 * - First transaction one year ago, last transaction today
 * - Mix of income (paid + unpaid) and expenses
 * - Multi-currency support (70% ILS, 30% USD)
 * - Realistic amounts for freelance work
 * - Some overdue receivables for demo visibility
 */

import type { Transaction, Currency, TxKind, TxStatus } from '../../types';
import { SeededRandom } from '../prng';
import { DEMO_SEED, DEMO_PREFIXES, DEMO_CONFIG } from '../constants';
import { getDemoClientIds } from './clients';
import { getDemoProjectIds, getDemoProjectClientMap } from './projects';
import { getDemoIncomeCategoryIds, getDemoExpenseCategoryIds } from './categories';

const rng = new SeededRandom(DEMO_SEED + 4);

// Transaction titles for variety
const INCOME_TITLES = [
  'دفعة مقدمة',
  'دفعة نهائية',
  'استشارة',
  'تطوير مخصص',
  'تصميم واجهة',
  'صيانة شهرية',
  'تحديثات النظام',
  'دعم فني',
  'تدريب',
  'مراجعة وتعديل',
];

const EXPENSE_TITLES = [
  'اشتراك GitHub',
  'اشتراك Figma',
  'استضافة السيرفر',
  'نطاق الموقع',
  'برنامج Office',
  'معدات مكتبية',
  'قرطاسية',
  'سفر للعميل',
  'مؤتمر تقني',
  'كتب ودورات',
];

interface TransactionTemplate {
  kind: TxKind;
  status: TxStatus;
  currency: Currency;
  minAmount: number;
  maxAmount: number;
}

function getTransactionTemplate(): TransactionTemplate {
  const kindRoll = rng.next();

  if (kindRoll < 0.7) {
    // 70% income
    const statusRoll = rng.next();
    const currencyRoll = rng.next();
    const currency: Currency = currencyRoll < DEMO_CONFIG.ilsRatio ? 'ILS' : 'USD';

    let status: TxStatus;
    if (statusRoll < DEMO_CONFIG.paidRatio) {
      status = 'paid';
    } else {
      status = 'unpaid';
    }

    return {
      kind: 'income',
      status,
      currency,
      minAmount: currency === 'ILS' ? 1000 : 300,
      maxAmount: currency === 'ILS' ? 15000 : 4000,
    };
  } else {
    // 30% expense
    const currencyRoll = rng.next();
    const currency: Currency = currencyRoll < 0.8 ? 'ILS' : 'USD';

    return {
      kind: 'expense',
      status: 'paid',
      currency,
      minAmount: currency === 'ILS' ? 50 : 15,
      maxAmount: currency === 'ILS' ? 2000 : 500,
    };
  }
}

export function createDemoTransactions(): Transaction[] {
  const transactions: Transaction[] = [];
  const clientIds = getDemoClientIds();
  const projectIds = getDemoProjectIds();
  const projectClientMap = getDemoProjectClientMap();
  const incomeCategoryIds = getDemoIncomeCategoryIds();
  const expenseCategoryIds = getDemoExpenseCategoryIds();

  // Reference date is today (real time, not frozen)
  const referenceDate = new Date();
  const currentYear = referenceDate.getFullYear();
  const currentMonth = referenceDate.getMonth();

  // Generate transactions over 12 months (one full year)
  for (let monthOffset = -11; monthOffset <= 0; monthOffset++) {
    const monthDate = new Date(currentYear, currentMonth + monthOffset, 1);
    // For current month, end date is today; for past months, end of month
    const monthEnd = monthOffset === 0
      ? referenceDate
      : new Date(currentYear, currentMonth + monthOffset + 1, 0);

    // More transactions in recent months
    const txCount = monthOffset === 0 ? 10 : monthOffset >= -2 ? rng.int(8, 12) : rng.int(6, 10);

    for (let i = 0; i < txCount; i++) {
      const template = getTransactionTemplate();
      const txIndex = transactions.length + 1;

      // Pick a project (and associated client)
      const projectId = rng.pick(projectIds);
      const clientId = projectClientMap.get(projectId) || rng.pick(clientIds);

      // Generate date within the month
      const occurredAt = rng.dateString(monthDate, monthEnd);

      // Generate amount
      const amountMinor = rng.amountMinor(template.minAmount, template.maxAmount);

      // Generate due date and paid date for income
      let dueDate: string | undefined;
      let paidAt: string | undefined;

      if (template.kind === 'income') {
        const occurredDate = new Date(occurredAt);
        const dueDateObj = new Date(occurredDate);
        dueDateObj.setDate(dueDateObj.getDate() + rng.pick([14, 30, 45]));
        dueDate = dueDateObj.toISOString().split('T')[0];

        if (template.status === 'paid') {
          // Paid sometime between occurred and due (or slightly after)
          const payDateObj = new Date(occurredDate);
          payDateObj.setDate(
            payDateObj.getDate() + rng.int(1, Math.max(1, (dueDateObj.getTime() - occurredDate.getTime()) / (1000 * 60 * 60 * 24) + 5))
          );
          paidAt = payDateObj.toISOString();
        }
      } else {
        // Expenses are always paid
        const occurredDate = new Date(occurredAt);
        paidAt = occurredDate.toISOString();
      }

      // Pick title and category
      const title =
        template.kind === 'income'
          ? rng.pick(INCOME_TITLES)
          : rng.pick(EXPENSE_TITLES);

      const categoryId =
        template.kind === 'income'
          ? rng.pick(incomeCategoryIds)
          : rng.pick(expenseCategoryIds);

      const now = new Date().toISOString();

      transactions.push({
        id: `${DEMO_PREFIXES.transaction}${String(txIndex).padStart(3, '0')}`,
        kind: template.kind,
        status: template.status,
        title,
        clientId: template.kind === 'income' ? clientId : undefined,
        projectId: template.kind === 'income' ? projectId : undefined,
        categoryId,
        amountMinor,
        currency: template.currency,
        occurredAt,
        dueDate,
        paidAt,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  // Add a few overdue receivables for demo visibility
  addOverdueReceivables(transactions, clientIds, projectIds, projectClientMap, incomeCategoryIds, referenceDate);

  // Add a few due soon receivables
  addDueSoonReceivables(transactions, clientIds, projectIds, projectClientMap, incomeCategoryIds, referenceDate);

  return transactions;
}

function addOverdueReceivables(
  transactions: Transaction[],
  clientIds: string[],
  projectIds: string[],
  projectClientMap: Map<string, string>,
  incomeCategoryIds: string[],
  referenceDate: Date
) {
  // Add 2-3 overdue receivables
  for (let i = 0; i < 3; i++) {
    const txIndex = transactions.length + 1;
    const projectId = rng.pick(projectIds);
    const clientId = projectClientMap.get(projectId) || rng.pick(clientIds);

    const daysOverdue = rng.int(5, 30);
    const dueDate = new Date(referenceDate);
    dueDate.setDate(dueDate.getDate() - daysOverdue);

    const occurredDate = new Date(dueDate);
    occurredDate.setDate(occurredDate.getDate() - rng.int(14, 30));

    const currency: Currency = rng.chance(0.7) ? 'ILS' : 'USD';
    const amountMinor = rng.amountMinor(
      currency === 'ILS' ? 2000 : 500,
      currency === 'ILS' ? 8000 : 2000
    );

    const now = new Date().toISOString();

    transactions.push({
      id: `${DEMO_PREFIXES.transaction}${String(txIndex).padStart(3, '0')}`,
      kind: 'income',
      status: 'unpaid',
      title: rng.pick(['فاتورة متأخرة', 'دفعة مستحقة', 'رصيد سابق']),
      clientId,
      projectId,
      categoryId: rng.pick(incomeCategoryIds),
      amountMinor,
      currency,
      occurredAt: occurredDate.toISOString().split('T')[0],
      dueDate: dueDate.toISOString().split('T')[0],
      createdAt: now,
      updatedAt: now,
    });
  }
}

function addDueSoonReceivables(
  transactions: Transaction[],
  clientIds: string[],
  projectIds: string[],
  projectClientMap: Map<string, string>,
  incomeCategoryIds: string[],
  referenceDate: Date
) {
  // Add 2-3 due soon receivables (within 7 days)
  for (let i = 0; i < 3; i++) {
    const txIndex = transactions.length + 1;
    const projectId = rng.pick(projectIds);
    const clientId = projectClientMap.get(projectId) || rng.pick(clientIds);

    const daysUntilDue = rng.int(1, 7);
    const dueDate = new Date(referenceDate);
    dueDate.setDate(dueDate.getDate() + daysUntilDue);

    const occurredDate = new Date(referenceDate);
    occurredDate.setDate(occurredDate.getDate() - rng.int(7, 21));

    const currency: Currency = rng.chance(0.7) ? 'ILS' : 'USD';
    const amountMinor = rng.amountMinor(
      currency === 'ILS' ? 1500 : 400,
      currency === 'ILS' ? 6000 : 1500
    );

    const now = new Date().toISOString();

    transactions.push({
      id: `${DEMO_PREFIXES.transaction}${String(txIndex).padStart(3, '0')}`,
      kind: 'income',
      status: 'unpaid',
      title: rng.pick(['فاتورة جديدة', 'دفعة قادمة', 'مستحق قريباً']),
      clientId,
      projectId,
      categoryId: rng.pick(incomeCategoryIds),
      amountMinor,
      currency,
      occurredAt: occurredDate.toISOString().split('T')[0],
      dueDate: dueDate.toISOString().split('T')[0],
      createdAt: now,
      updatedAt: now,
    });
  }
}

export function getDemoTransactionIds(): string[] {
  // Approximate count
  return Array.from({ length: 80 }, (_, i) =>
    `${DEMO_PREFIXES.transaction}${String(i + 1).padStart(3, '0')}`
  );
}
