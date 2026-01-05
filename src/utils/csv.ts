/**
 * CSV generation and download utilities
 */

/**
 * Convert array of objects to CSV string with proper escaping.
 * Handles commas, quotes, and newlines in values.
 */
export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  // Header row
  const header = columns.join(',');

  // Data rows with proper escaping
  const dataRows = rows.map((row) => {
    return columns
      .map((col) => {
        const value = row[col];
        if (value === null || value === undefined) return '';
        const str = String(value);
        // Escape if contains comma, quote, or newline
        if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      })
      .join(',');
  });

  return [header, ...dataRows].join('\n');
}

/**
 * Trigger browser download of a text file.
 */
export function downloadTextFile(
  filename: string,
  content: string,
  mime = 'text/csv;charset=utf-8'
): void {
  // Add BOM for UTF-8 CSV to ensure Excel opens it correctly
  const bom = mime.includes('csv') ? '\uFEFF' : '';
  const blob = new Blob([bom + content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Column definitions for CSV export
export const CLIENT_COLUMNS = [
  'id',
  'name',
  'email',
  'phone',
  'notes',
  'createdAt',
  'updatedAt',
  'archivedAt',
] as const;

export const PROJECT_COLUMNS = [
  'id',
  'name',
  'clientId',
  'field',
  'notes',
  'createdAt',
  'updatedAt',
  'archivedAt',
] as const;

export const TRANSACTION_COLUMNS = [
  'id',
  'kind',
  'status',
  'title',
  'clientId',
  'projectId',
  'categoryId',
  'amountMinor',
  'currency',
  'occurredAt',
  'dueDate',
  'paidAt',
  'notes',
  'createdAt',
  'updatedAt',
  'deletedAt',
] as const;
