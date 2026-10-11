import { useEffect } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ExpenseFormFields, type ExpenseFormFieldsLabels } from '../../components/expenses/ExpenseFormFields';
import { DECIMAL_AMOUNT, expenseFormFieldsSchema } from '../../components/expenses/expenseFormSchema';
import { Button } from '../../components/ui/Button';
import { useLanguage } from '../../lib/i18n/core';
import { useCreateExpense, useDeleteExpense, useExpense, useExpenseCategories, useUpdateExpense } from '../data/expenseQueries';
import { useToast } from './Toast';
import { ClientPicker } from './ClientPicker';
import { ProjectPicker } from './ProjectPicker';
import { ReceiptUploader } from './ReceiptUploader';
import { Drawer } from './Drawer';
import { applyExpenseApiError } from './expenseApiErrors';
import { todayLocalISO } from '../format/dates';
import type { CreateExpenseRequest, UpdateExpenseRequest } from '../api/client';

/**
 * The hosted portal's expense capture (MUT-44). Builds on
 * `components/expenses/ExpenseFormFields` — amount/currency/date/title/
 * category/notes — with its own vendor (plain text; no server-side vendor
 * directory exists for hosted profiles), client and project pickers
 * (read-only directories, no create-new), and its own CreateExpense/
 * UpdateExpense/DeleteExpense wiring. See mut-44-expense-capture.md §3/§6a.
 */
const CURRENCY_OPTIONS = ['USD', 'ILS', 'EUR'] as const;

const hostedExpenseSchema = expenseFormFieldsSchema.extend({
  amount: z.string().min(1, 'Amount is required').regex(DECIMAL_AMOUNT, 'Invalid amount'),
  vendor: z.string().optional(),
  clientId: z.string().optional(),
  projectId: z.string().optional(),
});

export type HostedExpenseFormValues = z.infer<typeof hostedExpenseSchema>;

function emptyValues(): HostedExpenseFormValues {
  return {
    amount: '',
    currency: 'USD',
    occurredAt: todayLocalISO(),
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
}

export function ExpenseDrawer({ profileId, mode, expenseId, onClose }: ExpenseDrawerProps) {
  const { t } = useLanguage();
  const showToast = useToast();

  const { data: categories, isLoading: categoriesLoading } = useExpenseCategories(profileId);
  const { data: existingExpense, isLoading: expenseLoading } = useExpense(profileId, expenseId ?? '');

  const createMutation = useCreateExpense(profileId);
  const updateMutation = useUpdateExpense(profileId);
  const deleteMutation = useDeleteExpense(profileId);

  const form = useForm<HostedExpenseFormValues>({
    resolver: zodResolver(hostedExpenseSchema),
    defaultValues: emptyValues(),
  });
  const { control, handleSubmit, reset, setError, formState } = form;
  const selectedClientId = useWatch({ control, name: 'clientId' });

  useEffect(() => {
    if (mode === 'edit' && existingExpense) {
      reset({
        amount: existingExpense.amount,
        currency: existingExpense.currency,
        occurredAt: existingExpense.occurredOn,
        title: existingExpense.title ?? '',
        vendor: existingExpense.vendor ?? '',
        clientId: existingExpense.customerId ?? '',
        projectId: existingExpense.projectId ?? '',
        categoryId: existingExpense.categoryId ?? '',
        notes: existingExpense.notes ?? '',
      });
    }
  }, [mode, existingExpense, reset]);

  const errorLabels = {
    categoryArchived: t('hosted.expenses.errors.categoryArchived'),
    customerNotFound: t('hosted.expenses.errors.customerNotFound'),
    projectNotFound: t('hosted.expenses.errors.projectNotFound'),
    projectCustomerMismatch: t('hosted.expenses.errors.projectCustomerMismatch'),
    amountInvalid: t('hosted.expenses.errors.amountInvalid'),
    dateInvalid: t('hosted.expenses.errors.dateInvalid'),
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
    const body: CreateExpenseRequest | UpdateExpenseRequest = {
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

    try {
      if (mode === 'edit' && existingExpense) {
        await updateMutation.mutateAsync({ expenseId: existingExpense.id, body, version: String(existingExpense.version) });
      } else {
        await createMutation.mutateAsync(body as CreateExpenseRequest);
      }
      onClose();
    } catch (error) {
      applyExpenseApiError(error, setError, errorLabels, showToast);
    }
  };

  const handleDelete = async () => {
    if (!existingExpense) return;
    if (!confirm(t('common.delete'))) return;
    try {
      await deleteMutation.mutateAsync(existingExpense.id);
      onClose();
    } catch (error) {
      applyExpenseApiError(error, setError, errorLabels, showToast);
    }
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending;
  const isLoading = categoriesLoading || (mode === 'edit' && expenseLoading);

  if (isLoading) {
    return (
      <Drawer title={t('common.loading')} onClose={onClose} closeLabel={t('common.close')}>
        <div className="loading">
          <div className="spinner" />
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
          currencyOptions={CURRENCY_OPTIONS}
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
