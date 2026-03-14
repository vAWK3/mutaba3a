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

// Import template columns
export const IMPORT_TEMPLATE_COLUMNS = [
  'type',
  'name',
  'email',
  'phone',
  'client',
  'project',
  'field',
  'amount',
  'currency',
  'status',
  'date',
  'dueDate',
  'paidAt',
  'category',
  'notes',
] as const;

/**
 * Parse CSV content into array of objects.
 * Handles BOM, quoted fields, and newlines in quotes.
 */
export function parseCSV(content: string): Record<string, string>[] {
  // Remove BOM if present
  const cleanContent = content.replace(/^\uFEFF/, '');

  const lines: string[] = [];
  let currentLine = '';
  let inQuotes = false;

  // Split by newlines, respecting quotes
  for (let i = 0; i < cleanContent.length; i++) {
    const char = cleanContent[i];
    const nextChar = cleanContent[i + 1];

    if (char === '"') {
      // Add the quote to the line
      currentLine += char;

      // Handle escaped quotes
      if (inQuotes && nextChar === '"') {
        currentLine += '"';
        i++; // Skip next quote
      } else {
        // Toggle quote state
        inQuotes = !inQuotes;
      }
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      // End of line (not in quotes)
      if (currentLine.trim()) {
        lines.push(currentLine);
      }
      currentLine = '';
      // Skip \r\n combination
      if (char === '\r' && nextChar === '\n') {
        i++;
      }
    } else {
      currentLine += char;
    }
  }

  // Add last line
  if (currentLine.trim()) {
    lines.push(currentLine);
  }

  if (lines.length === 0) {
    return [];
  }

  // Parse header row
  const headers = parseCSVLine(lines[0]);

  // Parse data rows
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row: Record<string, string> = {};

    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] || '';
    }

    rows.push(row);
  }

  return rows;
}

/**
 * Parse a single CSV line into array of values.
 * Handles quoted fields, escaped quotes, and commas within quotes.
 */
function parseCSVLine(line: string): string[] {
  const values: string[] = [];
  let currentValue = '';
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const char = line[i];

    if (inQuotes) {
      // Inside quoted field
      if (char === '"') {
        if (line[i + 1] === '"') {
          // Escaped quote - add one quote and skip next
          currentValue += '"';
          i += 2;
        } else {
          // End quote
          inQuotes = false;
          i++;
        }
      } else {
        currentValue += char;
        i++;
      }
    } else {
      // Outside quoted field
      if (char === '"') {
        // Start quote
        inQuotes = true;
        i++;
      } else if (char === ',') {
        // Field separator
        values.push(currentValue);
        currentValue = '';
        i++;
      } else {
        currentValue += char;
        i++;
      }
    }
  }

  // Add last value
  values.push(currentValue);

  return values;
}

/**
 * Generate a CSV import template with example rows showing all valid enum values.
 */
export function generateImportTemplate(): string {
  const headers = [...IMPORT_TEMPLATE_COLUMNS];

  const examples = [
    // Header explanation row (will be commented out in production, but helpful in template)
    {
      type: '# TYPE OPTIONS: client, project, income, expense',
      name: '# FIELD OPTIONS (projects): design, development, consulting, marketing, legal, maintenance, other',
      email: '# CURRENCY OPTIONS: USD, ILS, EUR',
      phone: '# STATUS OPTIONS (income only): paid, unpaid',
      client: '',
      project: '',
      field: '',
      amount: '',
      currency: '',
      status: '',
      date: '',
      dueDate: '',
      paidAt: '',
      category: '',
      notes: '',
    },
    // Client examples
    {
      type: 'client',
      name: 'Acme Corp',
      email: 'contact@acme.com',
      phone: '+1-555-0100',
      client: '',
      project: '',
      field: '',
      amount: '',
      currency: '',
      status: '',
      date: '',
      dueDate: '',
      paidAt: '',
      category: '',
      notes: 'Example client',
    },
    // Project examples showing different field values
    {
      type: 'project',
      name: 'Website Redesign',
      email: '',
      phone: '',
      client: 'Acme Corp',
      project: '',
      field: 'design',
      amount: '',
      currency: '',
      status: '',
      date: '',
      dueDate: '',
      paidAt: '',
      category: '',
      notes: '',
    },
    {
      type: 'project',
      name: 'Mobile App',
      email: '',
      phone: '',
      client: 'Acme Corp',
      project: '',
      field: 'development',
      amount: '',
      currency: '',
      status: '',
      date: '',
      dueDate: '',
      paidAt: '',
      category: '',
      notes: '',
    },
    // Income - paid status (USD)
    {
      type: 'income',
      name: 'Design payment',
      email: '',
      phone: '',
      client: 'Acme Corp',
      project: 'Website Redesign',
      field: '',
      amount: '5000',
      currency: 'USD',
      status: 'paid',
      date: '2024-01-15',
      dueDate: '',
      paidAt: '2024-01-15',
      category: '',
      notes: '',
    },
    // Income - unpaid status (ILS)
    {
      type: 'income',
      name: 'Development payment',
      email: '',
      phone: '',
      client: 'Acme Corp',
      project: 'Website Redesign',
      field: '',
      amount: '25000',
      currency: 'ILS',
      status: 'unpaid',
      date: '2024-02-01',
      dueDate: '2024-02-15',
      paidAt: '',
      category: '',
      notes: '',
    },
    // Income - unpaid status (EUR)
    {
      type: 'income',
      name: 'Consulting',
      email: '',
      phone: '',
      client: 'Acme Corp',
      project: '',
      field: '',
      amount: '2000',
      currency: 'EUR',
      status: 'unpaid',
      date: '2024-02-10',
      dueDate: '2024-03-10',
      paidAt: '',
      category: '',
      notes: '',
    },
    // Expense examples (no status field)
    {
      type: 'expense',
      name: 'Software subscription',
      email: '',
      phone: '',
      client: '',
      project: '',
      field: '',
      amount: '99.99',
      currency: 'USD',
      status: '',
      date: '2024-01-01',
      dueDate: '',
      paidAt: '',
      category: 'Software',
      notes: '',
    },
  ];

  return toCsv(examples, headers);
}

