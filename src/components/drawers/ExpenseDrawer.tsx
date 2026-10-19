import { useCallback, useEffect, useMemo, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Drawer } from './Drawer';
import { useDrawerStore } from '../../lib/stores';
import { useBusinessProfiles, useProjects } from '../../hooks/useQueries';
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
  useSeedExpenseCategories,
} from '../../hooks/useExpenseQueries';
import { VendorTypeahead } from '../ui/VendorTypeahead';
import { Select } from '../ui';
import { ClientTypeahead } from '../ui/ClientTypeahead';
import { ProjectTypeahead } from '../ui/ProjectTypeahead';
import { useFeatureEnabled } from '../../lib/features/useFeatures';
import { useClientProjectCascade } from '../../lib/forms/useClientProjectCascade';
import { cn, currencyExponent, parseAmountToMinor, todayISO } from '../../lib/utils';
import { useT, useLanguage } from '../../lib/i18n';
import { useToast } from '../../lib/toastStore';
import { ALL_CATEGORIES } from '../../db/defaultExpenseCategories';
import { ExpenseFormFields, type ExpenseFormFieldsLabels } from '../expenses/ExpenseFormFields';
import type { Currency, ExpenseFrequency, RecurringEndMode } from '../../types';
import { schema, type FormData } from './expenseDrawerFormSchema';
import { BrandLoader } from '../brand/BrandLoader';
import { SaveFeedbackIcon } from '../icons/SaveFeedbackIcon';

