import { useEffect, useMemo } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Drawer } from './Drawer';
import { useDrawerStore } from '../../lib/stores';
import { useClients, useProjects, useBusinessProfiles } from '../../hooks/useQueries';
import {
  useRetainer,
  useCreateRetainer,
  useUpdateRetainer,
  useArchiveRetainer,
} from '../../hooks/useRetainerQueries';
import { cn, parseAmountToMinor, todayISO, formatAmount } from '../../lib/utils';
import { useT, useLanguage, getLocale } from '../../lib/i18n';
import type { Currency, RetainerCadence, RetainerStatus } from '../../types';

const schema = z.object({
  profileId: z.string().min(1, 'Profile is required'),
  clientId: z.string().min(1, 'Client is required'),
  title: z.string().min(1, 'Title is required'),
  amount: z.string().min(1, 'Amount is required'),
  currency: z.enum(['USD', 'ILS', 'EUR']),
  cadence: z.enum(['monthly', 'quarterly']),
  paymentDay: z.number().min(1).max(28),
  startDate: z.string().min(1, 'Start date is required'),
  endDate: z.string().optional(),
  projectId: z.string().optional(),
  notes: z.string().optional(),
  status: z.enum(['draft', 'active', 'paused', 'ended']),
});

type FormData = z.infer<typeof schema>;

