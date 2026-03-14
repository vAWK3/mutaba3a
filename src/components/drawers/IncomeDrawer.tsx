import { useEffect, useMemo } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Drawer } from './Drawer';
import { useDrawerStore, type IncomeStatus } from '../../lib/stores';
import {
  useTransaction,
  useCreateTransaction,
  useUpdateTransaction,
  useDeleteTransaction,
  useClients,
  useProjects,
  useBusinessProfiles,
} from '../../hooks/useQueries';
import { useActiveProfile } from '../../hooks/useActiveProfile';
import { cn, parseAmountToMinor, todayISO } from '../../lib/utils';
import { useT } from '../../lib/i18n';
import { useToast } from '../../lib/toastStore';
import type { TxStatus, Currency } from '../../types';

/**
 * IncomeDrawer
 *
 * Drawer for creating and editing income entries.
 * Implements the Earned → Invoiced → Received lifecycle.
 *
 * Key changes from old TransactionDrawer:
 * - Status selector: Earned / Invoiced / Received (not type-based)
 * - Profile is required context, shown as chip (not form field)
 * - No "Expense" option (use ExpenseDrawer)
 */

const schema = z.object({
  incomeStatus: z.enum(['earned', 'invoiced', 'received']),
  profileId: z.string().min(1, 'Profile is required'),
  amount: z.string().min(1, 'Amount is required'),
  currency: z.enum(['USD', 'ILS', 'EUR']),
  occurredAt: z.string().min(1, 'Date is required'),
  clientId: z.string().optional(),
  projectId: z.string().optional(),
  dueDate: z.string().optional(),
  title: z.string().optional(),
  notes: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

export function IncomeDrawer() {
  const { incomeDrawer, closeIncomeDrawer } = useDrawerStore();
  const { mode, transactionId, defaultStatus, defaultClientId, defaultProjectId, defaultProfileId, duplicateFromId } = incomeDrawer;
  const t = useT();
  const { showToast } = useToast();
  const { profiles, activeProfileId, isAllProfiles } = useActiveProfile();

  const { data: existingTx, isLoading: txLoading } = useTransaction(transactionId || '');
  const { data: sourceTx } = useTransaction(duplicateFromId || '');
  const { data: clients = [] } = useClients();
  const { data: projectsData = [] } = useProjects();
  const { data: businessProfiles = [] } = useBusinessProfiles();

  const createMutation = useCreateTransaction();
  const updateMutation = useUpdateTransaction();
  const deleteMutation = useDeleteTransaction();

  // Determine initial profile
  const initialProfileId = useMemo(() => {
    if (existingTx?.profileId) return existingTx.profileId;
    if (defaultProfileId) return defaultProfileId;
    if (!isAllProfiles && activeProfileId && activeProfileId !== 'all') return activeProfileId;
    if (profiles.length === 1) return profiles[0].id;
    return '';
  }, [existingTx, defaultProfileId, isAllProfiles, activeProfileId, profiles]);

  // Map existing transaction status to income status
  // For now, we infer: paid → received, unpaid → invoiced (most common)
  const getIncomeStatusFromTx = (status: TxStatus): IncomeStatus => {
    if (status === 'paid') return 'received';
    // Default unpaid income to 'invoiced' as that's the most common case
    return 'invoiced';
  };

  const getDefaultStatus = (): IncomeStatus => {
    if (existingTx) {
      return getIncomeStatusFromTx(existingTx.status);
    }
    return defaultStatus || 'earned';
  };

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      incomeStatus: getDefaultStatus(),
      profileId: initialProfileId,
      amount: '',
      currency: 'USD',
      occurredAt: todayISO(),
      clientId: defaultClientId || '',
      projectId: defaultProjectId || '',
      dueDate: '',
      title: '',
      notes: '',
    },
  });

  const { watch, setValue, reset } = form;
  const selectedStatus = watch('incomeStatus');
  const selectedClientId = watch('clientId');
  const watchedProfileId = watch('profileId');

  // Update profileId when initialProfileId changes
  useEffect(() => {
    if (initialProfileId && !watchedProfileId) {
      setValue('profileId', initialProfileId);
    }
  }, [initialProfileId, watchedProfileId, setValue]);

  // Reset form when existing transaction loads
  useEffect(() => {
    if (existingTx) {
      const incomeStatus = getIncomeStatusFromTx(existingTx.status);

      reset({
        incomeStatus,
        profileId: existingTx.profileId || initialProfileId,
        amount: (existingTx.amountMinor / 100).toString(),
        currency: existingTx.currency,
        occurredAt: existingTx.occurredAt.split('T')[0],
        clientId: existingTx.clientId || '',
        projectId: existingTx.projectId || '',
        dueDate: existingTx.dueDate || '',
        title: existingTx.title || '',
        notes: existingTx.notes || '',
      });
    }
  }, [existingTx, reset, initialProfileId]);

  // Reset form when duplicating from source transaction
  useEffect(() => {
    if (duplicateFromId && sourceTx && mode === 'create') {
      // When duplicating, default to 'invoiced' (common use case: new invoice for same work)
      reset({
        incomeStatus: 'invoiced',
        profileId: sourceTx.profileId || initialProfileId,
        amount: (sourceTx.amountMinor / 100).toString(),
        currency: sourceTx.currency,
        occurredAt: todayISO(),
        clientId: sourceTx.clientId || '',
        projectId: sourceTx.projectId || '',
        dueDate: '',
        title: sourceTx.title || '',
        notes: sourceTx.notes || '',
      });
    }
  }, [duplicateFromId, sourceTx, mode, reset, initialProfileId]);

  // Filter projects by selected client
  const filteredProjects = selectedClientId
    ? projectsData.filter((p) => p.clientId === selectedClientId)
    : projectsData;

  const onSubmit = async (data: FormData) => {
    // Map income status to database status
    // Note: For phase 1, we don't store earned/invoiced distinction - just paid/unpaid
    // The UI shows Earned/Invoiced/Received, but storage is simplified
    const status: TxStatus = data.incomeStatus === 'received' ? 'paid' : 'unpaid';

    const amountMinor = parseAmountToMinor(data.amount);
    const txData = {
      kind: 'income' as const,
      status,
      profileId: data.profileId,
      title: data.title || undefined,
      clientId: data.clientId || undefined,
      projectId: data.projectId || undefined,
      amountMinor,
      currency: data.currency as Currency,
      occurredAt: new Date(data.occurredAt).toISOString(),
      dueDate: (data.incomeStatus !== 'received' && data.dueDate) ? data.dueDate : undefined,
      paidAt: status === 'paid' ? new Date().toISOString() : undefined,
      receivedAmountMinor: status === 'paid' ? amountMinor : undefined,
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
      closeIncomeDrawer();
    } catch (error) {
      console.error('Failed to save income:', error);
    }
  };

  const handleDelete = async () => {
    if (!transactionId) return;
    if (!confirm(t('transactions.confirmDelete'))) return;

    try {
      await deleteMutation.mutateAsync(transactionId);
      closeIncomeDrawer();
    } catch (error) {
      console.error('Failed to delete income:', error);
    }
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  if (mode === 'edit' && txLoading) {
    return (
      <Drawer title={t('common.loading')} onClose={closeIncomeDrawer}>
        <div className="loading">
          <div className="spinner" />
        </div>
      </Drawer>
    );
  }

  return (
    <Drawer
      title={mode === 'edit' ? t('drawer.income.editTitle') : t('drawer.income.title')}
      onClose={closeIncomeDrawer}
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
            <button type="button" className="btn btn-secondary" onClick={closeIncomeDrawer}>
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              form="income-form"
              className="btn btn-primary"
              disabled={isSubmitting}
            >
              {isSubmitting ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </>
      }
    >
      <form id="income-form" onSubmit={form.handleSubmit(onSubmit)}>
        {/* Profile Selector */}
        <div className="form-group">
          <label className="form-label">{t('drawer.transaction.profile')} *</label>
          <Controller
            name="profileId"
            control={form.control}
            render={({ field }) => (
              <select
                className={cn('select', form.formState.errors.profileId && 'input-error')}
                style={{ width: '100%' }}
                {...field}
              >
                <option value="">{t('drawer.transaction.profilePlaceholder')}</option>
                {businessProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
            )}
          />
          {form.formState.errors.profileId && (
            <p className="form-error">{t('validation.profileRequired')}</p>
          )}
        </div>

        {/* Status Selector: Earned / Invoiced / Received */}
        <div className="type-selector">
          <button
            type="button"
            className={cn('type-selector-btn', selectedStatus === 'earned' && 'active')}
            onClick={() => setValue('incomeStatus', 'earned')}
          >
            <span className="type-selector-label">{t('drawer.income.statusEarned')}</span>
            <span className="type-selector-hint">{t('drawer.income.statusEarnedHint')}</span>
          </button>
          <button
            type="button"
            className={cn('type-selector-btn', selectedStatus === 'invoiced' && 'active')}
            onClick={() => setValue('incomeStatus', 'invoiced')}
          >
            <span className="type-selector-label">{t('drawer.income.statusInvoiced')}</span>
            <span className="type-selector-hint">{t('drawer.income.statusInvoicedHint')}</span>
          </button>
          <button
            type="button"
            className={cn('type-selector-btn', selectedStatus === 'received' && 'active')}
            onClick={() => setValue('incomeStatus', 'received')}
          >
            <span className="type-selector-label">{t('drawer.income.statusReceived')}</span>
            <span className="type-selector-hint">{t('drawer.income.statusReceivedHint')}</span>
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

        {/* Due Date (only for Earned/Invoiced - unpaid income) */}
        {selectedStatus !== 'received' && (
          <div className="form-group">
            <label className="form-label">{t('drawer.income.dueDate')}</label>
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
