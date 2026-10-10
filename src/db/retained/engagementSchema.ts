// ============================================================================
// Retained engagement schema (MUT-10)
// ============================================================================
//
// The engagements UI was removed in MUT-10. The Dexie tables `engagements` and
// `engagementVersions` are deliberately RETAINED so that no user's local
// database is rewritten or truncated by the removal, and so the generic
// backup/restore in src/db/backup.ts keeps round-tripping any rows that exist.
//
// Nothing reads these rows for display any more. These declarations exist only
// to type the Dexie tables and the migration-safety profileId repair. The
// version snapshot is therefore modelled as an opaque JSON blob rather than a
// copy of the old form shape, which no longer has a consumer to keep it honest.
//
// Do not drop these tables and do not regress the schema version.

export type EngagementType = 'task' | 'retainer';

export type EngagementCategory =
  | 'design'
  | 'development'
  | 'consulting'
  | 'legal'
  | 'marketing'
  | 'other';

export type EngagementStatus = 'draft' | 'final' | 'archived';

export type EngagementLanguage = 'en' | 'ar';

/** Row shape of the retained `engagements` table. */
export interface Engagement {
  id: string;
  profileId: string;
  clientId: string;
  projectId?: string;
  type: EngagementType;
  category: EngagementCategory;
  primaryLanguage: EngagementLanguage;
  status: EngagementStatus;
  currentVersionId?: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

/** Row shape of the retained `engagementVersions` table. */
export interface EngagementVersion {
  id: string;
  engagementId: string;
  versionNumber: number;
  status: 'draft' | 'final';
  /** Opaque form snapshot; preserved verbatim, never interpreted. */
  snapshot: Record<string, unknown>;
  createdAt: string;
}
