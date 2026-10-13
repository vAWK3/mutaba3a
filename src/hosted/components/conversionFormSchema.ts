import { z } from 'zod';
import { DECIMAL_AMOUNT } from '../../components/expenses/expenseFormSchema';
import { currencyExponent, parseAmountInput } from '../../lib/utils';

/**
 * The hosted conversion drawer's own schema (MUT-161) — not extracted into a
 * cross-host shared file like expenseFormFieldsSchema: the local app's
 * ConversionDrawer (src/components/drawers/conversionFormSchema.ts) predates
 * this ticket and stays untouched (it's the local/offline app's own
 * Dexie-backed surface), so there is no existing local schema to share with.
 * Two currency/amount legs, each validated with the same stricter decimal
 * check the hosted expense drawer already applies (USD/ILS/EUR, two decimal
 * places — the hosted portal has no JOD support yet, a pre-existing gap this
 * ticket doesn't extend).
 */
export const CURRENCY_OPTIONS = ['USD', 'ILS', 'EUR'] as const;

export const conversionFormSchema = z
  .object({
    fromAmount: z.string().min(1, 'Amount is required').regex(DECIMAL_AMOUNT, 'Invalid amount'),
    fromCurrency: z.enum(CURRENCY_OPTIONS),
    toAmount: z.string().min(1, 'Amount is required').regex(DECIMAL_AMOUNT, 'Invalid amount'),
    toCurrency: z.enum(CURRENCY_OPTIONS),
    occurredAt: z.string().min(1, 'Date is required'),
    notes: z.string().optional(),
  })
  .refine((data) => data.fromCurrency !== data.toCurrency, { message: 'Choose a different currency to convert to', path: ['toCurrency'] });

export type ConversionFormValues = z.infer<typeof conversionFormSchema>;

/**
 * Rate shown read-only below the two amount fields; null while either side
 * can't be parsed yet. Same computation as the local ConversionDrawer's own
 * `impliedRate` (src/components/drawers/ConversionDrawer.tsx) — relocated,
 * not duplicated with different math: both go through the shared
 * `parseAmountInput`/`currencyExponent` (src/lib/utils.ts), never a bare
 * `Number()`/`parseFloat` (eslint.config.js bans both inside the portal).
 */
export function impliedRate(fromAmount: string, fromCurrency: (typeof CURRENCY_OPTIONS)[number], toAmount: string, toCurrency: (typeof CURRENCY_OPTIONS)[number]): number | null {
  const fromMinor = parseAmountInput(fromAmount, { currency: fromCurrency });
  const toMinor = parseAmountInput(toAmount, { currency: toCurrency });
  if (fromMinor === null || toMinor === null || fromMinor <= 0) return null;
  const fromMajor = fromMinor / 10 ** currencyExponent(fromCurrency);
  const toMajor = toMinor / 10 ** currencyExponent(toCurrency);
  return toMajor / fromMajor;
}
