import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '../../components/ui/Button';
import { useLanguage } from '../../lib/i18n/core';
import { useCreateConversion } from '../data/conversionQueries';
import { useToast } from './Toast';
import { Drawer } from './Drawer';
import { applyConversionApiError } from './conversionApiErrors';
import { conversionFormSchema, CURRENCY_OPTIONS, impliedRate, type ConversionFormValues } from './conversionFormSchema';
import { todayLocalISO } from '../format/dates';
import type { CreateConversionRequest } from '../api/client';

/**
 * The hosted portal's conversion capture (MUT-161). Create-only — no edit or
 * delete, unlike ExpenseDrawer: a logging mistake is corrected with a new
 * entry. Two amount/currency pairs instead of one, so it doesn't reuse
 * ExpenseFormFields; built standalone like the local app's own
 * ConversionDrawer, with no client/project linking (out of scope).
 */
function emptyValues(): ConversionFormValues {
  return { fromAmount: '', fromCurrency: 'USD', toAmount: '', toCurrency: 'ILS', occurredAt: todayLocalISO(), notes: '' };
}

export interface ConversionDrawerProps {
  profileId: string;
  onClose: () => void;
}

export function ConversionDrawer({ profileId, onClose }: ConversionDrawerProps) {
  const { t } = useLanguage();
  const showToast = useToast();
  const createMutation = useCreateConversion(profileId);

  const form = useForm<ConversionFormValues>({ resolver: zodResolver(conversionFormSchema), defaultValues: emptyValues() });
  const { control, handleSubmit, setError, formState } = form;
  const fromAmount = useWatch({ control, name: 'fromAmount' });
  const fromCurrency = useWatch({ control, name: 'fromCurrency' });
  const toAmount = useWatch({ control, name: 'toAmount' });
  const toCurrency = useWatch({ control, name: 'toCurrency' });
  const rate = impliedRate(fromAmount, fromCurrency, toAmount, toCurrency);

  const errorLabels = {
    amountInvalid: t('hosted.conversions.errors.amountInvalid'),
    toAmountInvalid: t('hosted.conversions.errors.toAmountInvalid'),
    dateInvalid: t('hosted.conversions.errors.dateInvalid'),
    sameCurrency: t('hosted.conversions.errors.sameCurrency'),
    conflict: t('hosted.conversions.errors.conflict'),
    network: t('hosted.conversions.errors.network'),
  };

  const onSubmit = async (values: ConversionFormValues) => {
    try {
      const body: CreateConversionRequest = {
        occurredOn: values.occurredAt,
        amount: values.fromAmount,
        currency: values.fromCurrency,
        toAmount: values.toAmount,
        toCurrency: values.toCurrency,
        notes: values.notes || undefined,
      };
      await createMutation.mutateAsync(body);
      onClose();
    } catch (error) {
      applyConversionApiError(error, setError, errorLabels, showToast);
    }
  };

  return (
    <Drawer
      title={t('hosted.conversions.drawer.newTitle')}
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        <div className="drawer-footer-right">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="hosted-conversion-form" disabled={createMutation.isPending}>
            {createMutation.isPending ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      }
    >
      <form id="hosted-conversion-form" onSubmit={handleSubmit(onSubmit)}>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label" htmlFor="hosted-conversion-from-amount">
              {t('hosted.conversions.drawer.fromAmount')}
            </label>
            <Controller
              name="fromAmount"
              control={control}
              render={({ field }) => (
                <input
                  id="hosted-conversion-from-amount"
                  type="text"
                  inputMode="decimal"
                  dir="ltr"
                  className="input"
                  placeholder={t('hosted.conversions.drawer.amountPlaceholder')}
                  {...field}
                />
              )}
            />
            {formState.errors.fromAmount && <p className="form-error">{formState.errors.fromAmount.message}</p>}
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="hosted-conversion-from-currency">
              {t('hosted.conversions.drawer.fromCurrency')}
            </label>
            <Controller
              name="fromCurrency"
              control={control}
              render={({ field }) => (
                <select id="hosted-conversion-from-currency" className="input" {...field}>
                  {CURRENCY_OPTIONS.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              )}
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label" htmlFor="hosted-conversion-to-amount">
              {t('hosted.conversions.drawer.toAmount')}
            </label>
            <Controller
              name="toAmount"
              control={control}
              render={({ field }) => (
                <input
                  id="hosted-conversion-to-amount"
                  type="text"
                  inputMode="decimal"
                  dir="ltr"
                  className="input"
                  placeholder={t('hosted.conversions.drawer.amountPlaceholder')}
                  {...field}
                />
              )}
            />
            {formState.errors.toAmount && <p className="form-error">{formState.errors.toAmount.message}</p>}
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="hosted-conversion-to-currency">
              {t('hosted.conversions.drawer.toCurrency')}
            </label>
            <Controller
              name="toCurrency"
              control={control}
              render={({ field }) => (
                <select id="hosted-conversion-to-currency" className="input" {...field}>
                  {CURRENCY_OPTIONS.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              )}
            />
            {formState.errors.toCurrency && <p className="form-error">{formState.errors.toCurrency.message}</p>}
          </div>
        </div>

        {rate !== null && (
          <p className="form-hint">{t('hosted.conversions.drawer.impliedRate', { rate: rate.toFixed(4), from: fromCurrency, to: toCurrency })}</p>
        )}

        <div className="form-group">
          <label className="form-label" htmlFor="hosted-conversion-date">
            {t('hosted.conversions.drawer.date')}
          </label>
          <Controller
            name="occurredAt"
            control={control}
            render={({ field }) => <input id="hosted-conversion-date" type="date" className="input" {...field} />}
          />
          {formState.errors.occurredAt && <p className="form-error">{formState.errors.occurredAt.message}</p>}
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="hosted-conversion-notes">
            {t('hosted.conversions.drawer.notes')}
          </label>
          <Controller
            name="notes"
            control={control}
            render={({ field }) => (
              <textarea id="hosted-conversion-notes" className="input" placeholder={t('hosted.conversions.drawer.notesPlaceholder')} {...field} />
            )}
          />
        </div>
      </form>
    </Drawer>
  );
}
