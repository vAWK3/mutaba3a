import { useForm, type UseFormReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { ExpenseFormFieldsLabels } from '../../../components/expenses/ExpenseFormFields';
import { expenseFormFieldsSchema } from '../../../components/expenses/expenseFormSchema';
import { useLanguage } from '../../../lib/i18n/core';
import { currencyExponent } from '../../../lib/utils';
import type { CreateExpenseRequest, ExpenseCategory } from '../../api/client';
import { useExpenseCategories } from '../../data/expenseQueries';
import { HOSTED_CURRENCIES } from '../../format/currencies';
import { todayInZone, todayLocalISO } from '../../format/dates';
import { useMatterCascade } from '../useMatterCascade';
import { usePendingPicks } from '../usePendingPicks';
import type { ExpenseErrorLabels } from '../expenseApiErrors';

/**
 * The hosted expense form's state, shared by the expense drawer and the receipt review page (MUT-260 D6): schema,
 * defaults, labels, error labels, the client ↔ matter cascade and the pending-picks guard. Extracted from
 * ExpenseDrawer unchanged; `HostedExpenseFields` is the body that renders it.
 */

// The shared schema caps currency at USD/ILS/EUR and its amount field has no
// precision check -- this widens currency to JOD (MUT-140 scoped that out of
// the portal; the server already accepts JOD on every money-typed endpoint,
// see server/src/money.ts) and replaces the fixed 2-decimal DECIMAL_AMOUNT
// regex with a currency-aware check, since JOD needs 3.
export const hostedExpenseSchema = expenseFormFieldsSchema
  .extend({
    currency: z.enum(HOSTED_CURRENCIES),
    amount: z.string().min(1, 'Amount is required'),
    vendor: z.string().optional(),
    clientId: z.string().optional(),
    projectId: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.amount) return;
    const exponent = currencyExponent(data.currency);
    const decimalAmount = new RegExp(`^\\d+(\\.\\d{1,${exponent}})?$`);
    if (!decimalAmount.test(data.amount)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid amount', path: ['amount'] });
    }
  });

export type HostedExpenseFormValues = z.infer<typeof hostedExpenseSchema>;

export function emptyExpenseValues(timezone?: string): HostedExpenseFormValues {
  return {
    amount: '',
    currency: 'USD',
    // MUT-133 D5: the profile's calendar day when the list passes its zone (R3).
    occurredAt: timezone ? todayInZone(timezone) : todayLocalISO(),
    title: '',
    vendor: '',
    clientId: '',
    projectId: '',
    categoryId: '',
    notes: '',
  };
}

/** A new expense's body from the form: an empty optional field is left out (the drawer's create, the receipt's approve). */
export function createExpenseBody(values: HostedExpenseFormValues): CreateExpenseRequest {
  return {
    occurredOn: values.occurredAt,
    amount: values.amount,
    currency: values.currency,
    title: values.title || undefined,
    vendor: values.vendor || undefined,
    categoryId: values.categoryId || undefined,
    customerId: values.clientId || undefined,
    projectId: values.projectId || undefined,
    notes: values.notes || undefined,
  };
}

export interface UseHostedExpenseFormOptions {
  profileId: string;
  /** The profile's IANA zone, for the default date (MUT-133 D5); the browser calendar when absent. */
  timezone?: string;
  /** Values over the empty form at mount (MUT-260: a receipt's suggestion). Later changes are the caller's `reset`. */
  initialValues?: Partial<HostedExpenseFormValues>;
}

export interface HostedExpenseForm {
  form: UseFormReturn<HostedExpenseFormValues>;
  categories: ExpenseCategory[] | undefined;
  categoriesLoading: boolean;
  labels: ExpenseFormFieldsLabels;
  errorLabels: ExpenseErrorLabels;
  /** The client field's flash counter (useMatterCascade). */
  clientFlash: number;
  picks: ReturnType<typeof usePendingPicks>;
}

export function useHostedExpenseForm({ profileId, timezone, initialValues }: UseHostedExpenseFormOptions): HostedExpenseForm {
  const { t } = useLanguage();
  const { data: categories, isLoading: categoriesLoading } = useExpenseCategories(profileId);
  const form = useForm<HostedExpenseFormValues>({
    resolver: zodResolver(hostedExpenseSchema),
    defaultValues: { ...emptyExpenseValues(timezone), ...initialValues },
  });
  const clientFlash = useMatterCascade(form, profileId, 'clientId');
  const picks = usePendingPicks();

  const errorLabels: ExpenseErrorLabels = {
    categoryArchived: t('hosted.expenses.errors.categoryArchived'),
    customerNotFound: t('hosted.expenses.errors.customerNotFound'),
    projectNotFound: t('hosted.expenses.errors.projectNotFound'),
    projectCustomerMismatch: t('hosted.expenses.errors.projectCustomerMismatch'),
    amountInvalid: t('hosted.expenses.errors.amountInvalid'),
    dateInvalid: t('hosted.expenses.errors.dateInvalid'),
    dateTooOld: t('hosted.expenses.errors.dateTooOld'),
    dateTooFar: t('hosted.expenses.errors.dateTooFar'),
    conflict: t('hosted.expenses.errors.conflict'),
    network: t('hosted.expenses.errors.network'),
    lapsed: t('hosted.billing.gate.refused'),
  };

  const labels: ExpenseFormFieldsLabels = {
    amount: t('hosted.expenses.drawer.amount'),
    amountPlaceholder: t('hosted.expenses.drawer.amountPlaceholder'),
    currency: t('hosted.expenses.drawer.currency'),
    date: t('hosted.expenses.drawer.date'),
    title: t('hosted.expenses.drawer.title'),
    titlePlaceholder: t('hosted.expenses.drawer.titlePlaceholder'),
    category: t('hosted.expenses.drawer.category'),
    categoryPlaceholder: t('hosted.expenses.drawer.categoryPlaceholder'),
    notes: t('hosted.expenses.drawer.notes'),
    notesPlaceholder: t('hosted.expenses.drawer.notesPlaceholder'),
    requiredError: t('hosted.expenses.drawer.requiredError'),
    amountError: t('hosted.expenses.drawer.amountError'),
  };

  return { form, categories, categoriesLoading, labels, errorLabels, clientFlash, picks };
}
