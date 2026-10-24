import { useEffect, useRef } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '../../components/ui/Button';
import { useLanguage } from '../../lib/i18n/core';
import { conversionKey, useConversion, useCreateConversion, useDeleteConversion, useUpdateConversion } from '../data/conversionQueries';
import { useSavedFlashStore } from '../../lib/savedFlashStore';
import { useToast } from './Toast';
import { Drawer, ReadOnlyFields } from './Drawer';
import { Empty, Unreachable } from './QueryView';
import { applyConversionApiError } from './conversionApiErrors';
import { conversionFormSchema, impliedRate, type ConversionFormValues } from './conversionFormSchema';
import { HOSTED_CURRENCIES } from '../format/currencies';
import { formatDecimal } from '../format/DecimalAmount';
import { todayInZone, todayLocalISO } from '../format/dates';
import { useAttemptKey } from '../data/attemptKey';
import { ApiError, type Conversion, type CreateConversionRequest, type UpdateConversionRequest } from '../api/client';
import { BrandLoader } from '../../components/brand/BrandLoader';

/**
 * The hosted portal's conversion drawer (MUT-161): log a conversion, and since
 * MUT-194 (ADR-075, design D6/D7) edit or delete one, mirroring ExpenseDrawer.
 * Two amount/currency pairs instead of one, so it doesn't reuse
 * ExpenseFormFields; built standalone like the local app's own
 * ConversionDrawer, with no client/project linking (out of scope).
 */
function emptyValues(timezone?: string): ConversionFormValues {
  // MUT-133 D5: the profile's calendar day when the list passes its zone (R3).
  return { fromAmount: '', fromCurrency: 'USD', toAmount: '', toCurrency: 'ILS', occurredAt: timezone ? todayInZone(timezone) : todayLocalISO(), notes: '' };
}

function valuesOf(c: Conversion): ConversionFormValues {
  return { fromAmount: c.amount, fromCurrency: c.currency, toAmount: c.toAmount, toCurrency: c.toCurrency, occurredAt: c.occurredOn, notes: c.notes ?? '' };
}

export interface ConversionDrawerProps {
  profileId: string;
  /** Default `create`. `edit` loads `conversionId` and offers Delete (MUT-194). */
  mode?: 'create' | 'edit';
  conversionId?: string;
  onClose: () => void;
  /** The profile's IANA zone, for the default date (MUT-133 D5); the browser calendar when absent. */
  timezone?: string;
  /** Called instead of `onClose` after a delete, so the list can drop an anchor on the deleted record (MUT-91). */
  onDeleted?: (conversionId: string) => void;
  /** MUT-361: the profile is read-only (lapse gate): the conversion opens to be read, with nothing to save or delete. */
  readOnly?: boolean;
}

