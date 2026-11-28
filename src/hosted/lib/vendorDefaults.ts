import type { components } from '../api/schema';
import type { HostedExpenseFormValues } from '../components/expenseForm/useHostedExpenseForm';
import { HOSTED_CURRENCIES } from '../format/currencies';
import { basisPointsToPercent } from './expenseVat';

/** MUT-303: a vendor's last currency and VAT, from the typeahead pick or a receipt's `vendorDefaults`. */
export interface VendorDefaults {
  currency: components['schemas']['Currency'] | null;
  vat: components['schemas']['VendorVat'] | null;
  /** MUT-775: the vendor's last category on this profile (a registration-no. match only; the server decides). */
  categoryId?: string | null;
}

type Fills = Partial<Pick<HostedExpenseFormValues, 'currency' | 'vatTreatment' | 'vatRate' | 'categoryId'>>;

/**
 * MUT-303 (plan §3, R4–R6, R10): the form values a vendor's defaults fill. Pure. A field fills only when it is
 * neither read from the receipt nor changed by the person (`locked`), and: the currency only while no amount is typed
 * (a typed or read amount stays in its own currency); the VAT only on a firm profile, into a row that records none.
 * Callers set the returned values without marking them dirty, so a later receipt reading may still replace them.
 */
export function vendorDefaultFills(
  defaults: VendorDefaults | null | undefined,
  form: Pick<HostedExpenseFormValues, 'currency' | 'amount' | 'vatTreatment'> & Partial<Pick<HostedExpenseFormValues, 'categoryId'>>,
  locked: { currency: boolean; vat: boolean; category?: boolean },
  firm: boolean,
): Fills {
  const fills: Fills = {};
  if (!defaults) return fills;
  // MUT-775 (D4): the vendor's last category fills only an empty category nobody touched.
  if (defaults.categoryId && !locked.category && (form.categoryId ?? '') === '') fills.categoryId = defaults.categoryId;
  const currency = HOSTED_CURRENCIES.find((c) => c === defaults.currency);
  if (currency && currency !== form.currency && !locked.currency && form.amount === '') fills.currency = currency;
  if (firm && defaults.vat && !locked.vat && form.vatTreatment === '') {
    fills.vatTreatment = defaults.vat.treatment;
    fills.vatRate = defaults.vat.treatment === 'STANDARD_RATED' ? basisPointsToPercent(defaults.vat.rateBasisPoints) : '';
  }
  return fills;
}
