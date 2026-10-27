import type { ReactNode } from 'react';
import { Controller, useWatch, type Control, type FieldErrors } from 'react-hook-form';
import { cn, currencyExponent } from '../../lib/utils';
import { Select } from '../ui/Input';
import type { Currency } from '../../lib/utils';
import type { ExpenseFormFieldsValues } from './expenseFormSchema';

/**
 * The amount input's step, in the currency's own minor unit (0.01 for a
 * 2-decimal currency, 0.001 for JOD's 3). A hardcoded "0.01" step silently
 * blocks submitting a 3-decimal JOD amount: a step mismatch fails the native
 * HTML5 constraint the browser checks before firing the form's submit event
 * at all, so a user typing a precise fils amount (e.g. "45.678") could never
 * save, with no visible error (found testing LegacyExpenseEditDrawer, MUT-138).
 * Falls back to 2 decimals for an unset/unrecognized currency (initial render).
 */
function amountStep(currency: string): string {
  const exponent = currencyExponent(currency as Currency) ?? 2;
  return (10 ** -exponent).toString();
}

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

/** The fields a host can hint under (MUT-260 A9). Vendor/client/project are the host's own slots, so it hints those itself. */
export type ExpenseFormHintField = 'amount' | 'currency' | 'date' | 'title' | 'category' | 'notes';

export interface ExpenseCategoryOption {
  id: string;
  name: string;
}

/**
 * The shape this component actually needs, generically -- `currency` is
 * widened to `string` here (rather than reusing `ExpenseFormFieldsValues`
 * directly) so that local's ExpenseDrawer can carry a wider currency union
 * (MUT-140: + JOD) than the hosted portal's `expenseFormFieldsSchema`,
 * without touching that schema -- it's the portal's actual runtime
 * validation (`hostedExpenseSchema = expenseFormFieldsSchema.extend(...)`),
 * which has its own 2-decimal-only `DECIMAL_AMOUNT` regex and is out of
 * this ticket's scope.
 */
export type ExpenseFormFieldsShape = Omit<ExpenseFormFieldsValues, 'currency'> & { currency: string };

export interface ExpenseFormFieldsProps<T extends ExpenseFormFieldsShape> {
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
  /** Hosted edit (MUT-272 review): the currency is shown but can't be picked until the portal sends it with the amount (MUT-277). */
  currencyDisabled?: boolean;
  /** False only for local's recurring mode, which swaps the date field for its own frequency/start/end block via `dateSlotOverride`. Hosted always leaves this true — it has no recurring mode. */
  showDate?: boolean;
  /** Rendered in the date field's place when `showDate` is false. */
  dateSlotOverride?: ReactNode;
  /** Hosted (MUT-392): the latest date the server takes, today + ten years in the profile's zone. Local leaves it unset. */
  dateMax?: string;
  /** False only for local's recurring mode, which has no notes field. Hosted always leaves this true. */
  showNotes?: boolean;
  /** True only for local's recurring mode, where title is mandatory (enforced by the host's own schema, not this one). Hosted leaves this false — title is always optional there. */
  titleRequired?: boolean;
  /**
   * MUT-260 (A9): a line under a field, and `data-suggested` on its control: the portal's receipt review marks the
   * fields its suggestion filled ("From the receipt"). Local leaves it unset, and nothing changes there.
   */
  hints?: Partial<Record<ExpenseFormHintField, ReactNode>>;
}

function FieldHint({ field, hints }: { field: ExpenseFormHintField; hints?: Partial<Record<ExpenseFormHintField, ReactNode>> }) {
  const hint = hints?.[field];
  return hint ? (
    <p className="form-hint" data-hint-for={field}>
      {hint}
    </p>
  ) : null;
}

const suggested = (field: ExpenseFormHintField, hints?: Partial<Record<ExpenseFormHintField, ReactNode>>) => (hints?.[field] ? 'true' : undefined);

export function ExpenseFormFields<T extends ExpenseFormFieldsShape>({
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
  currencyDisabled = false,
  showDate = true,
  dateSlotOverride,
  dateMax,
  showNotes = true,
  titleRequired = false,
  hints,
}: ExpenseFormFieldsProps<T>) {
  const currentCurrency = useWatch({ control, name: 'currency' as never }) as unknown as string;

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
                  step={amountStep(currentCurrency)}
                  min="0"
                  className={cn('input', errors.amount && 'input-error')}
                  placeholder={labels.amountPlaceholder}
                  disabled={disabled}
                  data-suggested={suggested('amount', hints)}
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
                  data-suggested={suggested('amount', hints)}
                  {...field}
                />
              )
            }
          />
          {errors.amount && (
            <p className="form-error">{errors.amount.type === 'manual' ? String(errors.amount.message ?? '') : labels.amountError}</p>
          )}
          <FieldHint field="amount" hints={hints} />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="expense-currency">
            {labels.currency} *
          </label>
          <Controller
            name={'currency' as never}
            control={control}
            render={({ field }) => (
              <Select id="expense-currency" disabled={disabled || currencyDisabled} data-suggested={suggested('currency', hints)} {...field}>
                {currencyOptions.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </Select>
            )}
          />
          <FieldHint field="currency" hints={hints} />
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
                max={dateMax}
                data-suggested={suggested('date', hints)}
                {...field}
              />
            )}
          />
          {errors.occurredAt && <p className="form-error">{String(errors.occurredAt.message ?? '')}</p>}
          <FieldHint field="date" hints={hints} />
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
            <input id="expense-title" type="text" className="input" placeholder={labels.titlePlaceholder} disabled={disabled} data-suggested={suggested('title', hints)} {...field} />
          )}
        />
        <FieldHint field="title" hints={hints} />
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
            <Select
              id="expense-category"
              invalid={Boolean(errors.categoryId)}
              disabled={disabled}
              data-suggested={suggested('category', hints)}
              {...field}
            >
              <option value="">{labels.categoryPlaceholder}</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </Select>
          )}
        />
        {errors.categoryId && (
          <p className="form-error">{errors.categoryId.type === 'manual' ? String(errors.categoryId.message ?? '') : labels.requiredError}</p>
        )}
        <FieldHint field="category" hints={hints} />
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
              <textarea id="expense-notes" className="textarea" placeholder={labels.notesPlaceholder} disabled={disabled} data-suggested={suggested('notes', hints)} {...field} />
            )}
          />
          <FieldHint field="notes" hints={hints} />
        </div>
      )}
    </>
  );
}
