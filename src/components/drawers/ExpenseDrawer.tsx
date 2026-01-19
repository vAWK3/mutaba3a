import { useEffect, useMemo } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Drawer } from './Drawer';
import { useDrawerStore } from '../../lib/stores';
import { useBusinessProfiles } from '../../hooks/useQueries';
import {
  useExpense,
  useCreateExpense,
  useUpdateExpense,
  useDeleteExpense,
  useRecurringRule,
  useCreateRecurringRule,
  useUpdateRecurringRule,
  useDeleteRecurringRule,
  useExpenseCategories,
  useLinkReceiptToExpense,
} from '../../hooks/useExpenseQueries';
import { VendorTypeahead } from '../ui/VendorTypeahead';
import { cn, parseAmountToMinor, todayISO } from '../../lib/utils';
import { useT, useLanguage } from '../../lib/i18n';
import { ALL_CATEGORIES } from '../../db/defaultExpenseCategories';
import type { Currency, ExpenseFrequency, RecurringEndMode } from '../../types';

const schema = z.object({
  expenseType: z.enum(['onetime', 'recurring']),
  profileId: z.string().min(1, 'Profile is required'),
  amount: z.string().min(1, 'Amount is required'),
  currency: z.enum(['USD', 'ILS']),
  occurredAt: z.string().min(1, 'Date is required'),
  title: z.string().optional(),
  vendor: z.string().optional(),
  vendorId: z.string().optional(),
  categoryId: z.string().min(1, 'Category is required'),
  notes: z.string().optional(),
  // Recurring fields
  frequency: z.enum(['monthly', 'yearly']).optional(),
  startDate: z.string().optional(),
  endMode: z.enum(['endOfYear', 'untilDate', 'noEnd']).optional(),
  endDate: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.expenseType === 'recurring') {
    if (!data.title) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Title is required for recurring expenses',
        path: ['title'],
      });
    }
    if (!data.frequency) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Frequency is required',
        path: ['frequency'],
      });
    }
    if (!data.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Start date is required',
        path: ['startDate'],
      });
    }
    if (!data.endMode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'End mode is required',
        path: ['endMode'],
      });
    }
    if (data.endMode === 'untilDate' && !data.endDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'End date is required',
        path: ['endDate'],
      });
    }
  }
});

type FormData = z.infer<typeof schema>;

