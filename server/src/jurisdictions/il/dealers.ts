import type { DealerType, IssuedDocType } from '../../issuing/types.js';
import type { DealerRule, JurisdictionPack } from '../pack.js';

/**
 * MUT-743 (moved from the portal's and the phone's hard-coded lists): Israel's business types (LICENSED = עוסק מורשה,
 * EXEMPT = עוסק פטור, COMPANY = חברה, NONPROFIT = עמותה), what each may issue, and what the issue drawer starts with.
 * One table: the dealer rule (`refusal`) is derived from `issues`, so what the clients show and what the server accepts
 * cannot disagree. MUT-662 (comment 13435): an exempt dealer issues receipts and payment requests, not tax documents.
 */
const EVERYTHING: readonly IssuedDocType[] = ['TAX_INVOICE', 'PAYMENT_REQUEST', 'TAX_INVOICE_RECEIPT', 'RECEIPT', 'CREDIT_NOTE'];

const registered = (value: DealerType): DealerRule => ({
  value,
  labelKey: `IL.${value}`,
  issues: EVERYTHING,
  exemptFromVat: false,
  defaultType: 'TAX_INVOICE',
  entryTypes: { owed: ['TAX_INVOICE', 'PAYMENT_REQUEST'], received: ['TAX_INVOICE_RECEIPT', 'RECEIPT'] },
});

export const IL_DEALER_TYPES: readonly DealerRule[] = [
  registered('LICENSED'),
  { value: 'EXEMPT', labelKey: 'IL.EXEMPT', issues: ['RECEIPT', 'PAYMENT_REQUEST'], exemptFromVat: true, defaultType: 'RECEIPT', entryTypes: { owed: ['PAYMENT_REQUEST'], received: ['RECEIPT'] } },
  registered('COMPANY'),
  registered('NONPROFIT'),
];

const BY_VALUE = new Map(IL_DEALER_TYPES.map((d) => [d.value, d]));

export const IL_DEALER: Pick<JurisdictionPack['dealer'], 'types' | 'exemptFromVat' | 'refusal'> = {
  types: IL_DEALER_TYPES,
  exemptFromVat: (dealer) => BY_VALUE.get(dealer)?.exemptFromVat === true,
  refusal: (dealer, docType) =>
    BY_VALUE.get(dealer)?.issues.includes(docType) === false
      ? { reason: 'EXEMPT_DEALER_TAX_INVOICE', message: 'an exempt dealer (עוסק פטור) issues receipts and payment requests, not tax invoices' }
      : null,
};
