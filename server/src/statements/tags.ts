import type { DueItem, DueKind } from '../issuing/documents-due.js';
import type { IssuedDocType } from '../issuing/types.js';
import type { ExternalInvoiceRecord, IssuedDocumentRecord } from '../repositories/ports.js';
import type { StatementLine } from './build.js';

/**
 * MUT-664 (ADR-217 amendment): what the ledger card shows beside each line — the documents that stand on it and the
 * one it is still due. Pure: the route hands it the customer's issued documents (MUT-568), the invoices attached from
 * elsewhere (MUT-647) and MUT-660's due items, and it never moves an amount or a balance (documents never do).
 *
 * | Line             | Documents                                                                      | Due            |
 * | CHARGE           | tax invoice / invoice-receipt by receivableId; an attached OWED invoice         | the Owed's     |
 * | PAYMENT          | receipt / invoice-receipt by paymentId; an attached RECEIVED invoice; receiptNumber | the payment's |
 * | CREDIT           | the credit note by creditId                                                     | —              |
 * | PAYMENT_REVERSAL | —                                                                              | —              |
 */

export interface StatementDocumentTag {
  /** The issued document's id; null for a document issued elsewhere. */
  id: string | null;
  source: 'ISSUED' | 'EXTERNAL';
  docType: IssuedDocType;
  number: string;
}

export interface StatementLineTags {
  documents: StatementDocumentTag[];
  due: DueKind | null;
}

export interface StatementTagInputs {
  issued: readonly IssuedDocumentRecord[];
  external: readonly ExternalInvoiceRecord[];
  due: readonly DueItem[];
}

export const NO_TAGS: StatementLineTags = { documents: [], due: null };

const issuedTag = (d: IssuedDocumentRecord): StatementDocumentTag => ({ id: d.id, source: 'ISSUED', docType: d.docType, number: String(d.number) });
const externalTag = (e: ExternalInvoiceRecord, docType: IssuedDocType): StatementDocumentTag => ({ id: null, source: 'EXTERNAL', docType, number: e.number });

export function statementTags(lines: readonly StatementLine[], inputs: StatementTagInputs): Map<string, StatementLineTags> {
  const live = inputs.external.filter((e) => e.removedAt === null);
  const tags = new Map<string, StatementLineTags>();
  for (const line of lines) {
    switch (line.kind) {
      case 'CHARGE': {
        const id = line.receivableId!;
        tags.set(line.id, {
          documents: [
            ...inputs.issued.filter((d) => d.receivableId === id && d.docType !== 'CREDIT_NOTE').map(issuedTag),
            ...live.filter((e) => e.entryKind === 'OWED' && e.entryId === id).map((e) => externalTag(e, 'TAX_INVOICE')),
          ],
          due: inputs.due.find((i) => i.entry.kind === 'receivable' && i.entry.id === id)?.kind ?? null,
        });
        break;
      }
      case 'PAYMENT': {
        const id = line.paymentId!;
        const receipt = line.payment?.receiptNumber;
        tags.set(line.id, {
          documents: [
            ...inputs.issued.filter((d) => d.paymentId === id).map(issuedTag),
            ...live.filter((e) => e.entryKind === 'RECEIVED' && e.entryId === id).map((e) => externalTag(e, 'TAX_INVOICE_RECEIPT')),
            ...(receipt ? [{ id: null, source: 'EXTERNAL' as const, docType: 'RECEIPT' as const, number: receipt }] : []),
          ],
          due: inputs.due.find((i) => i.entry.kind === 'payment' && i.entry.id === id)?.kind ?? null,
        });
        break;
      }
      case 'CREDIT':
        tags.set(line.id, { documents: inputs.issued.filter((d) => d.creditId !== null && d.creditId === line.credit?.id).map(issuedTag), due: null });
        break;
      case 'PAYMENT_REVERSAL':
        tags.set(line.id, NO_TAGS);
        break;
      case 'REFUND':
        // MUT-643: the credit note that gave the money back.
        tags.set(line.id, { documents: inputs.issued.filter((d) => d.id === line.refund?.issuedDocumentId).map(issuedTag), due: null });
        break;
    }
  }
  return tags;
}
