import { z } from 'zod';
import { amountInputCurrency, parseAmountInput } from '../../lib/utils';
import type { CreateIncomeRequest, Currency, PaymentMethod } from '../api/client';
import type { IncomeKind } from '../data/incomeAffordances';
import { minorToDecimal } from '../format/currencies';

/** Moved to format/currencies.ts (MUT-268: expense groups use it too); re-exported for this module's callers. */
export { minorToDecimal };

/**
 * The income drawers' form logic (MUT-133), kept out of the component files
 * (react-refresh lint) like conversionFormSchema.ts.
 *
 * Amounts are lenient in, canonical out (eng re-review R5): `parseAmountInput`
 * reads what people type ("1,200", "₪1,200", Arabic-Indic digits), a typed
 * currency that differs from the field's is refused (the local app's rule),
 * and the server always receives a canonical decimal with exactly the
 * currency's digits. The live line, the validation and the request body all go
 * through `parseIncomeAmount`, so they can never disagree.
 *
 * Validation messages are i18n keys, resolved with `t()` where they render.
 */

export const INCOME_CURRENCIES = ['USD', 'ILS', 'EUR', 'JOD'] as const satisfies readonly Currency[];
export const PAYMENT_METHODS = ['CASH', 'BANK'] as const satisfies readonly PaymentMethod[];

export type AmountParse =
  | { kind: 'ok'; minor: number; canonical: string }
  | { kind: 'empty' }
  | { kind: 'invalid' }
  | { kind: 'notPositive' }
  | { kind: 'currencyMismatch'; typed: Currency };

export function parseIncomeAmount(text: string, currency: Currency): AmountParse {
  if (!text.trim()) return { kind: 'empty' };
  const typed = amountInputCurrency(text);
  if (typed && typed !== currency) return { kind: 'currencyMismatch', typed };
  const minor = parseAmountInput(text, { currency });
  if (minor === null) return { kind: 'invalid' };
  if (minor <= 0) return { kind: 'notPositive' };
  return { kind: 'ok', minor, canonical: minorToDecimal(minor, currency) };
}

/** The i18n key (and params) explaining why an amount can't be saved, or null when it can. */
export function amountError(parsed: AmountParse, currency: Currency): { key: string; params?: Record<string, string> } | null {
  switch (parsed.kind) {
    case 'ok':
      return null;
    case 'empty':
      return { key: 'hosted.income.errors.amountRequired' };
    case 'notPositive':
      return { key: 'hosted.income.errors.amountNotPositive' };
    case 'currencyMismatch':
      return { key: 'hosted.income.errors.currencyMismatch', params: { typed: parsed.typed, currency } };
    case 'invalid':
      return { key: 'hosted.income.errors.amountInvalid' };
  }
}

export interface IncomeFormValues {
  kind: IncomeKind;
  amount: string;
  currency: Currency;
  occurredOn: string;
  customerId: string;
  projectId: string;
  title: string;
  dueDate: string;
  method: PaymentMethod;
  notes: string;
}

/** Fields that live under "More details"; an error in one of them opens it (design 1A, the local DETAIL_FIELDS rule). */
export const DETAIL_FIELDS = ['currency', 'occurredOn', 'dueDate', 'method', 'projectId', 'notes'] as const satisfies readonly (keyof IncomeFormValues)[];

export interface IncomeFormContext {
  /** Today in the profile's timezone (R3). */
  today: string;
  /** Whether Received may name no client. */
  customerRule: 'optional' | 'linked-required';
}

export function incomeFormSchema({ today, customerRule }: IncomeFormContext) {
  return z
    .object({
      kind: z.enum(['received', 'owed']),
      amount: z.string(),
      currency: z.enum(INCOME_CURRENCIES),
      occurredOn: z.string(),
      customerId: z.string(),
      projectId: z.string(),
      title: z.string(),
      dueDate: z.string(),
      method: z.enum(PAYMENT_METHODS),
      notes: z.string(),
    })
    .superRefine((values, ctx) => {
      const amount = amountError(parseIncomeAmount(values.amount, values.currency), values.currency);
      // Params (a mismatched currency) are recomputed where the error renders; a zod issue carries only the key.
      if (amount) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['amount'], message: amount.key });
      if (!values.occurredOn) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['occurredOn'], message: 'hosted.income.errors.dateRequired' });
      // ISO calendar dates order lexically.
      else if (values.occurredOn > today) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['occurredOn'], message: 'hosted.income.errors.dateFuture' });
      const needsClient = values.kind === 'owed' || customerRule === 'linked-required';
      if (needsClient && !values.customerId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['customerId'],
          message: values.kind === 'owed' ? 'hosted.income.errors.clientRequiredOwed' : 'hosted.income.errors.clientRequired',
        });
      }
    });
}

/**
 * The request body: canonical amount, blanks left out (never sent as ""), and
 * only the chosen kind's fields, so a kind switch after filling never leaks the
 * other kind's values.
 */
export function toCreateIncomeRequest(values: IncomeFormValues): CreateIncomeRequest {
  const parsed = parseIncomeAmount(values.amount, values.currency);
  if (parsed.kind !== 'ok') throw new Error('toCreateIncomeRequest needs a validated amount');
  const optional = (value: string) => (value.trim() ? value.trim() : undefined);
  const common: CreateIncomeRequest = {
    kind: values.kind,
    amount: parsed.canonical,
    currency: values.currency,
    occurredOn: values.occurredOn,
    customerId: optional(values.customerId),
    projectId: optional(values.projectId),
    notes: optional(values.notes),
  };
  const specific: Partial<CreateIncomeRequest> =
    values.kind === 'owed' ? { title: optional(values.title), dueDate: optional(values.dueDate) } : { method: values.method };
  return Object.fromEntries(Object.entries({ ...common, ...specific }).filter(([, v]) => v !== undefined)) as CreateIncomeRequest;
}

/** The live line under a payment amount (design 4A): computed against the fresh outstanding. */
export type SettleLine = { tone: 'done'; key: string } | { tone: 'owed'; key: string; left: string } | { tone: 'over'; key: string; outstanding: string } | null;

export function settleLine(parsed: AmountParse, outstanding: string, currency: Currency): SettleLine {
  if (parsed.kind !== 'ok') return null;
  const outstandingMinor = parseAmountInput(outstanding, { currency });
  if (outstandingMinor === null) return null;
  if (parsed.minor === outstandingMinor) return { tone: 'done', key: 'hosted.settle.paidInFull' };
  if (parsed.minor < outstandingMinor) return { tone: 'owed', key: 'hosted.settle.stillOwed', left: minorToDecimal(outstandingMinor - parsed.minor, currency) };
  return { tone: 'over', key: 'hosted.settle.exceeds', outstanding };
}