export function ExpenseDrawer() {
  const { expenseDrawer, closeExpenseDrawer } = useDrawerStore();
  const { mode, expenseId, recurringRuleId, defaultProfileId, isRecurring, prefillData, linkReceiptId } = expenseDrawer;
  const t = useT();
  const { language } = useLanguage();

  const { data: profiles = [] } = useBusinessProfiles();
  const { data: existingExpense, isLoading: expenseLoading } = useExpense(expenseId || '');
  const { data: existingRule, isLoading: ruleLoading } = useRecurringRule(recurringRuleId || '');
  const linkReceiptMutation = useLinkReceiptToExpense();

  // Get categories for selected profile
  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      expenseType: isRecurring ? 'recurring' : 'onetime',
      profileId: defaultProfileId || '',
      amount: prefillData?.amountMinor ? (prefillData.amountMinor / 100).toString() : '',
      currency: prefillData?.currency || 'USD',
      occurredAt: prefillData?.occurredAt?.split('T')[0] || todayISO(),
      title: prefillData?.title || '',
      vendor: prefillData?.vendor || '',
      vendorId: prefillData?.vendorId || '',
      categoryId: prefillData?.categoryId || '',
      notes: '',
      frequency: 'monthly',
      startDate: todayISO(),
      endMode: 'endOfYear',
      endDate: '',
    },
  });

  const { watch, setValue, reset } = form;
  const selectedExpenseType = watch('expenseType');
  const selectedProfileId = watch('profileId');
  const selectedEndMode = watch('endMode');

  const { data: profileCategories = [] } = useExpenseCategories(selectedProfileId);

  // Use ALL_CATEGORIES as fallback when profile has no categories
  const fallbackCategories = useMemo(() =>
    ALL_CATEGORIES.map(cat => ({
      id: cat.name, // Use name as id for fallback categories
      profileId: selectedProfileId,
      name: language === 'ar' ? cat.nameAr : cat.name,
      color: cat.color,
    })),
    [language, selectedProfileId]
  );

  const categories = profileCategories.length > 0 ? profileCategories : fallbackCategories;

  const createExpenseMutation = useCreateExpense();
  const updateExpenseMutation = useUpdateExpense();
  const deleteExpenseMutation = useDeleteExpense();

  const createRuleMutation = useCreateRecurringRule();
  const updateRuleMutation = useUpdateRecurringRule();
  const deleteRuleMutation = useDeleteRecurringRule();

  // Reset form when existing expense loads
  useEffect(() => {
    if (existingExpense) {
      reset({
        expenseType: 'onetime',
        profileId: existingExpense.profileId,
        amount: (existingExpense.amountMinor / 100).toString(),
        currency: existingExpense.currency,
        occurredAt: existingExpense.occurredAt.split('T')[0],
        title: existingExpense.title || '',
        vendor: existingExpense.vendor || '',
        vendorId: existingExpense.vendorId || '',
        categoryId: existingExpense.categoryId || '',
        notes: existingExpense.notes || '',
        frequency: 'monthly',
        startDate: todayISO(),
        endMode: 'endOfYear',
        endDate: '',
      });
    }
  }, [existingExpense, reset]);

  // Reset form when existing recurring rule loads
  useEffect(() => {
    if (existingRule) {
      reset({
        expenseType: 'recurring',
        profileId: existingRule.profileId,
        amount: (existingRule.amountMinor / 100).toString(),
        currency: existingRule.currency,
        occurredAt: existingRule.startDate,
        title: existingRule.title,
        vendor: existingRule.vendor || '',
        categoryId: existingRule.categoryId || '',
        notes: '',
        frequency: existingRule.frequency,
        startDate: existingRule.startDate,
        endMode: existingRule.endMode,
        endDate: existingRule.endDate || '',
      });
    }
  }, [existingRule, reset]);

  // Set default profile if only one exists
  useEffect(() => {
    if (profiles.length === 1 && !selectedProfileId) {
      setValue('profileId', profiles[0].id);
    }
  }, [profiles, selectedProfileId, setValue]);

  const onSubmit = async (data: FormData) => {
    try {
      if (data.expenseType === 'recurring') {
        // Handle recurring rule
        const ruleData = {
          profileId: data.profileId,
          title: data.title || '',
          vendor: data.vendor || undefined,
          categoryId: data.categoryId || undefined,
          amountMinor: parseAmountToMinor(data.amount),
          currency: data.currency as Currency,
          frequency: data.frequency as ExpenseFrequency,
          startDate: data.startDate || todayISO(),
          endMode: data.endMode as RecurringEndMode,
          endDate: data.endMode === 'untilDate' ? data.endDate : undefined,
          isPaused: false,
        };

        if (mode === 'edit' && recurringRuleId) {
          await updateRuleMutation.mutateAsync({ id: recurringRuleId, data: ruleData });
        } else {
          await createRuleMutation.mutateAsync(ruleData);
        }
      } else {
        // Handle one-time expense
        const expenseData = {
          profileId: data.profileId,
          title: data.title || undefined,
          vendor: data.vendor || undefined,
          vendorId: data.vendorId || undefined,
          categoryId: data.categoryId || undefined,
          amountMinor: parseAmountToMinor(data.amount),
          currency: data.currency as Currency,
          occurredAt: new Date(data.occurredAt).toISOString(),
          notes: data.notes || undefined,
        };

        if (mode === 'edit' && expenseId) {
          await updateExpenseMutation.mutateAsync({ id: expenseId, data: expenseData });
        } else {
          const createdExpense = await createExpenseMutation.mutateAsync(expenseData);
          // Link receipt if provided
          if (linkReceiptId && createdExpense) {
            await linkReceiptMutation.mutateAsync({
              receiptId: linkReceiptId,
              expenseId: createdExpense.id,
            });
          }
        }
      }
      closeExpenseDrawer();
    } catch (error) {
      console.error('Failed to save expense:', error);
    }
  };

  const handleDelete = async () => {
    if (recurringRuleId) {
      if (!confirm(t('expenses.confirmDelete'))) return;
      try {
        await deleteRuleMutation.mutateAsync(recurringRuleId);
        closeExpenseDrawer();
      } catch (error) {
        console.error('Failed to delete recurring rule:', error);
      }
    } else if (expenseId) {
      if (!confirm(t('expenses.confirmDelete'))) return;
      try {
        await deleteExpenseMutation.mutateAsync(expenseId);
        closeExpenseDrawer();
      } catch (error) {
        console.error('Failed to delete expense:', error);
      }
    }
  };

  const isSubmitting =
    createExpenseMutation.isPending ||
    updateExpenseMutation.isPending ||
    createRuleMutation.isPending ||
    updateRuleMutation.isPending;

  const isLoading = (mode === 'edit' && expenseId && expenseLoading) ||
                   (mode === 'edit' && recurringRuleId && ruleLoading);

  if (isLoading) {
    return (
      <Drawer title={t('common.loading')} onClose={closeExpenseDrawer}>
        <div className="loading">
          <div className="spinner" />
        </div>
      </Drawer>
    );
  }

  const getTitle = () => {
    if (mode === 'edit') {
      return recurringRuleId ? t('drawer.expense.editRecurring') : t('drawer.expense.edit');
    }
    return selectedExpenseType === 'recurring'
      ? t('drawer.expense.newRecurring')
      : t('drawer.expense.new');
  };

  return (
    <Drawer
      title={getTitle()}
      onClose={closeExpenseDrawer}
      footer={
        <>
          <div className="drawer-footer-left">
            {mode === 'edit' && (
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleDelete}
                disabled={deleteExpenseMutation.isPending || deleteRuleMutation.isPending}
              >
                {t('common.delete')}
              </button>
            )}
          </div>
          <div className="drawer-footer-right">
            <button type="button" className="btn btn-secondary" onClick={closeExpenseDrawer}>
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              form="expense-form"
              className="btn btn-primary"
              disabled={isSubmitting}
            >
              {isSubmitting ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </>
      }
    >
      <form id="expense-form" onSubmit={form.handleSubmit(onSubmit)}>
        {/* Type Selector (only show in create mode) */}
        {mode === 'create' && (
          <div className="type-selector">
            <button
              type="button"
              className={cn('type-selector-btn', selectedExpenseType === 'onetime' && 'active')}
              onClick={() => setValue('expenseType', 'onetime')}
            >
              <span className="type-selector-label">{t('drawer.expense.typeOneTime')}</span>
              <span className="type-selector-hint">{t('drawer.expense.typeOneTimeDesc')}</span>
            </button>
            <button
              type="button"
              className={cn('type-selector-btn', selectedExpenseType === 'recurring' && 'active')}
              onClick={() => setValue('expenseType', 'recurring')}
            >
              <span className="type-selector-label">{t('drawer.expense.typeRecurring')}</span>
              <span className="type-selector-hint">{t('drawer.expense.typeRecurringDesc')}</span>
            </button>
          </div>
        )}

        {/* Profile */}
        <div className="form-group">
          <label className="form-label">{t('drawer.expense.profile')} *</label>
          <Controller
            name="profileId"
            control={form.control}
            render={({ field }) => (
              <select
                className={cn('select', form.formState.errors.profileId && 'input-error')}
                style={{ width: '100%' }}
                {...field}
              >
                <option value="">{t('drawer.expense.profilePlaceholder')}</option>
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
            )}
          />
          {form.formState.errors.profileId && (
            <p className="form-error">{t('validation.required')}</p>
          )}
        </div>

        {/* Amount & Currency */}
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">{t('drawer.expense.amount')} *</label>
            <input
              type="number"
              step="0.01"
              min="0"
              className={cn('input', form.formState.errors.amount && 'input-error')}
              placeholder={t('drawer.expense.amountPlaceholder')}
              {...form.register('amount')}
            />
            {form.formState.errors.amount && (
              <p className="form-error">{t('validation.amountRequired')}</p>
            )}
          </div>
          <div className="form-group">
            <label className="form-label">{t('drawer.expense.currency')} *</label>
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

        {/* Date (for one-time) or Start Date (for recurring) */}
        {selectedExpenseType === 'onetime' ? (
          <div className="form-group">
            <label className="form-label">{t('drawer.expense.date')} *</label>
            <input
              type="date"
              className={cn('input', form.formState.errors.occurredAt && 'input-error')}
              {...form.register('occurredAt')}
            />
          </div>
        ) : (
          <>
            {/* Frequency */}
            <div className="form-group">
              <label className="form-label">{t('drawer.expense.frequency')} *</label>
              <Controller
                name="frequency"
                control={form.control}
                render={({ field }) => (
                  <select className="select" style={{ width: '100%' }} {...field}>
                    <option value="monthly">{t('expenses.recurring.monthly')}</option>
                    <option value="yearly">{t('expenses.recurring.yearly')}</option>
                  </select>
                )}
              />
            </div>

            {/* Start Date */}
            <div className="form-group">
              <label className="form-label">{t('drawer.expense.startDate')} *</label>
              <input
                type="date"
                className={cn('input', form.formState.errors.startDate && 'input-error')}
                {...form.register('startDate')}
              />
            </div>

            {/* End Mode */}
            <div className="form-group">
              <label className="form-label">{t('drawer.expense.endMode')} *</label>
              <Controller
                name="endMode"
                control={form.control}
                render={({ field }) => (
                  <select className="select" style={{ width: '100%' }} {...field}>
                    <option value="endOfYear">{t('expenses.recurring.endOfYear')}</option>
                    <option value="untilDate">{t('expenses.recurring.untilDate')}</option>
                    <option value="noEnd">{t('expenses.recurring.noEnd')}</option>
                  </select>
                )}
              />
            </div>

            {/* End Date (only if endMode === 'untilDate') */}
            {selectedEndMode === 'untilDate' && (
              <div className="form-group">
                <label className="form-label">{t('drawer.expense.endDate')} *</label>
                <input
                  type="date"
                  className={cn('input', form.formState.errors.endDate && 'input-error')}
                  {...form.register('endDate')}
                />
              </div>
            )}
          </>
        )}

        {/* Title */}
        <div className="form-group">
          <label className="form-label">
            {t('drawer.expense.title')} {selectedExpenseType === 'recurring' && '*'}
          </label>
          <input
            type="text"
            className={cn('input', form.formState.errors.title && 'input-error')}
            placeholder={t('drawer.expense.titlePlaceholder')}
            {...form.register('title')}
          />
        </div>

        {/* Vendor */}
        <div className="form-group">
          <label className="form-label">{t('drawer.expense.vendor')}</label>
          <Controller
            name="vendor"
            control={form.control}
            render={({ field }) => (
              <VendorTypeahead
                profileId={selectedProfileId}
                value={field.value || ''}
                vendorId={watch('vendorId')}
                onChange={(value, vendorId) => {
                  field.onChange(value);
                  setValue('vendorId', vendorId || '');
                }}
                disabled={!selectedProfileId}
              />
            )}
          />
        </div>

        {/* Category */}
        <div className="form-group">
          <label className="form-label">{t('drawer.expense.category')} *</label>
          <Controller
            name="categoryId"
            control={form.control}
            render={({ field }) => (
              <select
                className={cn('select', form.formState.errors.categoryId && 'input-error')}
                style={{ width: '100%' }}
                {...field}
              >
                <option value="">{t('drawer.expense.categoryPlaceholder')}</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            )}
          />
          {form.formState.errors.categoryId && (
            <p className="form-error">{t('validation.required')}</p>
          )}
        </div>

        {/* Notes (only for one-time) */}
        {selectedExpenseType === 'onetime' && (
          <div className="form-group">
            <label className="form-label">{t('drawer.expense.notes')}</label>
            <textarea
              className="textarea"
              placeholder={t('drawer.expense.notesPlaceholder')}
              {...form.register('notes')}
            />
          </div>
        )}
      </form>
    </Drawer>
  );
}
