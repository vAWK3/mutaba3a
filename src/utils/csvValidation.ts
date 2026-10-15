export const ValidationStatus = {
  NEW: 'new',
  DUPLICATE: 'duplicate',
  ERROR: 'error',
} as const;

export type ValidationStatus = typeof ValidationStatus[keyof typeof ValidationStatus];

export interface CSVValidationResult {
  rowIndex: number;
  status: ValidationStatus;
  errors: string[];
  warnings: string[];
  data: Record<string, string>;
}

const VALID_TYPES = ['client', 'project', 'income', 'expense', 'conversion'];
export const VALID_CURRENCIES = ['USD', 'ILS', 'EUR', 'JOD'];
const VALID_FIELDS = ['design', 'development', 'consulting', 'marketing', 'legal', 'maintenance', 'other'];
const VALID_INCOME_STATUSES = ['paid', 'unpaid'];

/**
 * Validate a single CSV row
 */
export function validateCSVRow(
  row: Record<string, string>,
  rowIndex: number,
  existingClients: string[] = [],
  existingProjects: string[] = []
): CSVValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let status: ValidationStatus = ValidationStatus.NEW;

  const type = row.type?.trim();

  // Validate type
  if (!type) {
    errors.push('Type is required');
    return { rowIndex, status: ValidationStatus.ERROR, errors, warnings, data: row };
  }

  if (!VALID_TYPES.includes(type)) {
    errors.push(`Invalid type. Must be one of: ${VALID_TYPES.join(', ')}`);
    return { rowIndex, status: ValidationStatus.ERROR, errors, warnings, data: row };
  }

  // Type-specific validation
  switch (type) {
    case 'client':
      validateClient(row, errors, warnings, existingClients);
      break;
    case 'project':
      validateProject(row, errors, warnings, existingProjects);
      break;
    case 'income':
      validateIncome(row, errors);
      break;
    case 'expense':
      validateExpense(row, errors);
      break;
    case 'conversion':
      validateConversion(row, errors);
      break;
  }

  // Determine final status
  if (errors.length > 0) {
    status = ValidationStatus.ERROR;
  } else if (warnings.length > 0) {
    status = ValidationStatus.DUPLICATE;
  }

  return { rowIndex, status, errors, warnings, data: row };
}

function validateClient(
  row: Record<string, string>,
  errors: string[],
  warnings: string[],
  existingClients: string[]
): void {
  const name = row.name?.trim();

  if (!name) {
    errors.push('Client name is required');
    return;
  }

  // Check for duplicate
  if (existingClients.includes(name)) {
    warnings.push('Client with this name already exists');
  }
}

function validateProject(
  row: Record<string, string>,
  errors: string[],
  warnings: string[],
  existingProjects: string[]
): void {
  const name = row.name?.trim();
  const field = row.field?.trim();

  if (!name) {
    errors.push('Project name is required');
    return;
  }

  // Check for duplicate
  if (existingProjects.includes(name)) {
    warnings.push('Project with this name already exists');
  }

  // Validate field if provided
  if (field && !VALID_FIELDS.includes(field)) {
    errors.push(`Invalid field value. Must be one of: ${VALID_FIELDS.join(', ')}`);
  }
}

function validateIncome(
  row: Record<string, string>,
  errors: string[]
): void {
  const amount = row.amount?.trim();
  const currency = row.currency?.trim();
  const status = row.status?.trim();
  const date = row.date?.trim();

  if (!amount) {
    errors.push('Amount is required for income');
  }

  if (!currency) {
    errors.push('Currency is required for income');
  } else if (!VALID_CURRENCIES.includes(currency)) {
    errors.push(`Invalid currency. Must be one of: ${VALID_CURRENCIES.join(', ')}`);
  }

  if (status && !VALID_INCOME_STATUSES.includes(status)) {
    errors.push(`Invalid status for income. Must be: ${VALID_INCOME_STATUSES.join(' or ')}`);
  }

  if (!date) {
    errors.push('Date is required for income');
  }
}

function validateExpense(
  row: Record<string, string>,
  errors: string[]
): void {
  const amount = row.amount?.trim();
  const currency = row.currency?.trim();
  const date = row.date?.trim();

  if (!amount) {
    errors.push('Amount is required for expense');
  }

  if (!currency) {
    errors.push('Currency is required for expense');
  } else if (!VALID_CURRENCIES.includes(currency)) {
    errors.push(`Invalid currency. Must be one of: ${VALID_CURRENCIES.join(', ')}`);
  }

  if (!date) {
    errors.push('Date is required for expense');
  }
}

function validateConversion(
  row: Record<string, string>,
  errors: string[]
): void {
  const amount = row.amount?.trim();
  const currency = row.currency?.trim();
  const toAmount = row.toAmount?.trim();
  const toCurrency = row.toCurrency?.trim();
  const date = row.date?.trim();

  if (!amount) {
    errors.push('Amount is required for conversion');
  }

  if (!currency) {
    errors.push('Currency is required for conversion');
  } else if (!VALID_CURRENCIES.includes(currency)) {
    errors.push(`Invalid currency. Must be one of: ${VALID_CURRENCIES.join(', ')}`);
  }

  if (!toAmount) {
    errors.push('To amount is required for conversion');
  }

  if (!toCurrency) {
    errors.push('To currency is required for conversion');
  } else if (!VALID_CURRENCIES.includes(toCurrency)) {
    errors.push(`Invalid to currency. Must be one of: ${VALID_CURRENCIES.join(', ')}`);
  }

  if (currency && toCurrency && currency === toCurrency) {
    errors.push('To currency must differ from currency');
  }

  if (!date) {
    errors.push('Date is required for conversion');
  }
}

const REPEATED_NAME_WARNING: Record<'client' | 'project', string> = {
  client: 'Client name appears more than once in this file',
  project: 'Project name appears more than once in this file',
};

/**
 * Validate all CSV rows.
 *
 * Duplicates are checked against the names that already exist in the app, plus the
 * names of earlier rows in the same file, so a new client or project is New on its
 * first row and Duplicate only on a repeat (MUT-218).
 */
export function validateCSVImport(
  rows: Record<string, string>[],
  existingClients: string[] = [],
  existingProjects: string[] = []
): CSVValidationResult[] {
  const seenInFile = { client: new Set<string>(), project: new Set<string>() };

  return rows.map((row, index) => {
    const result = validateCSVRow(row, index, existingClients, existingProjects);
    const type = row.type?.trim();
    const name = row.name?.trim();
    if ((type !== 'client' && type !== 'project') || !name) return result;

    const seen = seenInFile[type];
    if (seen.has(name) && result.warnings.length === 0) {
      result.warnings.push(REPEATED_NAME_WARNING[type]);
      if (result.status === ValidationStatus.NEW) result.status = ValidationStatus.DUPLICATE;
    }
    seen.add(name);
    return result;
  });
}
