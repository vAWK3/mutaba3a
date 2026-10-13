import { useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Drawer } from './Drawer';
import { Select } from '../ui';
import { useDrawerStore } from '../../lib/stores';
import {
  useTransaction,
  useUpdateTransaction,
  useDeleteTransaction,
  useClients,
  useProjects,
  useCategories,
} from '../../hooks/useQueries';
import { ExpenseFormFields, type ExpenseFormFieldsLabels } from '../expenses/ExpenseFormFields';
import { expenseFormFieldsSchema } from '../expenses/expenseFormSchema';
import { currencyExponent, parseAmountInput, parseAmountToMinor } from '../../lib/utils';
import { useT } from '../../lib/i18n';

const CURRENCY_OPTIONS = ['USD', 'ILS', 'EUR', 'JOD'] as const;

// The shared (hosted-portal-facing) schema caps currency at USD/ILS/EUR and
// requires a non-empty categoryId (a real Expense always has one) — this
// widens currency to the local app's full set (MUT-140: + JOD, 3-decimal)
// and drops categoryId's `.min(1)` since a legacy kind:'expense' transaction
// may not have one. ExpenseFormFieldsProps<T extends ExpenseFormFieldsShape>
// only needs `currency: string`, so the widened enum still satisfies it
// structurally. The amount/currency superRefine mirrors ExpenseDrawer's own
// expenseDrawerFormSchema.ts (ADR-065/MUT-140): precision validity depends
// on the sibling currency field, so a chained amount-only refine can't see it.
const schema = expenseFormFieldsSchema.extend({
  currency: z.enum(CURRENCY_OPTIONS),
  categoryId: z.string(),
  clientId: z.string().optional(),
  projectId: z.string().optional(),
}).superRefine((data, ctx) => {
  if (!data.amount) return;
  const parsed = parseAmountInput(data.amount, { currency: data.currency });
  if (parsed === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Amount is invalid', path: ['amount'] });
  } else if (parsed <= 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Amount must be positive', path: ['amount'] });
  }
});

type FormData = z.infer<typeof schema>;

/**
 * Edits a pre-existing kind:'expense' row in db.transactions — legacy data
 * from before MUT-14 split real expenses into db.expenses (demo seed data,
 * or anything imported before MUT-138's import-path fix). Deliberately a
 * separate, minimal component rather than extending IncomeDrawer: that drawer
 * hardcodes kind:'income' on every save (src/lib/incomeEntry.ts), and the
 * population this edits cannot grow after MUT-138, so it doesn't carry the
 * income form's status/payment-record logic.
 */
export function LegacyExpenseEditDrawer() {
  const t = useT();
  const { legacyExpenseDrawer, closeLegacyExpenseDrawer } = useDrawerStore();
  const { transactionId } = legacyExpenseDrawer;

  const { data: existingTransaction, isLoading } = useTransaction(transactionId || '');
  const { data: clients = [] } = useClients();
  const { data: projects = [] } = useProjects();
  const { data: categories = [] } = useCategories('expense');
  const updateMutation = useUpdateTransaction();
  const deleteMutation = useDeleteTransaction();

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      amount: '',
      currency: 'USD',
      occurredAt: '',
      title: '',
      categoryId: '',
      clientId: '',
      projectId: '',
      notes: '',
    },
  });

  useEffect(() => {
    if (existingTransaction) {
      form.reset({
        amount: (existingTransaction.amountMinor / 10 ** currencyExponent(existingTransaction.currency)).toString(),
        currency: existingTransaction.currency,
        occurredAt: existingTransaction.occurredAt,
        title: existingTransaction.title || '',
        categoryId: existingTransaction.categoryId || '',
        clientId: existingTransaction.clientId || '',
        projectId: existingTransaction.projectId || '',
        notes: existingTransaction.notes || '',
      });
    }
  }, [existingTransaction, form]);

  const onSubmit = async (data: FormData) => {
    if (!transactionId) return;

    try {
      await updateMutation.mutateAsync({
        id: transactionId,
        data: {
          // kind and status are fixed: this form never turns an expense into
          // income, or changes its paid state.
          title: data.title || undefined,
          clientId: data.clientId || undefined,
          projectId: data.projectId || undefined,
          categoryId: data.categoryId || undefined,
          amountMinor: parseAmountToMinor(data.amount, data.currency),
          currency: data.currency,
          occurredAt: data.occurredAt,
          notes: data.notes || undefined,
        },
      });
      closeLegacyExpenseDrawer();
    } catch (error) {
      console.error('Failed to save expense:', error);
    }
  };

  const handleDelete = async () => {
    if (!transactionId) return;
    if (!confirm(t('expenses.confirmDelete'))) return;

    try {
      await deleteMutation.mutateAsync(transactionId);
      closeLegacyExpenseDrawer();
    } catch (error) {
      console.error('Failed to delete expense:', error);
    }
  };

  const labels: ExpenseFormFieldsLabels = {
    amount: t('drawer.expense.amount'),
    amountPlaceholder: t('drawer.expense.amountPlaceholder'),
    currency: t('drawer.expense.currency'),
    date: t('drawer.expense.date'),
    title: t('drawer.expense.title'),
    titlePlaceholder: t('drawer.expense.titlePlaceholder'),
    category: t('drawer.expense.category'),
    categoryPlaceholder: t('drawer.expense.categoryPlaceholder'),
    notes: t('drawer.expense.notes'),
    notesPlaceholder: t('drawer.expense.notesPlaceholder'),
    requiredError: t('validation.required'),
    amountError: t('validation.amountRequired'),
  };

  const isSubmitting = updateMutation.isPending;

  if (isLoading) {
    return (
      <Drawer title={t('common.loading')} onClose={closeLegacyExpenseDrawer}>
        <div className="loading">
          <div className="spinner" />
        </div>
      </Drawer>
    );
  }

  return (
    <Drawer
      title={t('drawer.expense.edit')}
      onClose={closeLegacyExpenseDrawer}
      footer={
        <>
          <div className="drawer-footer-left">
            <button
              type="button"
              className="btn btn-danger"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              {t('common.delete')}
            </button>
          </div>
          <div className="drawer-footer-right">
            <button type="button" className="btn btn-secondary" onClick={closeLegacyExpenseDrawer}>
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              form="legacy-expense-form"
              className="btn btn-primary"
              disabled={isSubmitting}
            >
              {isSubmitting ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </>
      }
    >
      <form id="legacy-expense-form" onSubmit={form.handleSubmit(onSubmit)}>
        <ExpenseFormFields
          control={form.control}
          errors={form.formState.errors}
          categories={categories}
          currencyOptions={CURRENCY_OPTIONS}
          amountInputMode="number"
          labels={labels}
          clientField={
            <>
              <label className="form-label" htmlFor="legacy-expense-client">
                {t('drawer.expense.client')}
              </label>
              <Controller
                name="clientId"
                control={form.control}
                render={({ field }) => (
                  <Select id="legacy-expense-client" {...field}>
                    <option value="">{t('drawer.expense.clientPlaceholder')}</option>
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                  </Select>
                )}
              />
            </>
          }
          projectField={
            <>
              <label className="form-label" htmlFor="legacy-expense-project">
                {t('drawer.expense.project')}
              </label>
              <Controller
                name="projectId"
                control={form.control}
                render={({ field }) => (
                  <Select id="legacy-expense-project" {...field}>
                    <option value="">{t('drawer.expense.projectPlaceholder')}</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </Select>
                )}
              />
            </>
          }
          vendorField={null}
        />
      </form>
    </Drawer>
  );
}
