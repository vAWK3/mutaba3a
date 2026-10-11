import type { BusinessProfile, Currency, PaymentRecord, Settings, Transaction } from '../types';
import type { IncomeStatus } from './stores';
import { DEFAULT_SETTINGS } from '../db/defaultSettings';

/**
 * Pure rules behind the income drawer (MUT-5): what a save writes, when
 * "More details" opens on an existing entry, and which currency a new entry
 * starts in. Kept out of the component so they are tested without React.
 */

export interface IncomeEntryValues {
  incomeStatus: IncomeStatus;
  profileId: string;
  amountMinor: number;
  currency: Currency;
  /** Calendar date, YYYY-MM-DD */
  occurredAt: string;
  clientId?: string;
  projectId?: string;
  dueDate?: string;
  title?: string;
  notes?: string;
}

export interface IncomeUpdateOptions {
  /** ISO instant used as the payment date when an entry becomes paid */
  now: string;
  /** The stored entry being edited */
  existing: Pick<Transaction, 'status' | 'paidAt'>;
  /**
   * The entry has live payment records. They own status, paidAt and
   * receivedAmountMinor (ADR-030), so the drawer never writes those.
   */
  hasRecords: boolean;
}

export type IncomeWrite = Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>;
type EntryFields = Omit<IncomeWrite, 'status' | 'paidAt' | 'receivedAmountMinor'>;

function entryFields(values: IncomeEntryValues): EntryFields {
  const isReceived = values.incomeStatus === 'received';
  return {
    kind: 'income',
    profileId: values.profileId,
    title: values.title || undefined,
    clientId: values.clientId || undefined,
    projectId: values.projectId || undefined,
    amountMinor: values.amountMinor,
    currency: values.currency,
    occurredAt: new Date(values.occurredAt).toISOString(),
    dueDate: !isReceived && values.dueDate ? values.dueDate : undefined,
    notes: values.notes || undefined,
  };
}

/** The write for a new entry. Received means paid now, in full. */
export function buildIncomeCreate(values: IncomeEntryValues, now: string): IncomeWrite {
  if (values.incomeStatus !== 'received') {
    return { ...entryFields(values), status: 'unpaid' };
  }
  return { ...entryFields(values), status: 'paid', paidAt: now, receivedAmountMinor: values.amountMinor };
}

/**
 * The write for an edit.
 *
 * Payment fields the save should leave alone are **absent** from the result,
 * never `undefined`: Dexie deletes a key whose value is `undefined`, which is
 * how editing used to wipe the received amount and reset the payment date.
 */
export function buildIncomeUpdate(values: IncomeEntryValues, options: IncomeUpdateOptions): Partial<IncomeWrite> {
  const fields = entryFields(values);
  // Payment state is derived from the records; leave all three untouched.
  if (options.hasRecords) return fields;

  const { existing, now } = options;
  const wasPaid = existing.status === 'paid';
  if (values.incomeStatus === 'received') {
    return {
      ...fields,
      status: 'paid',
      paidAt: wasPaid && existing.paidAt ? existing.paidAt : now,
      receivedAmountMinor: values.amountMinor,
    };
  }
  if (wasPaid) {
    // Moving back to unpaid: clear the payment the entry used to claim.
    return { ...fields, status: 'unpaid', paidAt: undefined, receivedAmountMinor: undefined };
  }
  return { ...fields, status: 'unpaid' };
}

/** True when an edit would cut the amount below what has already been recorded as paid. */
export function isBelowRecordedTotal(
  amountMinor: number,
  records: ReadonlyArray<Pick<PaymentRecord, 'amountMinor'>>
): boolean {
  return amountMinor < recordedTotalMinor(records);
}

export function recordedTotalMinor(records: ReadonlyArray<Pick<PaymentRecord, 'amountMinor'>>): number {
  return records.reduce((sum, record) => sum + record.amountMinor, 0);
}

/**
 * Whether "More details" opens when an existing entry is edited: only when it
 * holds something the collapsed view would hide. Date, currency and profile
 * are always shown in the defaults line, so they count only when unusual.
 */
export function shouldExpandDetails(
  entry: Pick<Transaction, 'currency'> & Partial<Pick<Transaction, 'dueDate' | 'projectId' | 'notes' | 'profileId'>>,
  profileDefaultCurrency: Currency
): boolean {
  return Boolean(
    entry.dueDate ||
      entry.projectId ||
      entry.notes ||
      !entry.profileId ||
      entry.currency !== profileDefaultCurrency
  );
}

/** A new entry's currency: the profile's default, then the app setting, then the built-in default. */
export function resolveDefaultCurrency(
  profile?: Pick<BusinessProfile, 'defaultCurrency'>,
  settings?: Pick<Settings, 'defaultCurrency'>
): Currency {
  return profile?.defaultCurrency ?? settings?.defaultCurrency ?? DEFAULT_SETTINGS.defaultCurrency;
}
