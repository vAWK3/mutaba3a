import type { ReactNode } from 'react';
import { useLanguage } from '../../../lib/i18n/core';
import { ALLOCATION_NUMBER_INVALID, type HostedExpenseForm } from './useHostedExpenseForm';

/**
 * MUT-557 (ADR-246): the Israeli allocation number (מספר הקצאה) of a supplier's tax invoice, under the VAT row on a
 * firm profile's ILS expense. Digits are left to right in either language (<bdi>, ADR-101). `needed` marks it when the
 * receipt reads as an invoice above the threshold and no number was read (the server's `allocationNumberExpected`).
 */
export interface ExpenseAllocationNumberRowProps {
  form: HostedExpenseForm['form'];
  idPrefix: string;
  readOnly?: boolean;
  /** A line under the field: what the receipt read. */
  hint?: ReactNode;
  needed?: boolean;
}

export function ExpenseAllocationNumberRow({ form, idPrefix, readOnly = false, hint, needed = false }: ExpenseAllocationNumberRowProps) {
  const { t } = useLanguage();
  const { register, formState } = form;
  const id = `${idPrefix}-allocation-number`;
  const error = formState.errors.allocationNumber?.message;
  return (
    <div className="form-group" data-testid="expense-allocation-number" data-needed={needed ? 'true' : undefined}>
      <label className="form-label" htmlFor={id}>
        {t('hosted.expenses.allocation.label')}
      </label>
      <input
        id={id}
        className="form-input"
        dir="ltr"
        inputMode="numeric"
        autoComplete="off"
        placeholder={t('hosted.expenses.allocation.placeholder')}
        readOnly={readOnly}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-note`}
        {...register('allocationNumber')}
      />
      {error ? (
        <p className="form-error" id={`${id}-note`}>
          {error === ALLOCATION_NUMBER_INVALID ? t('hosted.expenses.allocation.invalid') : error}
        </p>
      ) : needed ? (
        <p className="form-hint" id={`${id}-note`} data-hint-for="allocationNumber">
          {t('hosted.expenses.allocation.needed')}
        </p>
      ) : hint ? (
        <p className="form-hint" id={`${id}-note`} data-hint-for="allocationNumber">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