export function RetainerDrawer() {
  const { retainerDrawer, closeRetainerDrawer } = useDrawerStore();
  const { mode, retainerId, defaultProfileId, defaultClientId, defaultProjectId } = retainerDrawer;
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);

  const { data: profiles = [] } = useBusinessProfiles();
  const { data: clients = [] } = useClients();
  const { data: projects = [] } = useProjects();
  const { data: existingRetainer, isLoading: retainerLoading } = useRetainer(retainerId || '');

  // Get default profile (first one or default one)
  const defaultProfile = useMemo(() => {
    if (defaultProfileId) return defaultProfileId;
    const defaultOne = profiles.find((p) => p.isDefault);
    return defaultOne?.id || profiles[0]?.id || '';
  }, [defaultProfileId, profiles]);

  // Get today's day of month, capped at 28
  const defaultPaymentDay = Math.min(new Date().getDate(), 28);

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      profileId: defaultProfile,
      clientId: defaultClientId || '',
      title: '',
      amount: '',
      currency: 'USD',
      cadence: 'monthly',
      paymentDay: defaultPaymentDay,
      startDate: todayISO(),
      endDate: '',
      projectId: defaultProjectId || '',
      notes: '',
      status: 'draft',
    },
  });

  const { watch, setValue, reset, formState: { errors } } = form;
  const selectedClientId = watch('clientId');
  const selectedAmount = watch('amount');
  const selectedCurrency = watch('currency');
  const selectedCadence = watch('cadence');
  const selectedPaymentDay = watch('paymentDay');
  const selectedStartDate = watch('startDate');
  const selectedEndDate = watch('endDate');

  // Filter projects by selected client
  const filteredProjects = useMemo(() => {
    if (!selectedClientId) return projects;
    return projects.filter((p) => !p.clientId || p.clientId === selectedClientId);
  }, [projects, selectedClientId]);

  // Generate live schedule preview
  const schedulePreview = useMemo(() => {
    const amountMinor = parseAmountToMinor(selectedAmount);
    if (!selectedStartDate || !amountMinor) return [];

    const preview: Array<{ date: string; periodLabel: string }> = [];
    const startDate = new Date(selectedStartDate);
    const endDate = selectedEndDate ? new Date(selectedEndDate) : null;
    const horizonDate = new Date();
    horizonDate.setMonth(horizonDate.getMonth() + 12);
    const horizon = endDate && endDate < horizonDate ? endDate : horizonDate;

    const currentDate = new Date(startDate);
    const monthsIncrement = selectedCadence === 'quarterly' ? 3 : 1;

    while (currentDate <= horizon && preview.length < 6) {
      const year = currentDate.getFullYear();
      const month = currentDate.getMonth();

      // Calculate payment date
      const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
      const payDay = Math.min(selectedPaymentDay, lastDayOfMonth);
      const paymentDate = new Date(year, month, payDay);

      if (paymentDate >= startDate) {
        preview.push({
          date: paymentDate.toISOString().split('T')[0],
          periodLabel: selectedCadence === 'quarterly'
            ? `Q${Math.floor(month / 3) + 1} ${year}`
            : paymentDate.toLocaleDateString(locale, { month: 'short', year: 'numeric' }),
        });
      }

      currentDate.setMonth(currentDate.getMonth() + monthsIncrement);
    }

    return preview;
  }, [selectedStartDate, selectedEndDate, selectedCadence, selectedPaymentDay, selectedAmount, locale]);

  const createMutation = useCreateRetainer();
  const updateMutation = useUpdateRetainer();
  const archiveMutation = useArchiveRetainer();

  // Reset form when existing retainer loads
  useEffect(() => {
    if (existingRetainer) {
      reset({
        profileId: existingRetainer.profileId,
        clientId: existingRetainer.clientId,
        title: existingRetainer.title,
        amount: (existingRetainer.amountMinor / 100).toString(),
        currency: existingRetainer.currency,
        cadence: existingRetainer.cadence,
        paymentDay: existingRetainer.paymentDay,
        startDate: existingRetainer.startDate,
        endDate: existingRetainer.endDate || '',
        projectId: existingRetainer.projectId || '',
        notes: existingRetainer.notes || '',
        status: existingRetainer.status,
      });
    }
  }, [existingRetainer, reset]);

  // Set default profile when profiles load (for create mode)
  useEffect(() => {
    if (mode === 'create' && defaultProfile && !form.getValues('profileId')) {
      setValue('profileId', defaultProfile);
    }
  }, [mode, defaultProfile, setValue, form]);

  // Auto-generate title from client name
  useEffect(() => {
    if (mode === 'create' && selectedClientId && !form.getValues('title')) {
      const client = clients.find((c) => c.id === selectedClientId);
      if (client) {
        setValue('title', `${client.name} retainer`);
      }
    }
  }, [selectedClientId, clients, mode, setValue, form]);

  const onSubmit = async (data: FormData) => {
    try {
      const retainerData = {
        profileId: data.profileId,
        clientId: data.clientId,
        title: data.title,
        amountMinor: parseAmountToMinor(data.amount),
        currency: data.currency as Currency,
        cadence: data.cadence as RetainerCadence,
        paymentDay: data.paymentDay,
        startDate: data.startDate,
        endDate: data.endDate || undefined,
        projectId: data.projectId || undefined,
        notes: data.notes || undefined,
        status: data.status as RetainerStatus,
      };

      if (mode === 'edit' && retainerId) {
        await updateMutation.mutateAsync({ id: retainerId, data: retainerData });
      } else {
        await createMutation.mutateAsync(retainerData);
      }
      closeRetainerDrawer();
    } catch (error) {
      console.error('Failed to save retainer:', error);
    }
  };

  const handleArchive = async () => {
    if (!retainerId) return;
    if (!confirm(t('retainers.confirmArchive'))) return;

    try {
      await archiveMutation.mutateAsync(retainerId);
      closeRetainerDrawer();
    } catch (error) {
      console.error('Failed to archive retainer:', error);
    }
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending;
  const isLoading = mode === 'edit' && retainerId && retainerLoading;

  if (isLoading) {
    return (
      <Drawer title={t('common.loading')} onClose={closeRetainerDrawer}>
        <div className="loading">
          <div className="spinner" />
        </div>
      </Drawer>
    );
  }

  const getTitle = () => {
    if (mode === 'edit') {
      return t('drawer.retainer.edit');
    }
    return t('drawer.retainer.new');
  };

  return (
    <Drawer
      title={getTitle()}
      onClose={closeRetainerDrawer}
      footer={
        <>
          <div className="drawer-footer-left">
            {mode === 'edit' && (
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleArchive}
                disabled={archiveMutation.isPending}
              >
                {t('common.archive')}
              </button>
            )}
          </div>
          <div className="drawer-footer-right">
            <button type="button" className="btn btn-secondary" onClick={closeRetainerDrawer}>
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              form="retainer-form"
              className="btn btn-primary"
              disabled={isSubmitting}
            >
              {isSubmitting ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </>
      }
    >
      <div className="retainer-drawer-layout">
        <form id="retainer-form" className="retainer-drawer-form" onSubmit={form.handleSubmit(onSubmit)}>
          {/* Profile */}
          <div className="form-group">
            <label className="form-label">{t('drawer.expense.profile')} *</label>
            <Controller
              name="profileId"
              control={form.control}
              render={({ field }) => (
                <select
                  className={cn('select', errors.profileId && 'input-error')}
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
            {errors.profileId && <p className="form-error">{t('validation.required')}</p>}
          </div>

          {/* Client */}
          <div className="form-group">
            <label className="form-label">{t('drawer.retainer.client')} *</label>
            <Controller
              name="clientId"
              control={form.control}
              render={({ field }) => (
                <select
                  className={cn('select', errors.clientId && 'input-error')}
                  style={{ width: '100%' }}
                  {...field}
                >
                  <option value="">{t('drawer.retainer.clientPlaceholder')}</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </select>
              )}
            />
            {errors.clientId && <p className="form-error">{t('validation.required')}</p>}
          </div>

          {/* Title */}
          <div className="form-group">
            <label className="form-label">{t('drawer.retainer.title')} *</label>
            <input
              type="text"
              className={cn('input', errors.title && 'input-error')}
              placeholder={t('drawer.retainer.titlePlaceholder')}
              {...form.register('title')}
            />
            {errors.title && <p className="form-error">{t('validation.required')}</p>}
          </div>

          {/* Amount & Currency */}
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">{t('drawer.retainer.amount')} *</label>
              <input
                type="number"
                step="0.01"
                min="0"
                className={cn('input', errors.amount && 'input-error')}
                placeholder={t('drawer.retainer.amountPlaceholder')}
                {...form.register('amount')}
              />
              {errors.amount && <p className="form-error">{t('validation.amountRequired')}</p>}
            </div>
            <div className="form-group">
              <label className="form-label">{t('drawer.retainer.currency')} *</label>
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

          {/* Cadence & Payment Day */}
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">{t('drawer.retainer.cadence')} *</label>
              <Controller
                name="cadence"
                control={form.control}
                render={({ field }) => (
                  <select className="select" style={{ width: '100%' }} {...field}>
                    <option value="monthly">{t('retainers.cadence.monthly')}</option>
                    <option value="quarterly">{t('retainers.cadence.quarterly')}</option>
                  </select>
                )}
              />
            </div>
            <div className="form-group">
              <label className="form-label">{t('drawer.retainer.paymentDay')} *</label>
              <Controller
                name="paymentDay"
                control={form.control}
                render={({ field }) => (
                  <select
                    className="select"
                    style={{ width: '100%' }}
                    value={field.value}
                    onChange={(e) => field.onChange(Number(e.target.value))}
                  >
                    {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
                      <option key={day} value={day}>
                        {day}
                      </option>
                    ))}
                  </select>
                )}
              />
            </div>
          </div>

          {/* Start & End Date */}
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">{t('drawer.retainer.startDate')} *</label>
              <input
                type="date"
                className={cn('input', errors.startDate && 'input-error')}
                {...form.register('startDate')}
              />
              {errors.startDate && <p className="form-error">{t('validation.dateRequired')}</p>}
            </div>
            <div className="form-group">
              <label className="form-label">{t('drawer.retainer.endDate')}</label>
              <input
                type="date"
                className="input"
                {...form.register('endDate')}
              />
            </div>
          </div>

          {/* Project (optional) */}
          <div className="form-group">
            <label className="form-label">{t('drawer.retainer.project')}</label>
            <Controller
              name="projectId"
              control={form.control}
              render={({ field }) => (
                <select className="select" style={{ width: '100%' }} {...field}>
                  <option value="">{t('drawer.retainer.projectPlaceholder')}</option>
                  {filteredProjects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              )}
            />
          </div>

          {/* Status (only in edit mode) */}
          {mode === 'edit' && (
            <div className="form-group">
              <label className="form-label">{t('drawer.retainer.status')}</label>
              <Controller
                name="status"
                control={form.control}
                render={({ field }) => (
                  <select className="select" style={{ width: '100%' }} {...field}>
                    <option value="draft">{t('retainers.status.draft')}</option>
                    <option value="active">{t('retainers.status.active')}</option>
                    <option value="paused">{t('retainers.status.paused')}</option>
                    <option value="ended">{t('retainers.status.ended')}</option>
                  </select>
                )}
              />
            </div>
          )}

          {/* Notes */}
          <div className="form-group">
            <label className="form-label">{t('drawer.retainer.notes')}</label>
            <textarea
              className="textarea"
              placeholder={t('drawer.retainer.notesPlaceholder')}
              {...form.register('notes')}
            />
          </div>
        </form>

        {/* Live Schedule Preview */}
        <div className="retainer-drawer-preview">
          <h4 className="preview-title">{t('drawer.retainer.schedulePreview')}</h4>
          {schedulePreview.length > 0 ? (
            <div className="preview-schedule">
              {schedulePreview.map((item, index) => (
                <div key={index} className="preview-schedule-item">
                  <span className="preview-schedule-date">{item.periodLabel}</span>
                  <span className="preview-schedule-amount">
                    {formatAmount(parseAmountToMinor(selectedAmount), selectedCurrency, locale)}
                  </span>
                </div>
              ))}
              {schedulePreview.length === 6 && (
                <div className="preview-schedule-more">
                  {t('drawer.retainer.andMore')}
                </div>
              )}
            </div>
          ) : (
            <p className="preview-empty">{t('drawer.retainer.enterDetailsForPreview')}</p>
          )}
        </div>
      </div>
    </Drawer>
  );
}
