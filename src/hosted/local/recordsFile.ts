import type { LocalSnapshotMaps } from '../../../server/src/repositories/memory.js';
import { LocalRecordsFileRefused } from '../session/localBackendContract.js';
import { LOCAL_FORMAT_VERSION, migrate, type StoredSnapshot } from './migrations/index.js';
import { decodeTagged, encodeRecordsFileText, HOSTED_EXPORT_ORIGIN, RECORDS_FILE_KIND, SNAPSHOT_FIELDS, type RecordsFileHeader } from '../../../server/src/records-file/codec.js';

/**
 * The "Download my records" file (D2, brief §2.5): the snapshot as JSON, with
 * the three things JSON can't hold tagged so they come back as themselves —
 * `Map` (every snapshot field), `Date` (timestamps) and `bigint` (minor-unit
 * amounts, which must never pass through a float). Restore reads it back,
 * refuses a newer format, and runs this build's migrations on an older one,
 * the same way `persistence.load()` treats IndexedDB.
 */

export { RECORDS_FILE_KIND };

interface RecordsFile {
  kind: typeof RECORDS_FILE_KIND;
  formatVersion: number;
  savedAt: string;
  origin?: string;
  maps: unknown;
}

function refuseMalformed(): never {
  throw new LocalRecordsFileRefused('not-a-records-file');
}

export function encodeRecordsFile(snapshot: StoredSnapshot, origin?: RecordsFileHeader['origin']): string {
  return encodeRecordsFileText({ formatVersion: snapshot.formatVersion, savedAt: snapshot.savedAt, ...(origin ? { origin } : {}) }, snapshot.maps);
}

/** The file's snapshot, migrated to this build's format; `stateVersion` is the caller's to set. */
export function decodeRecordsFile(text: string): Omit<StoredSnapshot, 'stateVersion'> {
  return decodeRecordsFileWithOrigin(text).snapshot;
}

/** The snapshot, and whether the file is an export from an account (MUT-325) — kept apart, so the label never reaches IndexedDB. */
export function decodeRecordsFileWithOrigin(text: string): { snapshot: Omit<StoredSnapshot, 'stateVersion'>; fromAccount: boolean } {
  let parsed: Partial<RecordsFile>;
  try {
    parsed = JSON.parse(text) as Partial<RecordsFile>;
  } catch {
    throw new LocalRecordsFileRefused('not-a-records-file');
  }
  if (parsed?.kind !== RECORDS_FILE_KIND || typeof parsed.formatVersion !== 'number' || typeof parsed.savedAt !== 'string') {
    throw new LocalRecordsFileRefused('not-a-records-file');
  }
  if (parsed.formatVersion > LOCAL_FORMAT_VERSION) throw new LocalRecordsFileRefused('too-new');
  const maps = decodeTagged(parsed.maps, refuseMalformed);
  if (!isSnapshotMaps(maps)) throw new LocalRecordsFileRefused('not-a-records-file');
  const migrated = migrate({ formatVersion: parsed.formatVersion, stateVersion: 0, savedAt: new Date(parsed.savedAt), maps });
  return { snapshot: { formatVersion: migrated.formatVersion, savedAt: migrated.savedAt, maps: migrated.maps }, fromAccount: parsed.origin === HOSTED_EXPORT_ORIGIN };
}

/** Every field a snapshot has must be a Map; a file missing one (or from something else) is refused, never half-restored. */
function isSnapshotMaps(value: unknown): value is LocalSnapshotMaps {
  if (value === null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return SNAPSHOT_FIELDS.every((field) => record[field] instanceof Map);
}

/** What the restore confirm names: the person's own records, not bookkeeping rows (people, memberships, counters). */
export function countRecords(maps: LocalSnapshotMaps): number {
  return maps.custs.size + maps.projs.size + maps.recs.size + maps.pays.size + maps.exps.size + maps.convs.size;
}
