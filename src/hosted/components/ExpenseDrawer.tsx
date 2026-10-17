import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ExpenseFormFields, type ExpenseFormFieldsLabels } from '../../components/expenses/ExpenseFormFields';
import { expenseFormFieldsSchema } from '../../components/expenses/expenseFormSchema';
import { Button } from '../../components/ui/Button';
import { useLanguage } from '../../lib/i18n/core';
import { currencyExponent } from '../../lib/utils';
import { expenseKey, useCreateExpense, useDeleteExpense, useExpense, useExpenseCategories, useUpdateExpense } from '../data/expenseQueries';
import { useToast } from './Toast';
import { useSavedFlashStore } from '../../lib/savedFlashStore';
import { ClientPicker } from './ClientPicker';
import { ProjectPicker } from './ProjectPicker';
import { ReceiptUploader } from './ReceiptUploader';
import { Drawer } from './Drawer';
import { applyExpenseApiError } from './expenseApiErrors';
import { todayInZone, todayLocalISO } from '../format/dates';
import { useAttemptKey } from '../data/attemptKey';
import { ApiError, type CreateExpenseRequest, type Expense, type UpdateExpenseRequest } from '../api/client';
import { HOSTED_CURRENCIES } from '../format/currencies';
import { BrandLoader } from '../../components/brand/BrandLoader';
import { trackPortal } from '../analytics/portalAnalytics';

/**
 * The hosted portal's expense capture (MUT-44). Builds on
 * `components/expenses/ExpenseFormFields` — amount/currency/date/title/
 * category/notes — with its own vendor (plain text; no server-side vendor
 * directory exists for hosted profiles), client and project pickers
 * (read-only directories, no create-new), and its own CreateExpense/
 * UpdateExpense/DeleteExpense wiring. See mut-44-expense-capture.md §3/§6a.
 */

// The shared schema caps currency at USD/ILS/EUR and its amount field has no
// precision check -- this widens currency to JOD (MUT-140 scoped that out of
// the portal; the server already accepts JOD on every money-typed endpoint,
// see server/src/money.ts) and replaces the fixed 2-decimal DECIMAL_AMOUNT
// regex with a currency-aware check, since JOD needs 3.
const hostedExpenseSchema = expenseFormFieldsSchema.extend({
  currency: z.enum(HOSTED_CURRENCIES),
  amount: z.string().min(1, 'Amount is required'),
  vendor: z.string().optional(),
  clientId: z.string().optional(),
  projectId: z.string().optional(),
}).superRefine((data, ctx) => {
  if (!data.amount) return;
  const exponent = currencyExponent(data.currency);
  const decimalAmount = new RegExp(`^\\d+(\\.\\d{1,${exponent}})?$`);
  if (!decimalAmount.test(data.amount)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid amount', path: ['amount'] });
  }
});

export type HostedExpenseFormValues = z.infer<typeof hostedExpenseSchema>;

