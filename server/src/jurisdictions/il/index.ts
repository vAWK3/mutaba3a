import type { DealerType, IssuedDocType } from '../../issuing/types.js';
import type { JurisdictionPack } from '../pack.js';
import { aboveAllocationThreshold, allocationNumberRequired, normalizeAllocationNumber } from './allocation-number.js';
import { IL_DOCUMENT_TYPES } from './documents.js';
import { allocationInvoiceId, allocator, approvalRequest, DEFAULT_MANUAL_ALLOCATION_URL, manualAllocator, needsAllocation, statusOf } from './tax-authority/service.js';
import { IL_STATUTORY_FILE } from './uniform-file/statutory-file.js';
import { normalizeTaxId } from './tax-id.js';
import { standardVatRateOn } from './vat.js';

/** The seven years the Tax Authority's rules keep a document (ADR-277, amended 2026-11-25). */
const IL_RETENTION_YEARS = 7;

/** MUT-662 (comment 13435): an exempt dealer may issue receipts and payment requests, not tax documents. */
function exemptDealerRefusal(dealer: DealerType, docType: IssuedDocType) {
  if (dealer === 'EXEMPT' && docType !== 'RECEIPT' && docType !== 'PAYMENT_REQUEST') {
    return { reason: 'EXEMPT_DEALER_TAX_INVOICE', message: 'an exempt dealer (עוסק פטור) issues receipts and payment requests, not tax invoices' };
  }
  return null;
}

/** MUT-741 (ADR-287): the Israel pack, the only one. Version 1.0.0 is the rules as they were when they moved out of the core. */
export const IL_PACK: JurisdictionPack = {
  country: 'IL',
  version: '1.0.0',
  timezone: 'Asia/Jerusalem',
  currency: { base: 'ILS', issuing: ['ILS'], issuingLabel: 'shekels (ILS)' },
  taxId: { normalize: normalizeTaxId, scheme: 'IL_TAX_ID' },
  documentTypes: IL_DOCUMENT_TYPES,
  dealer: { exemptFromVat: (dealer) => dealer === 'EXEMPT', refusal: exemptDealerRefusal },
  vat: { rateOn: standardVatRateOn },
  retention: { years: IL_RETENTION_YEARS },
  expense: { allocationNumberRequired, aboveAllocationThreshold, normalizeAllocationNumber },
  clearance: { needsAllocation, allocationInvoiceId, approvalRequest, allocator, manualAllocator, DEFAULT_MANUAL_ALLOCATION_URL, statusOf },
  statutoryFile: IL_STATUTORY_FILE,
};
