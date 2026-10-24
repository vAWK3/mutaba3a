import { parseFreeAppBackupValue, type FreeAppBackup } from '../../freeAppBackup';

/**
 * Builds a free-app backup the way `serializeAllTables` writes one, with only
 * the rows a test names. Rows get the fields the free app always writes
 * (timestamps, ids); a test overrides what it is about.
 */

const STAMP = '2026-03-01T09:00:00.000Z';

export const business = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: `Business ${id}`, defaultCurrency: 'ILS', isDefault: false, createdAt: STAMP, updatedAt: STAMP, ...extra });
export const client = (id: string, profileId: string, extra: Record<string, unknown> = {}) => ({ id, name: `Client ${id}`, profileId, createdAt: STAMP, updatedAt: STAMP, ...extra });
export const project = (id: string, profileId: string, clientId: string | undefined, extra: Record<string, unknown> = {}) => ({ id, name: `Project ${id}`, profileId, ...(clientId ? { clientId } : {}), createdAt: STAMP, updatedAt: STAMP, ...extra });
export const income = (id: string, profileId: string | undefined, extra: Record<string, unknown> = {}) => ({
  id,
  kind: 'income',
  status: 'unpaid',
  amountMinor: 10_000,
  currency: 'ILS',
  occurredAt: '2026-02-10',
  ...(profileId ? { profileId } : {}),
  createdAt: STAMP,
  updatedAt: STAMP,
  ...extra,
});
export const payment = (id: string, transactionId: string, amountMinor: number, paidAt: string, extra: Record<string, unknown> = {}) => ({ id, transactionId, amountMinor, paidAt, createdAt: STAMP, updatedAt: STAMP, ...extra });
export const expense = (id: string, profileId: string, extra: Record<string, unknown> = {}) => ({ id, profileId, amountMinor: 2_500, currency: 'ILS', occurredAt: '2026-02-12', createdAt: STAMP, updatedAt: STAMP, ...extra });
export const conversion = (id: string, profileId: string | undefined, extra: Record<string, unknown> = {}) => ({
  id,
  kind: 'conversion',
  status: 'paid',
  amountMinor: 100_00,
  currency: 'USD',
  toCurrency: 'ILS',
  toAmountMinor: 365_00,
  occurredAt: '2026-02-15',
  ...(profileId ? { profileId } : {}),
  createdAt: STAMP,
  updatedAt: STAMP,
  ...extra,
});

export function freeAppBackup(tables: Record<string, unknown[]>, version = 24): FreeAppBackup {
  return parseFreeAppBackupValue({ version, timestamp: STAMP, tables });
}
