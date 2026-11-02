import { useState, type ReactNode } from 'react';
import { Controller, useWatch } from 'react-hook-form';
import { ExpenseFormFields, type ExpenseFormHintField } from '../../../components/expenses/ExpenseFormFields';
import { useLanguage } from '../../../lib/i18n/core';
import { HOSTED_CURRENCIES } from '../../format/currencies';
import { moneyDateCeiling, todayInZone, todayLocalISO } from '../../format/dates';
import { ClientPicker } from '../ClientPicker';
import { ProjectPicker } from '../ProjectPicker';
import { VendorPicker } from '../VendorPicker';
import { vendorDefaultFills } from '../../lib/vendorDefaults';
import { ExpenseVatRow } from './ExpenseVatRow';
import type { HostedExpenseForm } from './useHostedExpenseForm';

/**
 * The hosted expense form's fields (MUT-260 D6, A9): `components/expenses/ExpenseFormFields` with the portal's vendor
 * typeahead (MUT-254), client and matter pickers in its slots. Extracted from ExpenseDrawer unchanged; the caller
 * owns the `<form>`, so the drawer and the receipt review page each keep their own submit and footer. `idPrefix`
 * names the pickers' ids (the drawer's stay `hosted-expense-*`).
 */
export type HostedExpenseHintField = ExpenseFormHintField | 'vendor' | 'vat';

export interface HostedExpenseFieldsProps {
  expenseForm: HostedExpenseForm;
  profileId: string;
  timezone?: string;
  /** The client and matter fields offer Add «name» (`canAddClient(profile)`, MUT-286/318). */
  canAddClient?: boolean;
  readOnly?: boolean;
  /** Hosted edit (MUT-272): the currency shows but can't be picked. */
  currencyDisabled?: boolean;
  idPrefix?: string;
  /** MUT-260: lines under the fields a receipt's suggestion filled. */
  hints?: Partial<Record<HostedExpenseHintField, ReactNode>>;
  /** MUT-302 (AC3): the VAT row shows on a firm profile only (`profile.firm`, never the profile type). */
  firm?: boolean;
  /**
   * MUT-303 (R4): a picked vendor also fills its last currency and VAT. On for a new expense and a receipt review; off
   * in the edit drawer, where a pick must never change saved money. `readFields` are what the receipt read, never
   * replaced.
   */
  prefillDefaults?: boolean;
  readFields?: { currency?: boolean; vat?: boolean };
  /**
   * MUT-303 (review): what a vendor filled, when the caller keeps it (Receipt Review, where a later reading may replace
   * a vendor's value and the hints live). Without it the fields keep their own record.
   */
  vendorFilled?: VendorFilled;
  onVendorFill?: (fills: VendorFilled) => void;
}

/** MUT-303: the values a vendor's defaults put in the form, so they can be said and later replaced. */
export type VendorFilled = { currency?: string; vatTreatment?: string };

