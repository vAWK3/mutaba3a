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
  const { mode, transactionId, defaultKind, defaultClientId, defaultProjectId } = transactionDrawer;

  const { data: existingTx, isLoading: txLoading } = useTransaction(transactionId || '');
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
        await createMutation.mutateAsync(txData);
      }
      closeTransactionDrawer();
    } catch (error) {
      console.error('Failed to save transaction:', error);
    }
  };

  const handleDelete = async () => {
    if (!transactionId) return;
    if (!confirm('Are you sure you want to delete this transaction?')) return;

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
      <Drawer title="Loading..." onClose={closeTransactionDrawer}>
        <div className="loading">
          <div className="spinner" />
        </div>
      </Drawer>
    );
  }

  return (
    <Drawer
      title={mode === 'edit' ? 'Edit Transaction' : 'New Transaction'}
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
                Delete
              </button>
            )}
          </div>
          <div className="drawer-footer-right">
            <button type="button" className="btn btn-secondary" onClick={closeTransactionDrawer}>
              Cancel
            </button>
            <button
              type="submit"
              form="transaction-form"
              className="btn btn-primary"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Saving...' : 'Save'}
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
            <span className="type-selector-label">Income</span>
            <span className="type-selector-hint">Paid</span>
          </button>
          <button
            type="button"
            className={cn('type-selector-btn', selectedType === 'receivable' && 'active')}
            onClick={() => setValue('type', 'receivable')}
          >
            <span className="type-selector-label">Receivable</span>
            <span className="type-selector-hint">Unpaid</span>
          </button>
          <button
            type="button"
            className={cn('type-selector-btn', selectedType === 'expense' && 'active')}
            onClick={() => setValue('type', 'expense')}
          >
            <span className="type-selector-label">Expense</span>
            <span className="type-selector-hint">Cost</span>
          </button>
        </div>

        {/* Amount & Currency */}
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Amount *</label>
            <input
              type="number"
              step="0.01"
              min="0"
              className={cn('input', form.formState.errors.amount && 'input-error')}
              placeholder="0.00"
              {...form.register('amount')}
            />
            {form.formState.errors.amount && (
              <p className="form-error">{form.formState.errors.amount.message}</p>
            )}
          </div>
          <div className="form-group">
            <label className="form-label">Currency *</label>
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
          <label className="form-label">Date *</label>
          <input
            type="date"
            className={cn('input', form.formState.errors.occurredAt && 'input-error')}
            {...form.register('occurredAt')}
          />
        </div>

        {/* Due Date (only for receivables) */}
        {selectedType === 'receivable' && (
          <div className="form-group">
            <label className="form-label">Due Date</label>
            <input type="date" className="input" {...form.register('dueDate')} />
          </div>
        )}

        {/* Client */}
        <div className="form-group">
          <label className="form-label">Client</label>
          <Controller
            name="clientId"
            control={form.control}
            render={({ field }) => (
              <select className="select" style={{ width: '100%' }} {...field}>
                <option value="">Select client...</option>
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
          <label className="form-label">Project</label>
          <Controller
            name="projectId"
            control={form.control}
            render={({ field }) => (
              <select className="select" style={{ width: '100%' }} {...field}>
                <option value="">Select project...</option>
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
          <label className="form-label">Category</label>
          <Controller
            name="categoryId"
            control={form.control}
            render={({ field }) => (
              <select className="select" style={{ width: '100%' }} {...field}>
                <option value="">Select category...</option>
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
          <label className="form-label">Title</label>
          <input
            type="text"
            className="input"
            placeholder="Brief description..."
            {...form.register('title')}
          />
        </div>

        {/* Notes */}
        <div className="form-group">
          <label className="form-label">Notes</label>
          <textarea className="textarea" placeholder="Additional notes..." {...form.register('notes')} />
        </div>
      </form>
    </Drawer>
  );
}
