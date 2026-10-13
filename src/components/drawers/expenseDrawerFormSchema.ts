import { z } from 'zod';
import { parseAmountInput } from '../../lib/utils';

/**
 * Extracted from ExpenseDrawer.tsx so the drawer's file can stay
 * component-only (Vite fast-refresh) while this schema is importable
 * directly for testing -- same reasoning as IncomeDrawer's
 * incomeFormSchema.ts. Named distinctly from the sibling
 * src/components/expenses/expenseFormSchema.ts, which is a different,
 * smaller schema (shared with the hosted portal's own expense drawer) for
 * just the fields ExpenseFormFields renders -- this one is ExpenseDrawer's
 * full form, including expenseType/recurring fields that schema doesn't have.
 */
export const schema = z.object({
  expenseType: z.enum(['onetime', 'recurring']),
  profileId: z.string().min(1, 'Profile is required'),
  amount: z.string().min(1, 'Amount is required'),
  currency: z.enum(['USD', 'ILS', 'EUR', 'JOD']),
  occurredAt: z.string().min(1, 'Date is required'),
  title: z.string().optional(),
  vendor: z.string().optional(),
  vendorId: z.string().optional(),
  clientId: z.string().optional(),
  projectId: z.string().optional(),
  categoryId: z.string().min(1, 'Category is required'),
  notes: z.string().optional(),
  // Recurring fields
  frequency: z.enum(['monthly', 'yearly']).optional(),
  startDate: z.string().optional(),
  endMode: z.enum(['endOfYear', 'untilDate', 'noEnd']).optional(),
  endDate: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.amount) {
    // MUT-140: decimal-precision validity is currency-dependent (JOD = 3
    // places, others = 2), so this needs the sibling currency field --
    // a chained z.string().refine() on amount alone can't see it.
    const parsed = parseAmountInput(data.amount, { currency: data.currency });
    if (parsed === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Amount is invalid', path: ['amount'] });
    } else if (parsed <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Amount must be positive', path: ['amount'] });
    }
  }

  if (data.expenseType === 'recurring') {
    if (!data.title) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Title is required for recurring expenses',
        path: ['title'],
      });
    }
    if (!data.frequency) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Frequency is required',
        path: ['frequency'],
      });
    }
    if (!data.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Start date is required',
        path: ['startDate'],
      });
    }
    if (!data.endMode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'End mode is required',
        path: ['endMode'],
      });
    }
    if (data.endMode === 'untilDate' && !data.endDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'End date is required',
        path: ['endDate'],
      });
    }
  }
});

export type FormData = z.infer<typeof schema>;