export function ExpenseDrawer() {
  const { expenseDrawer, closeExpenseDrawer } = useDrawerStore();
  const { mode, expenseId, recurringRuleId, defaultProfileId, isRecurring, prefillData } = expenseDrawer;
  const t = useT();
  const { language } = useLanguage();
  const { showToast } = useToast();

  const { data: profiles = [] } = useBusinessProfiles();
  const projectsEnabled = useFeatureEnabled('projects');
  const { data: existingExpense, isLoading: expenseLoading } = useExpense(expenseId || '');
  const { data: existingRule, isLoading: ruleLoading } = useRecurringRule(recurringRuleId || '');

  // Get categories for selected profile
  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      expenseType: isRecurring ? 'recurring' : 'onetime',
      profileId: defaultProfileId || '',
      amount: prefillData?.amountMinor
        ? (prefillData.amountMinor / 10 ** currencyExponent(prefillData.currency || 'USD')).toString()
        : '',
      // MUT-281: prefillData.currency is the universal (9-code) Currency; this
      // drawer's own form still only offers the local app's narrower set
      // (MUT-282 widens it) -- no local record can hold a Gulf code yet.
      currency: (prefillData?.currency || 'USD') as FormData['currency'],
      occurredAt: prefillData?.occurredAt?.split('T')[0] || todayISO(),
      title: prefillData?.title || '',
      vendor: prefillData?.vendor || '',
      vendorId: prefillData?.vendorId || '',
      clientId: '',
      projectId: '',
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
  const selectedClientId = watch('clientId');

  const { data: profileCategories = [], isSuccess: categoriesLoaded } = useExpenseCategories(selectedProfileId);

  // A profile with no categories gets the default set on first use (MUT-14):
  // the seeding button lived on a deleted page; without rows here the ledger's
  // "by category" view cannot resolve names.
  const seedCategories = useSeedExpenseCategories();
  useEffect(() => {
    if (!selectedProfileId || !categoriesLoaded || profileCategories.length > 0 || seedCategories.isPending) return;
    seedCategories.mutate({ profileId: selectedProfileId, preset: 'general', language });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once per empty profile; the mutation object is stable enough and re-running on its identity would loop
  }, [selectedProfileId, categoriesLoaded, profileCategories.length, language]);
  const { data: projectsData = [] } = useProjects();

  // Bi-directional cascade between client and project fields
  // The client field flashes when picking a project fills it (MUT-318 A3)
  const [clientFlash, setClientFlash] = useState(0);
  const flashClient = useCallback(() => setClientFlash((n) => n + 1), []);
  useClientProjectCascade({ form, projectsData, onAutoFill: flashClient });

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
        amount: (existingExpense.amountMinor / 10 ** currencyExponent(existingExpense.currency)).toString(),
        // MUT-281: see the prefillData cast above.
        currency: existingExpense.currency as FormData['currency'],
        occurredAt: existingExpense.occurredAt.split('T')[0],
        title: existingExpense.title || '',
        vendor: existingExpense.vendor || '',
        vendorId: existingExpense.vendorId || '',
        clientId: existingExpense.clientId || '',
        projectId: existingExpense.projectId || '',
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
        amount: (existingRule.amountMinor / 10 ** currencyExponent(existingRule.currency)).toString(),
        // MUT-281: see the prefillData cast above.
        currency: existingRule.currency as FormData['currency'],
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
        // Extract day of month from start date
        const startDateObj = new Date(data.startDate || todayISO());
        const dayOfMonth = startDateObj.getDate();

        const ruleData = {
          profileId: data.profileId,
          title: data.title || '',
          vendor: data.vendor || undefined,
          categoryId: data.categoryId || undefined,
          amountMinor: parseAmountToMinor(data.amount, data.currency),
          currency: data.currency as Currency,
          frequency: data.frequency as ExpenseFrequency,
          dayOfMonth,
          startDate: data.startDate || todayISO(),
          endMode: data.endMode as RecurringEndMode,
          endDate: data.endMode === 'untilDate' ? data.endDate : undefined,
          scope: 'general' as const,
          reminderDaysBefore: 0,
          isPaused: false,
        };

        if (mode === 'edit' && recurringRuleId) {
          await updateRuleMutation.mutateAsync({ id: recurringRuleId, data: ruleData });
        } else {
          await createRuleMutation.mutateAsync(ruleData);
        }
        showToast(t('expenses.recurringSaveSuccess'), { icon: <SaveFeedbackIcon preset="playful" /> });
      } else {
        // Handle one-time expense
        const expenseData = {
          profileId: data.profileId,
          title: data.title || undefined,
          vendor: data.vendor || undefined,
          vendorId: data.vendorId || undefined,
          clientId: data.clientId || undefined,
          projectId: data.projectId || undefined,
          categoryId: data.categoryId || undefined,
          amountMinor: parseAmountToMinor(data.amount, data.currency),
          currency: data.currency as Currency,
          occurredAt: new Date(data.occurredAt).toISOString(),
          notes: data.notes || undefined,
        };

        if (mode === 'edit' && expenseId) {
          await updateExpenseMutation.mutateAsync({ id: expenseId, data: expenseData });
        } else {
          await createExpenseMutation.mutateAsync(expenseData);
        }
        showToast(t('expenses.saveSuccess'), { icon: <SaveFeedbackIcon preset="playful" /> });
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
        showToast(t('expenses.recurringDeleteSuccess'));
        closeExpenseDrawer();
      } catch (error) {
        console.error('Failed to delete recurring rule:', error);
        showToast(t('expenses.deleteError'), { duration: 5000 });
      }
    } else if (expenseId) {
      if (!confirm(t('expenses.confirmDelete'))) return;
      try {
        await deleteExpenseMutation.mutateAsync(expenseId);
        showToast(t('expenses.deleteSuccess'));
        closeExpenseDrawer();
      } catch (error) {
        console.error('Failed to delete expense:', error);
        showToast(t('expenses.deleteError'), { duration: 5000 });
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
        <div className="loading loading--section">
          <BrandLoader size={40} />
        </div>
      </Drawer>
    );
  }

  const expenseFormLabels: ExpenseFormFieldsLabels = {
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
              <Select
                invalid={Boolean(form.formState.errors.profileId)}
                {...field}
              >
                <option value="">{t('drawer.expense.profilePlaceholder')}</option>
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </Select>
            )}
          />
          {form.formState.errors.profileId && (
            <p className="form-error">{t('validation.required')}</p>
          )}
        </div>

        <ExpenseFormFields
          control={form.control}
          errors={form.formState.errors}
          categories={categories}
          currencyOptions={['USD', 'ILS', 'JOD']}
          amountInputMode="number"
          labels={expenseFormLabels}
          showDate={selectedExpenseType === 'onetime'}
          showNotes={selectedExpenseType === 'onetime'}
          titleRequired={selectedExpenseType === 'recurring'}
          dateSlotOverride={
            <>
              {/* Frequency */}
              <div className="form-group">
                <label className="form-label">{t('drawer.expense.frequency')} *</label>
                <Controller
                  name="frequency"
                  control={form.control}
                  render={({ field }) => (
                    <Select {...field}>
                      <option value="monthly">{t('expenses.recurring.monthly')}</option>
                      <option value="yearly">{t('expenses.recurring.yearly')}</option>
                    </Select>
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
                    <Select {...field}>
                      <option value="endOfYear">{t('expenses.recurring.endOfYear')}</option>
                      <option value="untilDate">{t('expenses.recurring.untilDate')}</option>
                      <option value="noEnd">{t('expenses.recurring.noEnd')}</option>
                    </Select>
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
          }
          vendorField={
            <>
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
            </>
          }
          clientField={
            <>
              <label className="form-label">{t('drawer.expense.client')}</label>
              <Controller
                name="clientId"
                control={form.control}
                render={({ field }) => (
                  <ClientTypeahead
                    profileId={selectedProfileId}
                    value={field.value || ''}
                    onChange={field.onChange}
                    placeholder={t('drawer.expense.clientPlaceholder')}
                    disabled={!selectedProfileId}
                    flashSignal={clientFlash}
                  />
                )}
              />
            </>
          }
          projectField={
            // shown only while the Projects area is on (MUT-16)
            projectsEnabled ? (
              <>
                <label className="form-label">{t('drawer.expense.project')}</label>
                <Controller
                  name="projectId"
                  control={form.control}
                  render={({ field }) => (
                    <ProjectTypeahead
                      profileId={selectedProfileId}
                      clientId={selectedClientId || undefined}
                      value={field.value || ''}
                      onChange={field.onChange}
                      placeholder={t('drawer.expense.projectPlaceholder')}
                      disabled={!selectedProfileId}
                    />
                  )}
                />
              </>
            ) : undefined
          }
        />
      </form>
    </Drawer>
  );
}
