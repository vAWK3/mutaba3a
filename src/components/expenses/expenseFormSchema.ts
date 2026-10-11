import { z } from 'zod';

/**
 * The fields shared between the local ExpenseDrawer and the hosted portal's
 * expense drawer (MUT-44). Deliberately excludes profileId (host-specific —
 * the portal has none, it's the URL route), vendor/clientId/projectId (each
 * host wires its own picker, local's being Dexie-backed and create-capable,
 * hosted's being a read-only directory lookup with no server-side vendor
 * concept at all), and every recurring-only field (out of scope; local keeps
 * those in its own schema).
 *
 * `amount`'s base validation matches the local ExpenseDrawer's existing
 * `z.string().min(1, ...)` exactly — no regex — so extracting this schema
 * does not change local's validation behavior. The hosted side layers the
 * stricter `DECIMAL_AMOUNT` check on top via `.extend()`, since the server
 * requires a canonical decimal string and the portal's lint bans `Number()`/
 * `parseFloat` outright (no arithmetic parse to fall back on).
 */
export const expenseFormFieldsSchema = z.object({
  amount: z.string().min(1, 'Amount is required'),
  currency: z.enum(['USD', 'ILS', 'EUR']),
  occurredAt: z.string().min(1, 'Date is required'),
  title: z.string().optional(),
  categoryId: z.string().min(1, 'Category is required'),
  notes: z.string().optional(),
});

export type ExpenseFormFieldsValues = z.infer<typeof expenseFormFieldsSchema>;

/** Digits plus up to two decimal places — ILS/USD/EUR all use two fractional digits. */
export const DECIMAL_AMOUNT = /^\d+(\.\d{1,2})?$/;
