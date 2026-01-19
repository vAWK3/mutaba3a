/**
 * Receipt-Expense Matching Algorithm
 *
 * Scoring breakdown:
 * - Amount (0-50): Exact match within 1% = 50, within 5% = 40, within 10% = 30
 * - Date (0-25): Same day = 25, within 3 days = 20, within 7 days = 15, same month = 10
 * - Vendor (0-25): Same vendorId = 25, similarity >80% = 20, similarity 50-80% = 10
 *
 * Confidence levels:
 * - High: score >= 80
 * - Medium: score >= 60
 * - Low: score >= 40
 */

import type { Receipt, ExpenseDisplay, ReceiptMatchSuggestion } from '../types';
import { vendorSimilarity } from './vendorNormalization';

export interface MatchScoreBreakdown {
  amountScore: number;
  dateScore: number;
  vendorScore: number;
}

export interface MatchResult {
  score: number;
  breakdown: MatchScoreBreakdown;
  confidence: 'high' | 'medium' | 'low' | 'none';
}

/**
 * Calculate the amount matching score between receipt and expense
 */
function calculateAmountScore(receiptAmount?: number, expenseAmount?: number): number {
  if (!receiptAmount || !expenseAmount) return 0;
  if (expenseAmount === 0) return 0;

  const diff = Math.abs(receiptAmount - expenseAmount);
  const percentDiff = diff / expenseAmount;

  if (percentDiff <= 0.01) return 50; // Within 1%
  if (percentDiff <= 0.05) return 40; // Within 5%
  if (percentDiff <= 0.10) return 30; // Within 10%
  if (percentDiff <= 0.20) return 20; // Within 20%
  return 0;
}

/**
 * Calculate the date matching score between receipt and expense
 */
function calculateDateScore(
  receiptDate: string | undefined,
  expenseDate: string,
  receiptMonthKey: string
): number {
  if (receiptDate) {
    const rDate = new Date(receiptDate);
    const eDate = new Date(expenseDate);
    const daysDiff = Math.abs(
      Math.floor((rDate.getTime() - eDate.getTime()) / (1000 * 60 * 60 * 24))
    );

    if (daysDiff === 0) return 25; // Same day
    if (daysDiff <= 3) return 20; // Within 3 days
    if (daysDiff <= 7) return 15; // Within 7 days
    if (daysDiff <= 30) return 10; // Within same month
    return 0;
  }

  // No date on receipt, use month matching
  const expenseMonthKey = expenseDate.substring(0, 7);
  return receiptMonthKey === expenseMonthKey ? 10 : 0;
}

/**
 * Calculate the vendor matching score between receipt and expense
 */
function calculateVendorScore(
  receiptVendorId: string | undefined,
  receiptVendorRaw: string | undefined,
  expenseVendorId: string | undefined,
  expenseVendor: string | undefined
): number {
  // Same vendor ID (exact match)
  if (receiptVendorId && expenseVendorId && receiptVendorId === expenseVendorId) {
    return 25;
  }

  // Raw vendor name similarity
  if (receiptVendorRaw && expenseVendor) {
    const similarity = vendorSimilarity(receiptVendorRaw, expenseVendor);
    if (similarity >= 0.8) return 20;
    if (similarity >= 0.5) return 10;
  }

  return 0;
}

/**
 * Calculate the full match result between a receipt and an expense
 */
export function calculateMatch(receipt: Receipt, expense: ExpenseDisplay): MatchResult {
  const amountScore = calculateAmountScore(receipt.amountMinor, expense.amountMinor);
  const dateScore = calculateDateScore(receipt.occurredAt, expense.occurredAt, receipt.monthKey);
  const vendorScore = calculateVendorScore(
    receipt.vendorId,
    receipt.vendorRaw,
    expense.vendorId,
    expense.vendor
  );

  const score = amountScore + dateScore + vendorScore;

  let confidence: 'high' | 'medium' | 'low' | 'none';
  if (score >= 80) {
    confidence = 'high';
  } else if (score >= 60) {
    confidence = 'medium';
  } else if (score >= 40) {
    confidence = 'low';
  } else {
    confidence = 'none';
  }

  return {
    score,
    breakdown: { amountScore, dateScore, vendorScore },
    confidence,
  };
}

/**
 * Filter and sort match suggestions by score
 */
export function filterAndSortSuggestions(
  suggestions: ReceiptMatchSuggestion[],
  minScore = 40,
  limit = 5
): ReceiptMatchSuggestion[] {
  return suggestions
    .filter((s) => s.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Get confidence color class for UI
 */
export function getConfidenceColor(confidence: 'high' | 'medium' | 'low' | 'none'): string {
  switch (confidence) {
    case 'high':
      return 'text-success';
    case 'medium':
      return 'text-warning';
    case 'low':
      return 'text-muted';
    default:
      return 'text-muted';
  }
}

/**
 * Get confidence label for UI
 */
export function getConfidenceLabel(confidence: 'high' | 'medium' | 'low' | 'none'): string {
  switch (confidence) {
    case 'high':
      return 'High match';
    case 'medium':
      return 'Likely match';
    case 'low':
      return 'Possible match';
    default:
      return 'Low match';
  }
}