export function HostedExpenseFields({ expenseForm, profileId, timezone, canAddClient = false, readOnly = false, currencyDisabled = false, idPrefix = 'hosted-expense', hints, firm = false, prefillDefaults = false, readFields, vendorFilled: keptFilled, onVendorFill }: HostedExpenseFieldsProps) {
  const { t } = useLanguage();
  const { form, categories, labels, clientFlash, picks } = expenseForm;
  const { control, formState, getValues, setValue, getFieldState } = form;
  const [selectedClientId, selectedCurrency, selectedVat] = useWatch({ control, name: ['clientId', 'currency', 'vatTreatment'] });
  // MUT-303: what a picked vendor filled, for the "from this vendor" line while the field still holds it.
  const [ownFilled, setOwnFilled] = useState<VendorFilled>({});
  const vendorFilled = keptFilled ?? ownFilled;
  const recordFill = (fills: VendorFilled) => (onVendorFill ? onVendorFill(fills) : setOwnFilled((prev) => ({ ...prev, ...fills })));
  const fromVendor = t('hosted.expenses.hints.fromVendor');
  const { vendor: vendorHint, vat: vatHint = vendorFilled.vatTreatment && vendorFilled.vatTreatment === selectedVat ? fromVendor : undefined, ...fieldHints } = hints ?? {};
  if (!fieldHints.currency && vendorFilled.currency && vendorFilled.currency === selectedCurrency) fieldHints.currency = fromVendor;
  const changed = (name: 'currency' | 'vatTreatment' | 'vatRate') => {
    const state = getFieldState(name);
    return state.isDirty || state.isTouched;
  };

  return (
    <>
      <ExpenseFormFields
        control={control}
        dateMax={moneyDateCeiling(timezone ? todayInZone(timezone) : todayLocalISO())}
        errors={formState.errors}
        categories={categories ?? []}
        currencyOptions={HOSTED_CURRENCIES}
        currencyDisabled={currencyDisabled}
        amountInputMode="decimalText"
        labels={labels}
        hints={fieldHints}
        vendorField={
          <>
            <label className="form-label" htmlFor={`${idPrefix}-vendor`}>
              {t('hosted.expenses.drawer.vendor')}
            </label>
            <div data-suggested={vendorHint ? 'true' : undefined}>
              <Controller
                name="vendor"
                control={control}
                render={({ field }) => (
                  <VendorPicker
                    id={`${idPrefix}-vendor`}
                    profileId={profileId}
                    value={field.value ?? ''}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    onPick={(vendor) => {
                      // The vendor's last category, only into an empty field and never an archived one (MUT-254).
                      const category = categories?.find((c) => c.id === vendor.lastCategoryId);
                      if (!getValues('categoryId') && category && !category.archived) setValue('categoryId', category.id, { shouldDirty: true });
                      if (!prefillDefaults) return;
                      // MUT-303: its last currency and VAT, only into fields nothing read or changed (not dirtied, so a
                      // later receipt reading may still replace them).
                      // A VAT the last picked vendor filled is this pick's to replace (review #9), as on the phone.
                      const values = getValues();
                      const vendorsVat = vendorFilled.vatTreatment !== undefined && values.vatTreatment === vendorFilled.vatTreatment;
                      const fills = vendorDefaultFills(
                        { currency: vendor.lastCurrency, vat: vendor.lastVat },
                        { ...values, vatTreatment: vendorsVat ? '' : values.vatTreatment },
                        { currency: !!readFields?.currency || changed('currency'), vat: !!readFields?.vat || changed('vatTreatment') || changed('vatRate') },
                        firm,
                      );
                      if (fills.currency) setValue('currency', fills.currency);
                      if (fills.vatTreatment) {
                        setValue('vatTreatment', fills.vatTreatment);
                        setValue('vatRate', fills.vatRate ?? '');
                      }
                      if (fills.currency || fills.vatTreatment) recordFill(fills);
                    }}
                    placeholder={t('hosted.expenses.drawer.vendorPlaceholder')}
                    disabled={readOnly}
                  />
                )}
              />
            </div>
            {vendorHint && (
              <p className="form-hint" data-hint-for="vendor">
                {vendorHint}
              </p>
            )}
          </>
        }
        clientField={
          <>
            <label className="form-label" htmlFor={`${idPrefix}-client`}>
              {t('hosted.expenses.drawer.client')}
            </label>
            <Controller
              name="clientId"
              control={control}
              render={({ field }) => (
                <ClientPicker
                  id={`${idPrefix}-client`}
                  profileId={profileId}
                  value={field.value || ''}
                  onChange={field.onChange}
                  placeholder={t('hosted.expenses.drawer.clientPlaceholder')}
                  canCreate={canAddClient}
                  flashSignal={clientFlash}
                  onCreatingChange={picks.track}
                />
              )}
            />
            {formState.errors.clientId && <p className="form-error">{formState.errors.clientId.message}</p>}
          </>
        }
        projectField={
          <>
            <label className="form-label" htmlFor={`${idPrefix}-matter`}>
              {t('hosted.expenses.drawer.matter')}
            </label>
            <Controller
              name="projectId"
              control={control}
              render={({ field }) => (
                <ProjectPicker
                  id={`${idPrefix}-matter`}
                  profileId={profileId}
                  customerId={selectedClientId || undefined}
                  value={field.value || ''}
                  onChange={field.onChange}
                  placeholder={t('hosted.expenses.drawer.matterPlaceholder')}
                  canCreate={canAddClient}
                  currency={selectedCurrency}
                  onCreatingChange={picks.track}
                />
              )}
            />
            {formState.errors.projectId && <p className="form-error">{formState.errors.projectId.message}</p>}
          </>
        }
      />
      {firm && <ExpenseVatRow form={form} idPrefix={idPrefix} readOnly={readOnly} hint={vatHint} />}
    </>
  );
}
