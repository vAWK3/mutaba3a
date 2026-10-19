import { useEffect, useMemo } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Drawer } from './Drawer';
import { useDrawerStore } from '../../lib/stores';
import { useBusinessProfiles } from '../../hooks/useQueries';
import {
  useConversionById,
  useCreateConversion,
  useUpdateConversion,
  useDeleteConversion,
} from '../../hooks/useConversionQueries';
import { Select } from '../ui';
import { cn, currencyExponent, parseAmountInput, parseAmountToMinor, todayISO } from '../../lib/utils';
import { minorToAmountInput } from '../../lib/paymentEntry';
import { useT } from '../../lib/i18n';
import { useToast } from '../../lib/toastStore';
import type { Currency } from '../../types';
import { schema, type FormData } from './conversionFormSchema';
import { BrandLoader } from '../brand/BrandLoader';

const CURRENCY_OPTIONS: readonly Currency[] = ['USD', 'ILS', 'EUR', 'JOD'];

/** Rate shown read-only below the two amount fields; null while either side can't be parsed yet. */
function impliedRate(fromAmount: string, fromCurrency: Currency, toAmount: string, toCurrency: Currency): number | null {
  const fromMinor = parseAmountInput(fromAmount, { currency: fromCurrency });
  const toMinor = parseAmountInput(toAmount, { currency: toCurrency });
  if (fromMinor === null || toMinor === null || fromMinor <= 0) return null;
  const fromMajor = fromMinor / 10 ** currencyExponent(fromCurrency);
  const toMajor = toMinor / 10 ** currencyExponent(toCurrency);
  return toMajor / fromMajor;
}

