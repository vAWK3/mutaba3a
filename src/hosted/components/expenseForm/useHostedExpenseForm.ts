import { useForm, type UseFormReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { ExpenseFormFieldsLabels } from '../../../components/expenses/ExpenseFormFields';
import { expenseFormFieldsSchema } from '../../../components/expenses/expenseFormSchema';
import { useLanguage } from '../../../lib/i18n/core';
import { currencyExponent } from '../../../lib/utils';
import type { CreateExpenseRequest, Expense, ExpenseCategory } from '../../api/client';
import { basisPointsToPercent, percentToBasisPoints, VAT_TREATMENTS } from '../../lib/expenseVat';
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
    // MUT-302 (ADR-231): '' = no VAT recorded. The rate is a typed percent, required for Standard only.
    vatTreatment: z.union([z.literal(''), z.enum(VAT_TREATMENTS)]),
    vatRate: z.string(),
  })
  .superRefine((data, ctx) => {
    if (data.vatTreatment === 'STANDARD_RATED' && percentToBasisPoints(data.vatRate) === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: data.vatRate.trim() ? VAT_RATE_INVALID : VAT_RATE_REQUIRED, path: ['vatRate'] });
    }
    if (!data.amount) return;
    const exponent = currencyExponent(data.currency);
    const decimalAmount = new RegExp(`^\\d+(\\.\\d{1,${exponent}})?$`);
    if (!decimalAmount.test(data.amount)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid amount', path: ['amount'] });
    }
  });

export type HostedExpenseFormValues = z.infer<typeof hostedExpenseSchema>;

/** The VAT rate's schema messages: codes the VAT row turns into its own words. */
export const VAT_RATE_REQUIRED = 'vatRateRequired';
export const VAT_RATE_INVALID = 'vatRateInvalid';

type ExpenseVatInput = NonNullable<CreateExpenseRequest['vat']>;

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
    vatTreatment: '',
    vatRate: '',
  };
}

/** The form's VAT as the API takes it (MUT-302): null for none; the other treatments send a 0 rate (stored as 0). */
export function vatInputOf(values: Pick<HostedExpenseFormValues, 'vatTreatment' | 'vatRate'>): ExpenseVatInput | null {
  if (!values.vatTreatment) return null;
  return { treatment: values.vatTreatment, rateBasisPoints: values.vatTreatment === 'STANDARD_RATED' ? (percentToBasisPoints(values.vatRate) ?? 0) : 0 };
}

/** An expense's VAT as form values: the treatment, and a Standard rate as its shortest percent. */
export function vatValuesOf(expense: Pick<Expense, 'vat'>): Pick<HostedExpenseFormValues, 'vatTreatment' | 'vatRate'> {
  const vat = expense.vat;
  if (!vat) return { vatTreatment: '', vatRate: '' };
  return { vatTreatment: vat.treatment, vatRate: vat.treatment === 'STANDARD_RATED' ? basisPointsToPercent(vat.rateBasisPoints) : '' };
}

/**
 * An edit's `vat` (MUT-302, D4): left out when unchanged, so the server keeps the treatment and rate (and re-splits a
 * new amount); null when removed; the new choice otherwise. "Changed" compares treatment and basis points, never the
 * typed text ("17.5" = "17.50", OV10). Only a firm profile's form shows VAT, so nothing else ever sends it.
 */
export function updateExpenseVat(existing: Pick<Expense, 'vat'>, values: HostedExpenseFormValues, options: { firm: boolean }): { vat?: ExpenseVatInput | null } {
  if (!options.firm) return {};
  const next = vatInputOf(values);
  const before = existing.vat ? { treatment: existing.vat.treatment, rateBasisPoints: existing.vat.rateBasisPoints } : null;
  const same = next === null ? before === null : before !== null && next.treatment === before.treatment && next.rateBasisPoints === before.rateBasisPoints;
  return same ? {} : { vat: next };
}

/**
 * A new expense's body from the form: an empty optional field is left out (the drawer's create, the receipt's approve).
 * MUT-302 (OV1): `vat` only on a firm profile, so a suggestion's rate never saves hidden VAT on a personal one.
 */
export function createExpenseBody(values: HostedExpenseFormValues, options: { firm: boolean }): CreateExpenseRequest {
  const vat = options.firm ? vatInputOf(values) : null;
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
    ...(vat ? { vat } : {}),
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
