import { z } from 'zod';
import { currencyExponent, parseAmountInput } from '../../lib/utils';

/**
 * The hosted conversion drawer's own schema (MUT-161) — not extracted into a
 * cross-host shared file like expenseFormFieldsSchema: the local app's
 * ConversionDrawer (src/components/drawers/conversionFormSchema.ts) predates
 * this ticket and stays untouched (it's the local/offline app's own
 * Dexie-backed surface), so there is no existing local schema to share with.
 * Two currency/amount legs. MUT-194 (D7, closes TD-117): JOD joins the set,
 * now that a conversion logged on a phone (JOD included) can be edited here,
 * and each leg's decimal places follow its own currency via `currencyExponent`
 * — the hosted ExpenseDrawer's pattern (7428c63) — instead of a fixed
 * two-decimal regex.
 */
export const CURRENCY_OPTIONS = ['USD', 'ILS', 'EUR', 'JOD'] as const;

type HostedCurrency = (typeof CURRENCY_OPTIONS)[number];

/** A non-negative decimal with at most the currency's fractional digits (no sign, no exponent). */
function fitsCurrency(amount: string, currency: HostedCurrency): boolean {
  return new RegExp(`^\\d+(\\.\\d{1,${currencyExponent(currency)}})?$`).test(amount);
}

export const conversionFormSchema = z
  .object({
    fromAmount: z.string().min(1, 'Amount is required'),
    fromCurrency: z.enum(CURRENCY_OPTIONS),
    toAmount: z.string().min(1, 'Amount is required'),
    toCurrency: z.enum(CURRENCY_OPTIONS),
    occurredAt: z.string().min(1, 'Date is required'),
    notes: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.fromAmount && !fitsCurrency(data.fromAmount, data.fromCurrency)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid amount', path: ['fromAmount'] });
    }
    if (data.toAmount && !fitsCurrency(data.toAmount, data.toCurrency)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid amount', path: ['toAmount'] });
    }
    if (data.fromCurrency === data.toCurrency) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Choose a different currency to convert to', path: ['toCurrency'] });
    }
  });

export type ConversionFormValues = z.infer<typeof conversionFormSchema>;

/**
 * Rate shown read-only below the two amount fields; null while either side
 * can't be parsed yet. Same computation as the local ConversionDrawer's own
 * `impliedRate` (src/components/drawers/ConversionDrawer.tsx) — relocated,
 * not duplicated with different math: both go through the shared
 * `parseAmountInput`/`currencyExponent` (src/lib/utils.ts), never a bare
 * `Number()`/`parseFloat` (eslint.config.js bans both inside the portal).
 */
export function impliedRate(fromAmount: string, fromCurrency: HostedCurrency, toAmount: string, toCurrency: HostedCurrency): number | null {
  const fromMinor = parseAmountInput(fromAmount, { currency: fromCurrency });
  const toMinor = parseAmountInput(toAmount, { currency: toCurrency });
  if (fromMinor === null || toMinor === null || fromMinor <= 0) return null;
  const fromMajor = fromMinor / 10 ** currencyExponent(fromCurrency);
  const toMajor = toMinor / 10 ** currencyExponent(toCurrency);
  return toMajor / fromMajor;
}