/**
 * Convert exported data to CSV format matching the import template.
 * This allows users to export their data and re-import it later.
 */
export function exportDataToCSV(data: {
  clients: Array<{ id: string; name: string; email?: string; phone?: string; notes?: string }>;
  projects: Array<{
    id: string;
    name: string;
    clientId?: string;
    field?: string;
    notes?: string;
  }>;
  transactions: Array<{
    id: string;
    kind: 'income' | 'expense';
    status?: 'paid' | 'unpaid';
    title?: string;
    clientId?: string;
    projectId?: string;
    categoryId?: string;
    amountMinor: number;
    currency: string;
    occurredAt: Date | string;
    dueDate?: Date | string | null;
    paidAt?: Date | string | null;
    notes?: string;
  }>;
}): string {
  const rows: Record<string, string | number>[] = [];

  // Create lookup maps for resolving IDs to names
  const clientMap = new Map(data.clients.map((c) => [c.id, c.name]));
  const projectMap = new Map(data.projects.map((p) => [p.id, p.name]));

  // Add clients
  data.clients.forEach((client) => {
    rows.push({
      type: 'client',
      name: client.name,
      email: client.email || '',
      phone: client.phone || '',
      client: '',
      project: '',
      field: '',
      amount: '',
      currency: '',
      status: '',
      date: '',
      dueDate: '',
      paidAt: '',
      category: '',
      notes: client.notes || '',
    });
  });

  // Add projects
  data.projects.forEach((project) => {
    rows.push({
      type: 'project',
      name: project.name,
      email: '',
      phone: '',
      client: project.clientId ? clientMap.get(project.clientId) || '' : '',
      project: '',
      field: project.field || '',
      amount: '',
      currency: '',
      status: '',
      date: '',
      dueDate: '',
      paidAt: '',
      category: '',
      notes: project.notes || '',
    });
  });

  // Add transactions (income and expenses)
  data.transactions.forEach((tx) => {
    const formatDate = (d: Date | string | null | undefined) => {
      if (!d) return '';
      const date = typeof d === 'string' ? new Date(d) : d;
      return date.toISOString().split('T')[0]; // YYYY-MM-DD
    };

    rows.push({
      type: tx.kind,
      name: tx.title || '',
      email: '',
      phone: '',
      client: tx.clientId ? clientMap.get(tx.clientId) || '' : '',
      project: tx.projectId ? projectMap.get(tx.projectId) || '' : '',
      field: '',
      amount: (tx.amountMinor / 100).toFixed(2), // Convert minor units to major
      currency: tx.currency,
      status: tx.status || '',
      date: formatDate(tx.occurredAt),
      dueDate: formatDate(tx.dueDate),
      paidAt: formatDate(tx.paidAt),
      category: tx.categoryId || '',
      notes: tx.notes || '',
    });
  });

  return toCsv(rows, [...IMPORT_TEMPLATE_COLUMNS]);
}
