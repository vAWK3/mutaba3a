// ============================================================================
// Retained document schema (MUT-145)
// ============================================================================
//
// Document/invoice generation was retired in MUT-145: Mutaba3a records what
// happened, it does not issue documents. The Dexie tables `documents` and
// `documentSequences` are deliberately RETAINED (ADR-029) so that invoices a
// user issued before the removal are never rewritten or truncated, and so the
// generic backup/restore in src/db/backup.ts and the per-profile export keep
// round-tripping them.
//
// Nothing reads these rows for display any more. Only the keys the Dexie
// indexes and the profile export use are typed; the rest of the old document
// shape (line items, totals, PDF archival fields) is kept as opaque fields
// rather than a copy that no consumer would keep honest.
//
// Filed receipts (expense attachments) and the hosted portal's attachments are
// a different feature and do not live here.
//
// Do not drop these tables and do not regress the schema version.

/** Row shape of the retained `documents` table. */
export interface Document {
  id: string;
  number: string;
  type: string;
  status: string;
  businessProfileId: string;
  clientId?: string;
  issueDate?: string;
  dueDate?: string;
  linkedTransactionIds?: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  lockedAt?: string;
  archivedAt?: string;
  [field: string]: unknown;
}

/** Row shape of the retained `documentSequences` table. */
export interface DocumentSequence {
  id: string; // "{businessProfileId}:{documentType}"
  businessProfileId: string;
  documentType: string;
  [field: string]: unknown;
}
