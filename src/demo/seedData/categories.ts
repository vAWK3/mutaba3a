/**
 * Demo Categories Generator
 *
 * Creates income and expense categories for demo transactions.
 */

import type { Category, ExpenseCategory } from '../../types';
import { DEMO_PREFIXES } from '../constants';
import { getDemoProfileId } from './profile';

// Income categories (for transactions)
const INCOME_CATEGORIES = [
  { name: 'تطوير البرمجيات', nameEn: 'Software Development' },
  { name: 'تصميم جرافيك', nameEn: 'Graphic Design' },
  { name: 'استشارات', nameEn: 'Consulting' },
  { name: 'صيانة ودعم', nameEn: 'Maintenance & Support' },
  { name: 'تسويق رقمي', nameEn: 'Digital Marketing' },
] as const;

// Expense categories (for transactions)
const EXPENSE_CATEGORIES_TX = [
  { name: 'برمجيات واشتراكات', nameEn: 'Software & Subscriptions' },
  { name: 'أجهزة ومعدات', nameEn: 'Equipment' },
  { name: 'مكتب ومصاريف إدارية', nameEn: 'Office & Admin' },
  { name: 'سفر ومواصلات', nameEn: 'Travel & Transport' },
] as const;

// Profile expense categories (for expense tracking)
const PROFILE_EXPENSE_CATEGORIES = [
  { name: 'برمجيات', color: '#3b82f6' },
  { name: 'استضافة', color: '#8b5cf6' },
  { name: 'مكتب', color: '#10b981' },
  { name: 'تسويق', color: '#f59e0b' },
  { name: 'سفر', color: '#ef4444' },
  { name: 'تدريب', color: '#6366f1' },
  { name: 'متنوع', color: '#6b7280' },
] as const;

export function createDemoCategories(): Category[] {
  const categories: Category[] = [];

  // Income categories
  INCOME_CATEGORIES.forEach((cat, index) => {
    categories.push({
      id: `${DEMO_PREFIXES.category}income_${String(index + 1).padStart(2, '0')}`,
      kind: 'income',
      name: cat.name,
    });
  });

  // Expense categories for transactions
  EXPENSE_CATEGORIES_TX.forEach((cat, index) => {
    categories.push({
      id: `${DEMO_PREFIXES.category}expense_${String(index + 1).padStart(2, '0')}`,
      kind: 'expense',
      name: cat.name,
    });
  });

  return categories;
}

export function createDemoExpenseCategories(): ExpenseCategory[] {
  const profileId = getDemoProfileId();

  return PROFILE_EXPENSE_CATEGORIES.map((cat, index) => ({
    id: `${DEMO_PREFIXES.expenseCategory}${String(index + 1).padStart(3, '0')}`,
    profileId,
    name: cat.name,
    color: cat.color,
  }));
}

export function getDemoIncomeCategoryIds(): string[] {
  return INCOME_CATEGORIES.map((_, index) =>
    `${DEMO_PREFIXES.category}income_${String(index + 1).padStart(2, '0')}`
  );
}

export function getDemoExpenseCategoryIds(): string[] {
  return EXPENSE_CATEGORIES_TX.map((_, index) =>
    `${DEMO_PREFIXES.category}expense_${String(index + 1).padStart(2, '0')}`
  );
}

export function getDemoProfileExpenseCategoryIds(): string[] {
  return PROFILE_EXPENSE_CATEGORIES.map((_, index) =>
    `${DEMO_PREFIXES.expenseCategory}${String(index + 1).padStart(3, '0')}`
  );
}
