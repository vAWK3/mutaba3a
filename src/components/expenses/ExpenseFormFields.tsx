import type { ReactNode } from 'react';
import { Controller, type Control, type FieldErrors } from 'react-hook-form';
import { cn } from '../../lib/utils';
import type { ExpenseFormFieldsValues } from './expenseFormSchema';

/**
 * Presentational fields shared between the local ExpenseDrawer and the hosted
 * portal's expense drawer (MUT-44 design brief §3, §6a point 1). Field order
 * mirrors the local drawer's one-time-expense block minus the fields that
 * don't apply to both hosts (profile selector, type selector, recurring).
 *
 * No `useT()` here on purpose: the hosted portal keeps its own i18n
 * dictionaries, separate from the app's (ADR-037 MUT-43 amendment), so a
 * shared component resolving app-only keys like `drawer.expense.amount`
 * would silently fail to translate under the portal's provider. Each host
 * resolves its own strings and passes them in.
 *
 * Vendor/client/project are slots, not fields: local's pickers are
 * Dexie-backed and create-capable, the portal's are read-only directory
 * lookups with no server-side vendor concept at all. Amount's input type
 * is also host-specific (`amountInputMode`) — local keeps its existing
 * `type="number"` untouched; the portal uses a `dir="ltr"` text input
 * because its lint bans `Number()`/`parseFloat` outright and amounts travel
 * as canonical decimal strings.
 */
export interface ExpenseFormFieldsLabels {
  amount: string;
  amountPlaceholder: string;
  currency: string;
  date: string;
  title: string;
  titlePlaceholder: string;
  category: string;
  categoryPlaceholder: string;
  notes: string;
  notesPlaceholder: string;
  requiredError: string;
  amountError: string;
}

export interface ExpenseCategoryOption {
  id: string;
  name: string;
}

export interface ExpenseFormFieldsProps<T extends ExpenseFormFieldsValues> {
  control: Control<T>;
  errors: FieldErrors<T>;
  categories: ExpenseCategoryOption[];
  currencyOptions: readonly string[];
  amountInputMode: 'number' | 'decimalText';
  labels: ExpenseFormFieldsLabels;
  vendorField: ReactNode;
  clientField: ReactNode;
  projectField?: ReactNode;
  disabled?: boolean;
  /** False only for local's recurring mode, which swaps the date field for its own frequency/start/end block via `dateSlotOverride`. Hosted always leaves this true — it has no recurring mode. */
  showDate?: boolean;
  /** Rendered in the date field's place when `showDate` is false. */
  dateSlotOverride?: ReactNode;
  /** False only for local's recurring mode, which has no notes field. Hosted always leaves this true. */
  showNotes?: boolean;
  /** True only for local's recurring mode, where title is mandatory (enforced by the host's own schema, not this one). Hosted leaves this false — title is always optional there. */
  titleRequired?: boolean;
}

export function ExpenseFormFields<T extends ExpenseFormFieldsValues>({
  control,
  errors,
  categories,
  currencyOptions,
  amountInputMode,
  labels,
  vendorField,
  clientField,
  projectField,
  disabled,
  showDate = true,
  dateSlotOverride,
  showNotes = true,
  titleRequired = false,
}: ExpenseFormFieldsProps<T>) {
  return (
    <>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label" htmlFor="expense-amount">
            {labels.amount} *
          </label>
          <Controller
            name={'amount' as never}
            control={control}
            render={({ field }) =>
              amountInputMode === 'number' ? (
                <input
                  id="expense-amount"
                  type="number"
                  step="0.01"
                  min="0"
                  className={cn('input', errors.amount && 'input-error')}
                  placeholder={labels.amountPlaceholder}
                  disabled={disabled}
                  {...field}
                />
              ) : (
                <input
                  id="expense-amount"
                  type="text"
                  inputMode="decimal"
                  dir="ltr"
                  className={cn('input', errors.amount && 'input-error')}
                  placeholder={labels.amountPlaceholder}
                  disabled={disabled}
                  {...field}
                />
              )
            }
          />
          {errors.amount && <p className="form-error">{labels.amountError}</p>}
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="expense-currency">
            {labels.currency} *
          </label>
          <Controller
            name={'currency' as never}
            control={control}
            render={({ field }) => (
              <select id="expense-currency" className="select" style={{ width: '100%' }} disabled={disabled} {...field}>
                {currencyOptions.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            )}
          />
        </div>
      </div>

      {showDate ? (
        <div className="form-group">
          <label className="form-label" htmlFor="expense-date">
            {labels.date} *
          </label>
          <Controller
            name={'occurredAt' as never}
            control={control}
            render={({ field }) => (
              <input
                id="expense-date"
                type="date"
                className={cn('input', errors.occurredAt && 'input-error')}
                disabled={disabled}
                {...field}
              />
            )}
          />
        </div>
      ) : (
        dateSlotOverride
      )}

      <div className="form-group">
        <label className="form-label" htmlFor="expense-title">
          {labels.title}
          {titleRequired ? ' *' : ''}
        </label>
        <Controller
          name={'title' as never}
          control={control}
          render={({ field }) => (
            <input id="expense-title" type="text" className="input" placeholder={labels.titlePlaceholder} disabled={disabled} {...field} />
          )}
        />
      </div>

      <div className="form-group">{vendorField}</div>
      <div className="form-group">{clientField}</div>
      {projectField && <div className="form-group">{projectField}</div>}

      <div className="form-group">
        <label className="form-label" htmlFor="expense-category">
          {labels.category} *
        </label>
        <Controller
          name={'categoryId' as never}
          control={control}
          render={({ field }) => (
            <select
              id="expense-category"
              className={cn('select', errors.categoryId && 'input-error')}
              style={{ width: '100%' }}
              disabled={disabled}
              {...field}
            >
              <option value="">{labels.categoryPlaceholder}</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          )}
        />
        {errors.categoryId && <p className="form-error">{labels.requiredError}</p>}
      </div>

      {showNotes && (
        <div className="form-group">
          <label className="form-label" htmlFor="expense-notes">
            {labels.notes}
          </label>
          <Controller
            name={'notes' as never}
            control={control}
            render={({ field }) => (
              <textarea id="expense-notes" className="textarea" placeholder={labels.notesPlaceholder} disabled={disabled} {...field} />
            )}
          />
        </div>
      )}
    </>
  );
}