function emptyValues(timezone?: string): HostedExpenseFormValues {
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

export interface ExpenseDrawerProps {
  profileId: string;
  mode: 'create' | 'edit';
  expenseId?: string;
  onClose: () => void;
  /** The profile's IANA zone, for the default date (MUT-133 D5); the browser calendar when absent. */
  timezone?: string;
  /** Called instead of `onClose` after a delete, so the list can drop an anchor on the deleted record (MUT-91). */
  onDeleted?: (expenseId: string) => void;
}

export function ExpenseDrawer({ profileId, mode, expenseId, onClose, timezone, onDeleted }: ExpenseDrawerProps) {
  // After-save feedback (R1 via HP1, MUT-91): always from the drawer, the one
  // place that knows a save happened (ADR-057 §4). Delete marks nothing.
  const markSaved = (id: string) => useSavedFlashStore.getState().markSaved({ kind: 'expense', ids: [id], profileId });
  const { t } = useLanguage();
  const showToast = useToast();
  const queryClient = useQueryClient();

  const { data: categories, isLoading: categoriesLoading } = useExpenseCategories(profileId);
  const { data: existingExpense, isLoading: expenseLoading } = useExpense(profileId, expenseId ?? '');

  const createMutation = useCreateExpense(profileId);
  const attempt = useAttemptKey();
  const updateMutation = useUpdateExpense(profileId);
  const deleteMutation = useDeleteExpense(profileId);

  const form = useForm<HostedExpenseFormValues>({
    resolver: zodResolver(hostedExpenseSchema),
    defaultValues: emptyValues(timezone),
  });
  const { control, handleSubmit, reset, setError, formState } = form;
  const selectedClientId = useWatch({ control, name: 'clientId' });

  // (Re)fill the form when a genuinely new version arrives: the first load, or
  // the refetch after a 409 (MUT-221, as ConversionDrawer's D6). Keyed on id and
  // version, not the object, so a background refetch never wipes typing.
  const latest = useRef(existingExpense);
  useEffect(() => {
    latest.current = existingExpense;
  });
  const existingId = existingExpense?.id;
  const existingVersion = existingExpense?.version;
  useEffect(() => {
    if (mode === 'edit' && latest.current) reset(valuesOf(latest.current));
  }, [mode, existingId, existingVersion, reset]);

  const errorLabels = {
    categoryArchived: t('hosted.expenses.errors.categoryArchived'),
    customerNotFound: t('hosted.expenses.errors.customerNotFound'),
    projectNotFound: t('hosted.expenses.errors.projectNotFound'),
    projectCustomerMismatch: t('hosted.expenses.errors.projectCustomerMismatch'),
    amountInvalid: t('hosted.expenses.errors.amountInvalid'),
    dateInvalid: t('hosted.expenses.errors.dateInvalid'),
    dateTooOld: t('hosted.expenses.errors.dateTooOld'),
    conflict: t('hosted.expenses.errors.conflict'),
    network: t('hosted.expenses.errors.network'),
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

  const onSubmit = async (values: HostedExpenseFormValues) => {
    try {
      if (mode === 'edit' && existingExpense) {
        // UpdateExpenseRequest has no `currency` field at all — the API never
        // changes it on a PATCH — and its optional fields are `string | null`,
        // where `null` clears the field and omission leaves it unchanged. Both
        // differ from CreateExpenseRequest, so this body is built separately
        // rather than sharing one object coerced across the two shapes.
        const body: UpdateExpenseRequest = {
          occurredOn: values.occurredAt,
          amount: values.amount,
          title: values.title || null,
          vendor: values.vendor || null,
          categoryId: values.categoryId || null,
          customerId: values.clientId || null,
          projectId: values.projectId || null,
          notes: values.notes || null,
        };
        await updateMutation.mutateAsync({ expenseId: existingExpense.id, body, version: String(existingExpense.version) });
        markSaved(existingExpense.id);
      } else {
        const body: CreateExpenseRequest = {
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
        const created = await createMutation.mutateAsync({ body, idempotencyKey: attempt.keyFor(body) });
        attempt.succeeded();
        // Opt-in usage counts (MUT-155): a new expense only, its currency and nothing else
        void trackPortal('expense_recorded', { currency: values.currency });
        markSaved(created.id);
      }
      onClose();
    } catch (error) {
      // A stale version: refetch, so the form refills at the new version and the next Save carries it.
      if (existingExpense && error instanceof ApiError && error.code === 'CONFLICT') {
        void queryClient.invalidateQueries({ queryKey: expenseKey(profileId, existingExpense.id) });
      }
      applyExpenseApiError(error, setError, errorLabels, showToast);
    }
  };

  const handleDelete = async () => {
    if (!existingExpense) return;
    if (!confirm(t('common.delete'))) return;
    try {
      await deleteMutation.mutateAsync(existingExpense.id);
      if (onDeleted) onDeleted(existingExpense.id);
      else onClose();
    } catch (error) {
      applyExpenseApiError(error, setError, errorLabels, showToast);
    }
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending;
  const isLoading = categoriesLoading || (mode === 'edit' && expenseLoading);

  if (isLoading) {
    return (
      <Drawer title={t('common.loading')} onClose={onClose} closeLabel={t('common.close')}>
        <div className="loading loading--section">
          <BrandLoader size={40} />
        </div>
      </Drawer>
    );
  }

  return (
    <Drawer
      title={mode === 'edit' ? t('hosted.expenses.drawer.editTitle') : t('hosted.expenses.drawer.newTitle')}
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        <>
          <div className="drawer-footer-left">
            {mode === 'edit' && (
              <Button type="button" variant="danger" onClick={handleDelete} disabled={deleteMutation.isPending}>
                {t('common.delete')}
              </Button>
            )}
          </div>
          <div className="drawer-footer-right">
            <Button type="button" variant="secondary" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="hosted-expense-form" disabled={isSubmitting}>
              {isSubmitting ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </>
      }
    >
      <form id="hosted-expense-form" onSubmit={handleSubmit(onSubmit)}>
        <ExpenseFormFields
          control={control}
          errors={formState.errors}
          categories={categories ?? []}
          currencyOptions={HOSTED_CURRENCIES}
          amountInputMode="decimalText"
          labels={labels}
          vendorField={
            <>
              <label className="form-label" htmlFor="hosted-expense-vendor">
                {t('hosted.expenses.drawer.vendor')}
              </label>
              <Controller
                name="vendor"
                control={control}
                render={({ field }) => (
                  <input
                    id="hosted-expense-vendor"
                    type="text"
                    className="input"
                    placeholder={t('hosted.expenses.drawer.vendorPlaceholder')}
                    {...field}
                  />
                )}
              />
            </>
          }
          clientField={
            <>
              <label className="form-label" htmlFor="hosted-expense-client">
                {t('hosted.expenses.drawer.client')}
              </label>
              <Controller
                name="clientId"
                control={control}
                render={({ field }) => (
                  <ClientPicker
                    profileId={profileId}
                    value={field.value || ''}
                    onChange={field.onChange}
                    placeholder={t('hosted.expenses.drawer.clientPlaceholder')}
                  />
                )}
              />
              {formState.errors.clientId && <p className="form-error">{formState.errors.clientId.message}</p>}
            </>
          }
          projectField={
            <>
              <label className="form-label" htmlFor="hosted-expense-matter">
                {t('hosted.expenses.drawer.matter')}
              </label>
              <Controller
                name="projectId"
                control={control}
                render={({ field }) => (
                  <ProjectPicker
                    profileId={profileId}
                    customerId={selectedClientId || undefined}
                    value={field.value || ''}
                    onChange={field.onChange}
                    placeholder={t('hosted.expenses.drawer.matterPlaceholder')}
                  />
                )}
              />
              {formState.errors.projectId && <p className="form-error">{formState.errors.projectId.message}</p>}
            </>
          }
        />
      </form>
      {mode === 'edit' && existingExpense && (
        <ReceiptUploader profileId={profileId} expenseId={existingExpense.id} receipts={existingExpense.receipts} />
      )}
    </Drawer>
  );
}

function valuesOf(expense: Expense): HostedExpenseFormValues {
  return {
    amount: expense.amount,
    currency: expense.currency,
    occurredAt: expense.occurredOn,
    title: expense.title ?? '',
    vendor: expense.vendor ?? '',
    clientId: expense.customerId ?? '',
    projectId: expense.projectId ?? '',
    categoryId: expense.categoryId ?? '',
    notes: expense.notes ?? '',
  };
}