export function ConversionDrawer({ profileId, mode = 'create', conversionId, onClose, timezone, onDeleted, readOnly = false }: ConversionDrawerProps) {
  const { t, language } = useLanguage();
  const showToast = useToast();
  const queryClient = useQueryClient();
  const createMutation = useCreateConversion(profileId);
  const updateMutation = useUpdateConversion(profileId);
  const deleteMutation = useDeleteConversion(profileId);
  const attempt = useAttemptKey();
  const editing = mode === 'edit';
  const loaded = useConversion(profileId, editing ? (conversionId ?? '') : '');
  const existing = editing ? loaded.data : undefined;
  // After-save feedback (MUT-91, eng review D7), from the drawer as for expenses. Delete marks nothing.
  const markSaved = (id: string) => useSavedFlashStore.getState().markSaved({ kind: 'conversion', ids: [id], profileId });

  const form = useForm<ConversionFormValues>({ resolver: zodResolver(conversionFormSchema), defaultValues: emptyValues(timezone) });
  const { control, handleSubmit, reset, setError, formState } = form;

  // D6: (re)fill the form when a genuinely new version arrives — the first load, or the refetch after a 409.
  // Keyed on id and version, not the object, so a background refetch of the same version never wipes typing.
  const latest = useRef(existing);
  useEffect(() => {
    latest.current = existing;
  });
  const existingId = existing?.id;
  const existingVersion = existing?.version;
  useEffect(() => {
    if (latest.current) reset(valuesOf(latest.current));
  }, [existingId, existingVersion, reset]);
  const fromAmount = useWatch({ control, name: 'fromAmount' });
  const fromCurrency = useWatch({ control, name: 'fromCurrency' });
  const toAmount = useWatch({ control, name: 'toAmount' });
  const toCurrency = useWatch({ control, name: 'toCurrency' });
  const rate = impliedRate(fromAmount, fromCurrency, toAmount, toCurrency);

  const errorLabels = {
    amountInvalid: t('hosted.conversions.errors.amountInvalid'),
    toAmountInvalid: t('hosted.conversions.errors.toAmountInvalid'),
    dateInvalid: t('hosted.conversions.errors.dateInvalid'),
    dateTooOld: t('hosted.conversions.errors.dateTooOld'),
    sameCurrency: t('hosted.conversions.errors.sameCurrency'),
    conflict: t('hosted.conversions.errors.conflict'),
    network: t('hosted.conversions.errors.network'),
    lapsed: t('hosted.billing.gate.refused'),
  };

  /**
   * create ─▶ POST (attempt-scoped Idempotency-Key) ─▶ markSaved ─▶ close
   * edit ───▶ PATCH both legs + date + notes at the loaded version (If-Match) ─▶ markSaved ─▶ close
   *             └─ 409 ─▶ refetch this conversion ─▶ the reset effect refills it ─▶ conflict toast, drawer stays open (D6)
   */
  const onSubmit = async (values: ConversionFormValues) => {
    try {
      if (editing && existing) {
        // Both legs always travel as pairs (a currency without its amount is a 422); null clears the notes.
        const body: UpdateConversionRequest = {
          occurredOn: values.occurredAt,
          amount: values.fromAmount,
          currency: values.fromCurrency,
          toAmount: values.toAmount,
          toCurrency: values.toCurrency,
          notes: values.notes || null,
        };
        await updateMutation.mutateAsync({ conversionId: existing.id, body, version: String(existing.version) });
        markSaved(existing.id);
      } else {
        const body: CreateConversionRequest = {
          occurredOn: values.occurredAt,
          amount: values.fromAmount,
          currency: values.fromCurrency,
          toAmount: values.toAmount,
          toCurrency: values.toCurrency,
          notes: values.notes || undefined,
        };
        const created = await createMutation.mutateAsync({ body, idempotencyKey: attempt.keyFor(body) });
        attempt.succeeded();
        markSaved(created.id);
      }
      onClose();
    } catch (error) {
      if (existing && error instanceof ApiError && error.code === 'CONFLICT') void queryClient.invalidateQueries({ queryKey: conversionKey(profileId, existing.id) });
      applyConversionApiError(error, setError, errorLabels, showToast);
    }
  };

  const handleDelete = async () => {
    if (!existing) return;
    // D7: name both legs, formatted as the list shows them (DecimalAmount's formatter), and say it is permanent.
    const from = formatDecimal(existing.amount, existing.currency, language);
    const to = formatDecimal(existing.toAmount, existing.toCurrency, language);
    if (!confirm(t('hosted.conversions.drawer.deleteConfirm', { from, to }))) return;
    try {
      await deleteMutation.mutateAsync(existing.id);
      if (onDeleted) onDeleted(existing.id);
      else onClose();
    } catch (error) {
      applyConversionApiError(error, setError, errorLabels, showToast);
    }
  };

  if (editing && loaded.isError) {
    // A 404 is a conversion deleted elsewhere (or a stale link): say so calmly; a retry can't bring it back.
    // Not QueryView, which reads any 404 as a lost profile and re-asks /v1/me (TD-123).
    const gone = loaded.error instanceof ApiError && (loaded.error.status === 404 || loaded.error.code === 'NOT_FOUND');
    return (
      <Drawer
        title={t('hosted.conversions.drawer.editTitle')}
        onClose={onClose}
        closeLabel={t('common.close')}
        footer={
          gone ? (
            <div className="drawer-footer-right">
              <Button type="button" variant="secondary" onClick={onClose}>
                {t('common.close')}
              </Button>
            </div>
          ) : undefined
        }
      >
        {gone ? <Empty title={t('hosted.conversions.drawer.gone')} /> : <Unreachable onRetry={() => void loaded.refetch()} />}
      </Drawer>
    );
  }

  if (editing && !existing) {
    return (
      <Drawer title={t('common.loading')} onClose={onClose} closeLabel={t('common.close')}>
        <div className="loading loading--section">
          <BrandLoader size={40} />
        </div>
      </Drawer>
    );
  }

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  return (
    <Drawer
      title={editing ? t('hosted.conversions.drawer.editTitle') : t('hosted.conversions.drawer.newTitle')}
      onClose={onClose}
      closeLabel={t('common.close')}
      readOnly={readOnly}
      footer={
        <>
          <div className="drawer-footer-left">
            {editing && (
              <Button type="button" variant="danger" onClick={handleDelete} disabled={deleteMutation.isPending}>
                {t('common.delete')}
              </Button>
            )}
          </div>
          <div className="drawer-footer-right">
            <Button type="button" variant="secondary" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="hosted-conversion-form" disabled={isSubmitting}>
              {isSubmitting ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </>
      }
    >
      <ReadOnlyFields readOnly={readOnly}>
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
                    {HOSTED_CURRENCIES.map((code) => (
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
                    {HOSTED_CURRENCIES.map((code) => (
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
      </ReadOnlyFields>
    </Drawer>
  );
}
