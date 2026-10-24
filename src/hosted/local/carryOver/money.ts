import { formatMoney, type Currency } from '../../../../server/src/money.js';

/**
 * Minor units as the API's canonical decimal, exactly, at any size (a bigint never passes through a float). The
 * server's own formatter, so a records file holding a currency the API has since retired (MUT-388) still sums and
 * shows its real amount instead of failing the whole Restore.
 */
export function bigintToDecimal(minor: bigint, currency: string): string {
  return formatMoney({ minor, currency: currency as Currency });
}
