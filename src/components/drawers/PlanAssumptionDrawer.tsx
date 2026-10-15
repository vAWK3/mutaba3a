import { useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Drawer } from './Drawer';
import { Select } from '../ui';
import { useDrawerStore } from '../../lib/stores';
import {
  usePlan,
  usePlanAssumption,
  useCreateAssumption,
  useUpdateAssumption,
  useDeleteAssumption,
} from '../../hooks/usePlanQueries';
import { cn, parseAmountToMinor } from '../../lib/utils';
import { useT } from '../../lib/i18n';
import type {
  Currency,
  AssumptionCategory,
  AssumptionType,
  AssumptionFrequency,
  AssumptionConfidence,
} from '../../types';
import './PlanAssumptionDrawer.css';
import { BrandLoader } from '../brand/BrandLoader';

const schema = z.object({
  planId: z.string().min(1, 'Plan is required'),
  profileId: z.string().min(1, 'Profile is required'),
  category: z.enum(['revenue', 'expense', 'funding', 'hiring', 'other']),
  type: z.enum(['one_time', 'recurring', 'milestone', 'percentage']),
  label: z.string().min(1, 'Label is required'),
  amount: z.string().min(1, 'Amount is required'),
  currency: z.enum(['USD', 'ILS', 'EUR']),
  startMonth: z.string().min(1, 'Start month is required'),
  endMonth: z.string().optional(),
  frequency: z.enum(['monthly', 'quarterly', 'yearly']).optional(),
  confidence: z.enum(['confirmed', 'likely', 'rough_guess']),
  notes: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

// Get current month as YYYY-MM
function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function PlanAssumptionDrawer() {
  const { planAssumptionDrawer, closePlanAssumptionDrawer } = useDrawerStore();
  const { mode, planId, assumptionId, defaultCategory, defaultProfileId } = planAssumptionDrawer;
  const t = useT();

  const { data: plan } = usePlan(planId || '');
  const { data: existingAssumption, isLoading: assumptionLoading } = usePlanAssumption(assumptionId || '');

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      planId: planId || '',
      profileId: defaultProfileId || '',
      category: defaultCategory || 'revenue',
      type: 'recurring',
      label: '',
      amount: '',
      currency: 'USD',
      startMonth: getCurrentMonth(),
      endMonth: '',
      frequency: 'monthly',
      confidence: 'likely',
      notes: '',
    },
  });

  const { watch, reset, formState: { errors } } = form;
  const selectedType = watch('type');

  // Create a unique key for this drawer instance to force reset
  const drawerKey = `${mode}-${planId}-${assumptionId}-${defaultCategory}`;

  // Reset form when drawer opens for creating new assumption
  useEffect(() => {
    if (mode === 'create' && plan) {
      reset({
        planId: plan.id,
        profileId: plan.profileId,
        category: defaultCategory || 'revenue',
        type: 'recurring',
        label: '',
        amount: '',
        // Plan assumptions stay USD/ILS/EUR-only (out of MUT-140's scope)
        currency: plan.currency as 'USD' | 'ILS' | 'EUR',
        startMonth: plan.startMonth,
        endMonth: '',
        frequency: 'monthly',
        confidence: 'likely',
        notes: '',
      });
    }
  }, [drawerKey, mode, plan, defaultCategory, reset]);

  useEffect(() => {
    if (existingAssumption) {
      reset({
        planId: existingAssumption.planId,
        profileId: existingAssumption.profileId,
        category: existingAssumption.category,
        type: existingAssumption.type,
        label: existingAssumption.label,
        amount: (existingAssumption.amountMinor / 100).toString(),
        currency: existingAssumption.currency as 'USD' | 'ILS' | 'EUR',
        startMonth: existingAssumption.startMonth,
        endMonth: existingAssumption.endMonth || '',
        frequency: existingAssumption.frequency,
        confidence: existingAssumption.confidence,
        notes: existingAssumption.notes || '',
      });
    }
  }, [existingAssumption, reset]);

  const createMutation = useCreateAssumption();
  const updateMutation = useUpdateAssumption();
  const deleteMutation = useDeleteAssumption();

  const onSubmit = async (data: FormData) => {
    // Validate required fields
    if (!data.planId || !data.profileId) {
      console.error('Missing planId or profileId', { planId: data.planId, profileId: data.profileId });
      return;
    }

    try {
      // For recurring type, ensure frequency is set
      const frequency = data.type === 'recurring'
        ? (data.frequency || 'monthly') as AssumptionFrequency
        : undefined;

      const assumptionData = {
        planId: data.planId,
        profileId: data.profileId,
        category: data.category as AssumptionCategory,
        type: data.type as AssumptionType,
        label: data.label,
        amountMinor: parseAmountToMinor(data.amount, data.currency),
        currency: data.currency as Currency,
        startMonth: data.startMonth,
        endMonth: data.endMonth || undefined,
        frequency,
        confidence: data.confidence as AssumptionConfidence,
        notes: data.notes || undefined,
      };

      console.log('Submitting assumption:', assumptionData);

      if (mode === 'edit' && assumptionId) {
        await updateMutation.mutateAsync({ id: assumptionId, data: assumptionData });
      } else {
        const result = await createMutation.mutateAsync(assumptionData);
        console.log('Created assumption:', result);
      }
      closePlanAssumptionDrawer();
    } catch (error) {
      console.error('Failed to save assumption:', error);
    }
  };

  const handleDelete = async () => {
    if (!assumptionId) return;
    if (!confirm(t('planning.confirmDeleteAssumption'))) return;

    try {
      await deleteMutation.mutateAsync(assumptionId);
      closePlanAssumptionDrawer();
    } catch (error) {
      console.error('Failed to delete assumption:', error);
    }
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending;
  const isLoading = mode === 'edit' && assumptionId && assumptionLoading;

  if (isLoading) {
    return (
      <Drawer title={t('common.loading')} onClose={closePlanAssumptionDrawer}>
        <div className="loading loading--section">
          <BrandLoader size={40} />
        </div>
      </Drawer>
    );
  }

  const getTitle = () => {
    if (mode === 'edit') {
      return t('planning.assumptions.edit');
    }
    return t('planning.assumptions.new');
  };

  // Category options with labels (excluding 'other')
  const categoryOptions: { value: AssumptionCategory; label: string }[] = [
    { value: 'revenue', label: t('planning.assumptions.categories.revenue') },
    { value: 'expense', label: t('planning.assumptions.categories.expense') },
    { value: 'funding', label: t('planning.assumptions.categories.funding') },
    { value: 'hiring', label: t('planning.assumptions.categories.hiring') },
  ];

  // Type options
  const typeOptions: { value: AssumptionType; label: string }[] = [
    { value: 'one_time', label: t('planning.assumptions.types.oneTime') },
    { value: 'recurring', label: t('planning.assumptions.types.recurring') },
  ];

  // Frequency options
  const frequencyOptions: { value: AssumptionFrequency; label: string }[] = [
    { value: 'monthly', label: t('planning.assumptions.frequency.monthly') },
    { value: 'quarterly', label: t('planning.assumptions.frequency.quarterly') },
    { value: 'yearly', label: t('planning.assumptions.frequency.yearly') },
  ];

  // Confidence options
  const confidenceOptions: { value: AssumptionConfidence; label: string }[] = [
    { value: 'confirmed', label: t('planning.assumptions.confidence.confirmed') },
    { value: 'likely', label: t('planning.assumptions.confidence.likely') },
    { value: 'rough_guess', label: t('planning.assumptions.confidence.roughGuess') },
  ];

  return (
    <Drawer
      title={getTitle()}
      onClose={closePlanAssumptionDrawer}
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
            <button type="button" className="btn btn-secondary" onClick={closePlanAssumptionDrawer}>
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              form="assumption-form"
              className="btn btn-primary"
              disabled={isSubmitting}
            >
              {isSubmitting ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </>
      }
    >
      <form id="assumption-form" className="drawer-form" onSubmit={form.handleSubmit(onSubmit)}>
        {/* Category */}
        <div className="form-group">
          <label className="form-label">{t('planning.assumptions.category')} *</label>
          <Controller
            name="category"
            control={form.control}
            render={({ field }) => (
              <div className="segment-control">
                {categoryOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={cn(
                      'segment-button',
                      field.value === option.value && 'active'
                    )}
                    onClick={() => field.onChange(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}
          />
        </div>

        {/* Label */}
        <div className="form-group">
          <label className="form-label">{t('planning.assumptions.label')} *</label>
          <input
            type="text"
            className={cn('input', errors.label && 'input-error')}
            placeholder={t('planning.assumptions.labelPlaceholder')}
            {...form.register('label')}
          />
          {errors.label && <p className="form-error">{t('validation.required')}</p>}
        </div>

        {/* Type */}
        <div className="form-group">
          <label className="form-label">{t('planning.assumptions.type')} *</label>
          <Controller
            name="type"
            control={form.control}
            render={({ field }) => (
              <div className="segment-control">
                {typeOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={cn(
                      'segment-button',
                      field.value === option.value && 'active'
                    )}
                    onClick={() => field.onChange(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}
          />
        </div>

        {/* Amount & Currency */}
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">{t('planning.assumptions.amount')} *</label>
            <input
              type="number"
              step="0.01"
              min="0"
              className={cn('input', errors.amount && 'input-error')}
              placeholder="0.00"
              {...form.register('amount')}
            />
            {errors.amount && <p className="form-error">{t('validation.amountRequired')}</p>}
          </div>
          <div className="form-group">
            <label className="form-label">{t('planning.assumptions.currency')} *</label>
            <Controller
              name="currency"
              control={form.control}
              render={({ field }) => (
                <Select {...field}>
                  <option value="USD">USD</option>
                  <option value="ILS">ILS</option>
                </Select>
              )}
            />
          </div>
        </div>

        {/* Frequency (only for recurring) */}
        {selectedType === 'recurring' && (
          <div className="form-group">
            <label className="form-label">{t('planning.assumptions.frequency.label')} *</label>
            <Controller
              name="frequency"
              control={form.control}
              render={({ field }) => (
                <Select {...field}>
                  {frequencyOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              )}
            />
          </div>
        )}

        {/* Start Month & End Month */}
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">{t('planning.assumptions.startMonth')} *</label>
            <input
              type="month"
              className={cn('input', errors.startMonth && 'input-error')}
              {...form.register('startMonth')}
            />
            {errors.startMonth && <p className="form-error">{t('validation.required')}</p>}
          </div>
          <div className="form-group">
            <label className="form-label">{t('planning.assumptions.endMonth')}</label>
            <input
              type="month"
              className="input"
              {...form.register('endMonth')}
            />
          </div>
        </div>

        {/* Confidence */}
        <div className="form-group">
          <label className="form-label">{t('planning.assumptions.confidence.label')} *</label>
          <Controller
            name="confidence"
            control={form.control}
            render={({ field }) => (
              <div className="confidence-options">
                {confidenceOptions.map((option) => (
                  <label
                    key={option.value}
                    className={cn(
                      'confidence-option',
                      field.value === option.value && 'selected'
                    )}
                  >
                    <input
                      type="radio"
                      name="confidence"
                      value={option.value}
                      checked={field.value === option.value}
                      onChange={() => field.onChange(option.value)}
                    />
                    <span className={cn('confidence-badge', option.value)}>
                      {option.label}
                    </span>
                  </label>
                ))}
              </div>
            )}
          />
        </div>

        {/* Notes */}
        <div className="form-group">
          <label className="form-label">{t('planning.assumptions.notes')}</label>
          <textarea
            className="textarea"
            placeholder={t('planning.assumptions.notesPlaceholder')}
            {...form.register('notes')}
          />
        </div>
      </form>
    </Drawer>
  );
}
