import { z } from 'zod';
import { parseAmountInput } from '../../lib/utils';
import type { IncomeStatus } from '../../lib/stores';

export const INCOME_STATUSES = ['earned', 'invoiced', 'received'] as const satisfies readonly IncomeStatus[];
export const CURRENCIES = ['USD', 'ILS', 'EUR', 'JOD'] as const;

/**
 * Extracted from IncomeDrawer.tsx so the drawer's file can stay
 * component-only (Vite fast-refresh requires it) while this schema is
 * importable directly for testing: amount's decimal-precision validity
 * depends on the sibling currency field (JOD = 3 decimals, others = 2),
 * which a chained z.string().refine() on the field alone can't see --
 * hence superRefine at the object level.
 */
export const schema = z.object({
  incomeStatus: z.enum(INCOME_STATUSES),
  profileId: z.string().min(1, 'validation.profileRequired'),
  amount: z.string().trim().min(1, 'validation.amountRequired'),
  currency: z.enum(CURRENCIES),
  occurredAt: z.string().min(1, 'validation.dateRequired'),
  clientId: z.string().optional(),
  /** Text left in the client box without picking a client (MUT-5) */
  clientDraft: z
    .string()
    .optional()
    .refine((value) => !value, 'validation.clientNotPicked'),
  projectId: z.string().optional(),
  dueDate: z.string().optional(),
  title: z.string().optional(),
  notes: z.string().optional(),
}).superRefine((data, ctx) => {
  if (!data.amount) return; // 'validation.amountRequired' already reported
  const parsed = parseAmountInput(data.amount, { currency: data.currency });
  if (parsed === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'validation.amountInvalid', path: ['amount'] });
    return;
  }
  if (parsed <= 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'validation.amountPositive', path: ['amount'] });
  }
});

export type FormData = z.infer<typeof schema>;
