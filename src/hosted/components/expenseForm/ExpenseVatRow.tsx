import { useState, type ReactNode } from 'react';
import { Controller, useWatch } from 'react-hook-form';
import { Select } from '../../../components/ui/Input';
import { useLanguage } from '../../../lib/i18n/core';
import { formatDecimal } from '../../format/DecimalAmount';
import { basisPointsToPercent, percentToBasisPoints, vatPreview, VAT_TREATMENTS } from '../../lib/expenseVat';
import { VAT_RATE_INVALID, type HostedExpenseForm } from './useHostedExpenseForm';

/**
 * MUT-302 (ADR-231, DR14): the VAT row on a firm profile's expense form, a collapsed `.form-disclosure` (as the
 * income drawer's details). Closed, it reads "No VAT recorded" or the VAT inside the amount; open, it shows the
 * treatment, the rate for Standard, and net and VAT read-only. The preview is display only: the server splits and
 * stores the figures. Amounts are <bdi> (ADR-101). A rate error opens it, so the message is never hidden.
 */
export interface ExpenseVatRowProps {
  form: HostedExpenseForm['form'];
  idPrefix: string;
  readOnly?: boolean;
  /** A line under the row: the receipt's rate, or the VAT amount it showed without one (MUT-302 D6). */
  hint?: ReactNode;
}

export function ExpenseVatRow({ form, idPrefix, readOnly = false, hint }: ExpenseVatRowProps) {
  const { t, language } = useLanguage();
  const { control, setValue, formState } = form;
  const [treatment, rate, amount, currency] = useWatch({ control, name: ['vatTreatment', 'vatRate', 'amount', 'currency'] });
  const rateError = formState.errors.vatRate?.message;
  const [toggled, setToggled] = useState(false);
  const open = toggled || Boolean(rateError);
  const detailsId = `${idPrefix}-vat-details`;

  const basisPoints = treatment === 'STANDARD_RATED' ? percentToBasisPoints(rate) : null;
  const preview = treatment ? vatPreview(amount, currency, treatment, basisPoints) : null;
  const money = (value: string) => <bdi>{formatDecimal(value, currency, language)}</bdi>;

  const summary = !treatment ? (
    t('hosted.expenses.vat.none')
  ) : treatment === 'STANDARD_RATED' ? (
    <>
      {/* The rate as one clean percent (review: never the raw typed text, "17%%" or "١٧٫٥"). */}
      {t('hosted.expenses.vat.summary', { rate: basisPoints === null ? '—' : basisPointsToPercent(basisPoints) })}
      {preview && <> · {money(preview.vat)}</>}
    </>
  ) : (
    t(`hosted.expenses.vat.treatments.${treatment}`)
  );

  const remove = () => {
    setValue('vatTreatment', '', { shouldDirty: true });
    setValue('vatRate', '', { shouldDirty: true });
  };

  return (
    <div className="form-group hp-expense-vat" data-testid="expense-vat">
      <button type="button" className="form-disclosure" aria-expanded={open} aria-controls={detailsId} onClick={() => setToggled(!open)}>
        <svg className="form-disclosure-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" />
        </svg>
        <span className="form-disclosure-label">{t('hosted.expenses.vat.row')}</span>
        {!open && (
          <span className="form-disclosure-summary" data-testid="expense-vat-summary">
            {summary}
          </span>
        )}
      </button>

      {open && (
        <div id={detailsId}>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label" htmlFor={`${idPrefix}-vat-treatment`}>
                {t('hosted.expenses.vat.treatment')}
              </label>
              <Controller
                name="vatTreatment"
                control={control}
                render={({ field }) => (
                  <Select id={`${idPrefix}-vat-treatment`} value={field.value} onChange={field.onChange} onBlur={field.onBlur} disabled={readOnly}>
                    <option value="">{t('hosted.expenses.vat.noVat')}</option>
                    {VAT_TREATMENTS.map((value) => (
                      <option key={value} value={value}>
                        {t(`hosted.expenses.vat.treatments.${value}`)}
                      </option>
                    ))}
                  </Select>
                )}
              />
            </div>
            {treatment === 'STANDARD_RATED' && (
              <div className="form-group">
                <label className="form-label" htmlFor={`${idPrefix}-vat-rate`}>
                  {t('hosted.expenses.vat.rate')}
                </label>
                <div className="hp-expense-vat-rate">
                  <Controller
                    name="vatRate"
                    control={control}
                    render={({ field }) => (
                      <input
                        id={`${idPrefix}-vat-rate`}
                        type="text"
                        inputMode="decimal"
                        dir="ltr"
                        className={`input${rateError ? ' input-error' : ''}`}
                        aria-invalid={rateError ? true : undefined}
                        aria-describedby={rateError ? `${idPrefix}-vat-rate-error` : undefined}
                        disabled={readOnly}
                        {...field}
                      />
                    )}
                  />
                  <span aria-hidden="true">%</span>
                </div>
                {rateError && (
                  <p className="form-error" id={`${idPrefix}-vat-rate-error`}>
                    {t(rateError === VAT_RATE_INVALID ? 'hosted.expenses.vat.errors.rateInvalid' : 'hosted.expenses.vat.errors.rateRequired')}
                  </p>
                )}
              </div>
            )}
          </div>
          {preview && (
            <dl className="hp-expense-vat-split" data-testid="expense-vat-split">
              <div>
                <dt>{t('hosted.expenses.vat.net')}</dt>
                <dd className="num">{money(preview.net)}</dd>
              </div>
              <div>
                <dt>{t('hosted.expenses.vat.vat')}</dt>
                <dd className="num">{money(preview.vat)}</dd>
              </div>
            </dl>
          )}
          {treatment && !readOnly && (
            <button type="button" className="hp-link-button" onClick={remove}>
              {t('hosted.expenses.vat.remove')}
            </button>
          )}
        </div>
      )}
      {hint && (
        <p className="form-hint" data-hint-for="vat">
          {hint}
        </p>
      )}
    </div>
  );
}
