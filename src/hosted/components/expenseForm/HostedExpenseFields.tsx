import type { ReactNode } from 'react';
import { Controller, useWatch } from 'react-hook-form';
import { ExpenseFormFields, type ExpenseFormHintField } from '../../../components/expenses/ExpenseFormFields';
import { useLanguage } from '../../../lib/i18n/core';
import { HOSTED_CURRENCIES } from '../../format/currencies';
import { moneyDateCeiling, todayInZone, todayLocalISO } from '../../format/dates';
import { ClientPicker } from '../ClientPicker';
import { ProjectPicker } from '../ProjectPicker';
import { VendorPicker } from '../VendorPicker';
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
}

export function HostedExpenseFields({ expenseForm, profileId, timezone, canAddClient = false, readOnly = false, currencyDisabled = false, idPrefix = 'hosted-expense', hints, firm = false }: HostedExpenseFieldsProps) {
  const { t } = useLanguage();
  const { form, categories, labels, clientFlash, picks } = expenseForm;
  const { control, formState, getValues, setValue } = form;
  const [selectedClientId, selectedCurrency] = useWatch({ control, name: ['clientId', 'currency'] });
  const { vendor: vendorHint, vat: vatHint, ...fieldHints } = hints ?? {};

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
