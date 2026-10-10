// ============================================================================
// Retained month-close schema (MUT-14)
// ============================================================================
//
// The month-close checklist UI (MonthCloseChecklistPage) and its repository
// were removed in MUT-14. The Dexie table `monthCloseStatuses` is deliberately
// RETAINED (ADR-029) so that no user's local database is rewritten or
// truncated, and so the generic backup/restore keeps round-tripping any rows.
//
// Nothing reads these rows for display any more. The checklist is modelled as
// an opaque record rather than the old four flags, which no longer have a
// consumer to keep them honest.
//
// Do not drop this table and do not regress the schema version.

export interface MonthCloseStatus {
  id: string; // "{profileId}:{monthKey}"
  profileId: string;
  monthKey: string; // YYYY-MM
  isClosed: boolean;
  closedAt?: string;
  checklist: Record<string, boolean>;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}
