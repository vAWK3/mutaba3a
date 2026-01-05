import { useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Drawer } from './Drawer';
import { useDrawerStore } from '../../lib/stores';
import {
  useTransaction,
  useCreateTransaction,
  useUpdateTransaction,
  useDeleteTransaction,
  useClients,
  useProjects,
  useCategories,
} from '../../hooks/useQueries';
import { cn, parseAmountToMinor, todayISO } from '../../lib/utils';
import { useT } from '../../lib/i18n';
import { useToast } from '../../lib/toastStore';
import type { TxKind, TxStatus, Currency } from '../../types';

type TransactionType = 'income' | 'receivable' | 'expense';

const schema = z.object({
  type: z.enum(['income', 'receivable', 'expense']),
  amount: z.string().min(1, 'Amount is required'),
  currency: z.enum(['USD', 'ILS']),
  occurredAt: z.string().min(1, 'Date is required'),
  clientId: z.string().optional(),
  projectId: z.string().optional(),
  categoryId: z.string().optional(),
  dueDate: z.string().optional(),
  title: z.string().optional(),
  notes: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

export function TransactionDrawer() {
  const { transactionDrawer, closeTransactionDrawer } = useDrawerStore();
  const { mode, transactionId, defaultKind, defaultClientId, defaultProjectId, duplicateFromId } = transactionDrawer;
  const t = useT();
  const { showToast } = useToast();

  const { data: existingTx, isLoading: txLoading } = useTransaction(transactionId || '');
  const { data: sourceTx } = useTransaction(duplicateFromId || '');
  const { data: clients = [] } = useClients();
  const { data: projects = [] } = useProjects();
  const { data: incomeCategories = [] } = useCategories('income');
  const { data: expenseCategories = [] } = useCategories('expense');

  const createMutation = useCreateTransaction();
  const updateMutation = useUpdateTransaction();
  const deleteMutation = useDeleteTransaction();

  const getDefaultType = (): TransactionType => {
    if (existingTx) {
      if (existingTx.kind === 'expense') return 'expense';
      if (existingTx.status === 'unpaid') return 'receivable';
      return 'income';
    }
    if (defaultKind === 'expense') return 'expense';
    return 'income';
  };

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      type: getDefaultType(),
      amount: '',
      currency: 'USD',
      occurredAt: todayISO(),
      clientId: defaultClientId || '',
      projectId: defaultProjectId || '',
      categoryId: '',
      dueDate: '',
      title: '',
      notes: '',
    },
  });

  const { watch, setValue, reset } = form;
  const selectedType = watch('type');
  const selectedClientId = watch('clientId');

  // Reset form when existing transaction loads
  useEffect(() => {
    if (existingTx) {
      const type: TransactionType =
        existingTx.kind === 'expense'
          ? 'expense'
          : existingTx.status === 'unpaid'
          ? 'receivable'
          : 'income';

      reset({
        type,
        amount: (existingTx.amountMinor / 100).toString(),
        currency: existingTx.currency,
        occurredAt: existingTx.occurredAt.split('T')[0],
        clientId: existingTx.clientId || '',
        projectId: existingTx.projectId || '',
        categoryId: existingTx.categoryId || '',
        dueDate: existingTx.dueDate || '',
        title: existingTx.title || '',
        notes: existingTx.notes || '',
      });
    }
  }, [existingTx, reset]);

  // Reset form when duplicating from source transaction
  useEffect(() => {
    if (duplicateFromId && sourceTx && mode === 'create') {
      // For income, always default to 'receivable' (unpaid) - it's a new receivable
      // For expense, keep as 'expense'
      const type: TransactionType = sourceTx.kind === 'expense' ? 'expense' : 'receivable';

      reset({
        type,
        amount: (sourceTx.amountMinor / 100).toString(),
        currency: sourceTx.currency,
        occurredAt: todayISO(), // Always today, not original date
        clientId: sourceTx.clientId || '',
        projectId: sourceTx.projectId || '',
        categoryId: sourceTx.categoryId || '',
        dueDate: '', // Clear - user sets new due date
        title: sourceTx.title || '',
        notes: sourceTx.notes || '',
      });
    }
  }, [duplicateFromId, sourceTx, mode, reset]);

  // Filter projects by selected client
  const filteredProjects = selectedClientId
    ? projects.filter((p) => p.clientId === selectedClientId)
    : projects;

  // Get categories based on type
  const categories = selectedType === 'expense' ? expenseCategories : incomeCategories;

  const onSubmit = async (data: FormData) => {
    const kind: TxKind = data.type === 'expense' ? 'expense' : 'income';
    const status: TxStatus = data.type === 'receivable' ? 'unpaid' : 'paid';

    const txData = {
      kind,
      status,
      title: data.title || undefined,
      clientId: data.clientId || undefined,
      projectId: data.projectId || undefined,
      categoryId: data.categoryId || undefined,
      amountMinor: parseAmountToMinor(data.amount),
      currency: data.currency as Currency,
      occurredAt: new Date(data.occurredAt).toISOString(),
      dueDate: data.type === 'receivable' && data.dueDate ? data.dueDate : undefined,
      paidAt: status === 'paid' ? new Date().toISOString() : undefined,
      notes: data.notes || undefined,
    };

    try {
      if (mode === 'edit' && transactionId) {
        await updateMutation.mutateAsync({ id: transactionId, data: txData });
      } else {
        const newTx = await createMutation.mutateAsync(txData);
        // Show toast with undo for duplicated transactions
        if (duplicateFromId && newTx) {
          showToast(t('toast.transactionDuplicated'), {
            action: {
              label: t('common.undo'),
              onClick: () => {
                deleteMutation.mutate(newTx.id);
              },
            },
            duration: 5000,
          });
        }
      }
      closeTransactionDrawer();
    } catch (error) {
      console.error('Failed to save transaction:', error);
    }
  };

  const handleDelete = async () => {
    if (!transactionId) return;
    if (!confirm(t('transactions.confirmDelete'))) return;

    try {
      await deleteMutation.mutateAsync(transactionId);
      closeTransactionDrawer();
    } catch (error) {
      console.error('Failed to delete transaction:', error);
    }
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  if (mode === 'edit' && txLoading) {
    return (
      <Drawer title={t('common.loading')} onClose={closeTransactionDrawer}>
        <div className="loading">
          <div className="spinner" />
        </div>
      </Drawer>
    );
  }

  return (
    <Drawer
      title={mode === 'edit' ? t('drawer.transaction.edit') : t('drawer.transaction.new')}
      onClose={closeTransactionDrawer}
      footer={
        <>
          <div className="drawer-footer-left">
            {mode === 'edit' && (
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
              >
                {t('common.delete')}
              </button>
            )}
          </div>
          <div className="drawer-footer-right">
            <button type="button" className="btn btn-secondary" onClick={closeTransactionDrawer}>
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              form="transaction-form"
              className="btn btn-primary"
              disabled={isSubmitting}
            >
              {isSubmitting ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </>
      }
    >
      <form id="transaction-form" onSubmit={form.handleSubmit(onSubmit)}>
        {/* Type Selector */}
        <div className="type-selector">
          <button
            type="button"
            className={cn('type-selector-btn', selectedType === 'income' && 'active')}
            onClick={() => setValue('type', 'income')}
          >
            <span className="type-selector-label">{t('drawer.transaction.typeIncome')}</span>
            <span className="type-selector-hint">{t('drawer.transaction.typeIncomeDesc')}</span>
          </button>
          <button
            type="button"
            className={cn('type-selector-btn', selectedType === 'receivable' && 'active')}
            onClick={() => setValue('type', 'receivable')}
          >
            <span className="type-selector-label">{t('drawer.transaction.typeReceivable')}</span>
            <span className="type-selector-hint">{t('drawer.transaction.typeReceivableDesc')}</span>
          </button>
          <button
            type="button"
            className={cn('type-selector-btn', selectedType === 'expense' && 'active')}
            onClick={() => setValue('type', 'expense')}
          >
            <span className="type-selector-label">{t('drawer.transaction.typeExpense')}</span>
            <span className="type-selector-hint">{t('drawer.transaction.typeExpenseDesc')}</span>
          </button>
        </div>

        {/* Amount & Currency */}
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">{t('drawer.transaction.amount')} *</label>
            <input
              type="number"
              step="0.01"
              min="0"
              className={cn('input', form.formState.errors.amount && 'input-error')}
              placeholder={t('drawer.transaction.amountPlaceholder')}
              {...form.register('amount')}
            />
            {form.formState.errors.amount && (
              <p className="form-error">{t('validation.amountRequired')}</p>
            )}
          </div>
          <div className="form-group">
            <label className="form-label">{t('drawer.transaction.currency')} *</label>
            <Controller
              name="currency"
              control={form.control}
              render={({ field }) => (
                <select className="select" style={{ width: '100%' }} {...field}>
                  <option value="USD">USD</option>
                  <option value="ILS">ILS</option>
                </select>
              )}
            />
          </div>
        </div>

        {/* Date */}
        <div className="form-group">
          <label className="form-label">{t('drawer.transaction.date')} *</label>
          <input
            type="date"
            className={cn('input', form.formState.errors.occurredAt && 'input-error')}
            {...form.register('occurredAt')}
          />
        </div>

        {/* Due Date (only for receivables) */}
        {selectedType === 'receivable' && (
          <div className="form-group">
            <label className="form-label">{t('drawer.transaction.dueDate')}</label>
            <input type="date" className="input" {...form.register('dueDate')} />
          </div>
        )}

        {/* Client */}
        <div className="form-group">
          <label className="form-label">{t('drawer.transaction.client')}</label>
          <Controller
            name="clientId"
            control={form.control}
            render={({ field }) => (
              <select className="select" style={{ width: '100%' }} {...field}>
                <option value="">{t('drawer.transaction.clientPlaceholder')}</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            )}
          />
        </div>

        {/* Project */}
        <div className="form-group">
          <label className="form-label">{t('drawer.transaction.project')}</label>
          <Controller
            name="projectId"
            control={form.control}
            render={({ field }) => (
              <select className="select" style={{ width: '100%' }} {...field}>
                <option value="">{t('drawer.transaction.projectPlaceholder')}</option>
                {filteredProjects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            )}
          />
        </div>

        {/* Category */}
        <div className="form-group">
          <label className="form-label">{t('drawer.transaction.category')}</label>
          <Controller
            name="categoryId"
            control={form.control}
            render={({ field }) => (
              <select className="select" style={{ width: '100%' }} {...field}>
                <option value="">{t('drawer.transaction.categoryPlaceholder')}</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            )}
          />
        </div>

        {/* Title */}
        <div className="form-group">
          <label className="form-label">{t('drawer.transaction.title')}</label>
          <input
            type="text"
            className="input"
            placeholder={t('drawer.transaction.titlePlaceholder')}
            {...form.register('title')}
          />
        </div>

        {/* Notes */}
        <div className="form-group">
          <label className="form-label">{t('drawer.transaction.notes')}</label>
          <textarea className="textarea" placeholder={t('drawer.transaction.notesPlaceholder')} {...form.register('notes')} />
        </div>
      </form>
    </Drawer>
  );
}
