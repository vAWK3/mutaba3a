import { z } from 'zod';
import { parseAmountInput } from '../../lib/utils';

/**
 * ConversionDrawer's form schema (MUT-141). Two independent amount/currency
 * pairs -- the from-side and the to-side of a logged currency conversion --
 * each validated against its own currency's decimal precision (MUT-140),
 * the same way ExpenseDrawer/IncomeDrawer validate their single pair, just
 * run twice. Extracted to its own file so it's testable without mounting
 * the drawer component, matching expenseDrawerFormSchema.ts's convention.
 */
export const schema = z.object({
  profileId: z.string().optional(),
  fromAmount: z.string().min(1, 'Amount is required'),
  fromCurrency: z.enum(['USD', 'ILS', 'EUR', 'JOD']),
  toAmount: z.string().min(1, 'Amount is required'),
  toCurrency: z.enum(['USD', 'ILS', 'EUR', 'JOD']),
  occurredAt: z.string().min(1, 'Date is required'),
  notes: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.fromAmount) {
    const parsed = parseAmountInput(data.fromAmount, { currency: data.fromCurrency });
    if (parsed === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Amount is invalid', path: ['fromAmount'] });
    } else if (parsed <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Amount must be positive', path: ['fromAmount'] });
    }
  }

  if (data.toAmount) {
    const parsed = parseAmountInput(data.toAmount, { currency: data.toCurrency });
    if (parsed === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Amount is invalid', path: ['toAmount'] });
    } else if (parsed <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Amount must be positive', path: ['toAmount'] });
    }
  }

  if (data.fromCurrency === data.toCurrency) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Choose a different currency to convert to',
      path: ['toCurrency'],
    });
  }
});

export type FormData = z.infer<typeof schema>;
