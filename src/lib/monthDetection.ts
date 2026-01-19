/**
 * Month Detection Utility for Bulk Upload
 *
 * Detects the month from file metadata (lastModified date)
 * and provides utilities for month key manipulation.
 */

/**
 * Detect month from file's lastModified date
 *
 * @param file - The file to detect month from
 * @returns YYYY-MM format string
 */
export function detectMonthFromFile(file: File): string {
  const date = new Date(file.lastModified);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Get current month key
 *
 * @returns YYYY-MM format string
 */
export function getCurrentMonthKey(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Parse a month key into year and month
 *
 * @param monthKey - YYYY-MM format string
 * @returns { year, month }
 */
export function parseMonthKey(monthKey: string): { year: number; month: number } {
  const [year, month] = monthKey.split('-').map(Number);
  return { year, month };
}

/**
 * Format a month key for display
 *
 * @param monthKey - YYYY-MM format string
 * @param locale - Locale for formatting (default: 'en')
 * @returns Formatted month string (e.g., "January 2024")
 */
export function formatMonthKey(monthKey: string, locale = 'en'): string {
  const { year, month } = parseMonthKey(monthKey);
  const date = new Date(year, month - 1, 1);
  return date.toLocaleDateString(locale, { year: 'numeric', month: 'long' });
}

/**
 * Get month keys for the last N months
 *
 * @param count - Number of months to get
 * @returns Array of YYYY-MM format strings
 */
export function getRecentMonthKeys(count = 12): string[] {
  const months: string[] = [];
  const now = new Date();

  for (let i = 0; i < count; i++) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    months.push(`${year}-${month}`);
  }

  return months;
}

/**
 * Check if a month key is in the past
 *
 * @param monthKey - YYYY-MM format string
 * @returns True if the month is before the current month
 */
export function isPastMonth(monthKey: string): boolean {
  const current = getCurrentMonthKey();
  return monthKey < current;
}

/**
 * Check if a month key is the current month
 *
 * @param monthKey - YYYY-MM format string
 * @returns True if the month is the current month
 */
export function isCurrentMonth(monthKey: string): boolean {
  return monthKey === getCurrentMonthKey();
}

/**
 * Get the next month key
 *
 * @param monthKey - YYYY-MM format string
 * @returns YYYY-MM format string for the next month
 */
export function getNextMonthKey(monthKey: string): string {
  const { year, month } = parseMonthKey(monthKey);
  const date = new Date(year, month, 1); // month is 0-indexed, so this gives next month
  const nextYear = date.getFullYear();
  const nextMonth = String(date.getMonth() + 1).padStart(2, '0');
  return `${nextYear}-${nextMonth}`;
}

/**
 * Get the previous month key
 *
 * @param monthKey - YYYY-MM format string
 * @returns YYYY-MM format string for the previous month
 */
export function getPreviousMonthKey(monthKey: string): string {
  const { year, month } = parseMonthKey(monthKey);
  const date = new Date(year, month - 2, 1); // month is 0-indexed, subtract 2 to get previous
  const prevYear = date.getFullYear();
  const prevMonth = String(date.getMonth() + 1).padStart(2, '0');
  return `${prevYear}-${prevMonth}`;
}