export function ConversionDrawer() {
  const { conversionDrawer, closeConversionDrawer } = useDrawerStore();
  const { mode, transactionId, defaultProfileId } = conversionDrawer;
  const t = useT();
  const { showToast } = useToast();

  const { data: profiles = [] } = useBusinessProfiles();
  const { data: existingTx, isLoading: txLoading } = useConversionById(transactionId || '');

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      profileId: defaultProfileId || '',
      fromAmount: '',
      fromCurrency: 'USD',
      toAmount: '',
      toCurrency: 'ILS',
      occurredAt: todayISO(),
      notes: '',
    },
  });

  const { watch, setValue, reset } = form;
  const selectedProfileId = watch('profileId');
  const fromAmount = watch('fromAmount');
  const fromCurrency = watch('fromCurrency');
  const toAmount = watch('toAmount');
  const toCurrency = watch('toCurrency');

  const rate = useMemo(
    () => impliedRate(fromAmount, fromCurrency, toAmount, toCurrency),
    [fromAmount, fromCurrency, toAmount, toCurrency]
  );

  const createMutation = useCreateConversion();
  const updateMutation = useUpdateConversion();
  const deleteMutation = useDeleteConversion();

  // Reset form when the existing conversion loads (edit mode)
  useEffect(() => {
    if (existingTx && existingTx.toCurrency && existingTx.toAmountMinor !== undefined) {
      reset({
        profileId: existingTx.profileId || '',
        fromAmount: minorToAmountInput(existingTx.amountMinor, existingTx.currency),
        // MUT-281: existingTx.currency/.toCurrency are the universal (9-code)
        // Currency; this drawer's own form still only offers the local app's
        // narrower set (MUT-282 widens it) -- no local record can hold a
        // Gulf code yet.
        fromCurrency: existingTx.currency as FormData['fromCurrency'],
        toAmount: minorToAmountInput(existingTx.toAmountMinor, existingTx.toCurrency),
        toCurrency: existingTx.toCurrency as FormData['toCurrency'],
        occurredAt: existingTx.occurredAt.split('T')[0],
        notes: existingTx.notes || '',
      });
    }
  }, [existingTx, reset]);

  // Default to the only profile when there's exactly one
  useEffect(() => {
    if (profiles.length === 1 && !selectedProfileId) {
      setValue('profileId', profiles[0].id);
    }
  }, [profiles, selectedProfileId, setValue]);

  const onSubmit = async (data: FormData) => {
    try {
      const conversionData = {
        profileId: data.profileId || undefined,
        amountMinor: parseAmountToMinor(data.fromAmount, data.fromCurrency as Currency),
        currency: data.fromCurrency as Currency,
        toAmountMinor: parseAmountToMinor(data.toAmount, data.toCurrency as Currency),
        toCurrency: data.toCurrency as Currency,
        occurredAt: new Date(data.occurredAt).toISOString(),
        notes: data.notes || undefined,
      };

      if (mode === 'edit' && transactionId) {
        await updateMutation.mutateAsync({ id: transactionId, data: conversionData });
      } else {
        await createMutation.mutateAsync(conversionData);
      }
      closeConversionDrawer();
    } catch (error) {
      console.error('Failed to save conversion:', error);
    }
  };

  const handleDelete = async () => {
    if (!transactionId) return;
    if (!confirm(t('conversions.confirmDelete'))) return;
    try {
      await deleteMutation.mutateAsync(transactionId);
      showToast(t('conversions.deleteSuccess'));
      closeConversionDrawer();
    } catch (error) {
      console.error('Failed to delete conversion:', error);
      showToast(t('conversions.deleteError'), { duration: 5000 });
    }
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending;
  const isLoading = mode === 'edit' && transactionId && txLoading;

  if (isLoading) {
    return (
      <Drawer title={t('common.loading')} onClose={closeConversionDrawer}>
        <div className="loading loading--section">
          <BrandLoader size={40} />
        </div>
      </Drawer>
    );
  }

  return (
    <Drawer
      title={mode === 'edit' ? t('conversions.drawer.edit') : t('conversions.drawer.new')}
      onClose={closeConversionDrawer}
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
            <button type="button" className="btn btn-secondary" onClick={closeConversionDrawer}>
              {t('common.cancel')}
            </button>
            <button type="submit" form="conversion-form" className="btn btn-primary" disabled={isSubmitting}>
              {isSubmitting ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </>
      }
    >
      <form id="conversion-form" onSubmit={form.handleSubmit(onSubmit)}>
        <div className="form-group">
          <label className="form-label" htmlFor="conversion-profile">{t('conversions.drawer.profile')} *</label>
          <Controller
            name="profileId"
            control={form.control}
            render={({ field }) => (
              <Select id="conversion-profile" {...field}>
                <option value="">{t('conversions.drawer.profilePlaceholder')}</option>
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>{profile.name}</option>
                ))}
              </Select>
            )}
          />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label" htmlFor="conversion-from-amount">{t('conversions.drawer.fromAmount')} *</label>
            <input
              id="conversion-from-amount"
              type="text"
              inputMode="decimal"
              dir="ltr"
              className={cn('input', form.formState.errors.fromAmount && 'input-error')}
              {...form.register('fromAmount')}
            />
            {form.formState.errors.fromAmount && (
              <p className="form-error">{String(form.formState.errors.fromAmount.message ?? '')}</p>
            )}
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="conversion-from-currency">{t('conversions.drawer.fromCurrency')} *</label>
            <Controller
              name="fromCurrency"
              control={form.control}
              render={({ field }) => (
                <Select id="conversion-from-currency" {...field}>
                  {CURRENCY_OPTIONS.map((code) => <option key={code} value={code}>{code}</option>)}
                </Select>
              )}
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label" htmlFor="conversion-to-amount">{t('conversions.drawer.toAmount')} *</label>
            <input
              id="conversion-to-amount"
              type="text"
              inputMode="decimal"
              dir="ltr"
              className={cn('input', form.formState.errors.toAmount && 'input-error')}
              {...form.register('toAmount')}
            />
            {form.formState.errors.toAmount && (
              <p className="form-error">{String(form.formState.errors.toAmount.message ?? '')}</p>
            )}
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="conversion-to-currency">{t('conversions.drawer.toCurrency')} *</label>
            <Controller
              name="toCurrency"
              control={form.control}
              render={({ field }) => (
                <Select id="conversion-to-currency" {...field}>
                  {CURRENCY_OPTIONS.map((code) => <option key={code} value={code}>{code}</option>)}
                </Select>
              )}
            />
            {form.formState.errors.toCurrency && (
              <p className="form-error">{String(form.formState.errors.toCurrency.message ?? '')}</p>
            )}
          </div>
        </div>

        {rate !== null && (
          <p className="form-hint">
            {t('conversions.drawer.impliedRate', { rate: rate.toFixed(4), from: fromCurrency, to: toCurrency })}
          </p>
        )}

        <div className="form-group">
          <label className="form-label" htmlFor="conversion-date">{t('conversions.drawer.date')} *</label>
          <input
            id="conversion-date"
            type="date"
            className={cn('input', form.formState.errors.occurredAt && 'input-error')}
            {...form.register('occurredAt')}
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="conversion-notes">{t('conversions.drawer.notes')}</label>
          <textarea
            id="conversion-notes"
            className="input"
            placeholder={t('conversions.drawer.notesPlaceholder')}
            {...form.register('notes')}
          />
        </div>
      </form>
    </Drawer>
  );
}
