import type { LocalSnapshotMaps } from '../../../server/src/repositories/memory.js';
import { LocalRecordsFileRefused } from '../session/localBackendContract.js';
import { LOCAL_FORMAT_VERSION, migrate, type StoredSnapshot } from './migrations/index.js';

/**
 * The "Download my records" file (D2, brief §2.5): the snapshot as JSON, with
 * the three things JSON can't hold tagged so they come back as themselves —
 * `Map` (every snapshot field), `Date` (timestamps) and `bigint` (minor-unit
 * amounts, which must never pass through a float). Restore reads it back,
 * refuses a newer format, and runs this build's migrations on an older one,
 * the same way `persistence.load()` treats IndexedDB.
 */

export const RECORDS_FILE_KIND = 'mutaba3a-local-records';

interface RecordsFile {
  kind: typeof RECORDS_FILE_KIND;
  formatVersion: number;
  savedAt: string;
  maps: unknown;
}

const MAP_TAG = '$map';
const DATE_TAG = '$date';
const BIGINT_TAG = '$bigint';

function encode(value: unknown): unknown {
  if (value instanceof Map) return { [MAP_TAG]: [...value].map(([k, v]) => [k, encode(v)]) };
  if (value instanceof Date) return { [DATE_TAG]: value.toISOString() };
  if (typeof value === 'bigint') return { [BIGINT_TAG]: value.toString() };
  if (Array.isArray(value)) return value.map(encode);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)]));
  }
  return value;
}

function decode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decode);
  if (value === null || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 1) {
    const [tag] = keys;
    const tagged = record[tag as string];
    if (tag === MAP_TAG && Array.isArray(tagged)) return new Map(tagged.map((entry) => decodeEntry(entry)));
    if (tag === DATE_TAG && typeof tagged === 'string') return new Date(tagged);
    if (tag === BIGINT_TAG && typeof tagged === 'string') return BigInt(tagged);
  }
  return Object.fromEntries(keys.map((k) => [k, decode(record[k])]));
}

function decodeEntry(entry: unknown): [unknown, unknown] {
  if (!Array.isArray(entry) || entry.length !== 2) throw new LocalRecordsFileRefused('not-a-records-file');
  return [entry[0], decode(entry[1])];
}

export function encodeRecordsFile(snapshot: StoredSnapshot): string {
  const file: RecordsFile = { kind: RECORDS_FILE_KIND, formatVersion: snapshot.formatVersion, savedAt: snapshot.savedAt.toISOString(), maps: encode(snapshot.maps) };
  return JSON.stringify(file);
}

/** The file's snapshot, migrated to this build's format; `stateVersion` is the caller's to set. */
export function decodeRecordsFile(text: string): Omit<StoredSnapshot, 'stateVersion'> {
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
  const maps = decode(parsed.maps);
  if (!isSnapshotMaps(maps)) throw new LocalRecordsFileRefused('not-a-records-file');
  const migrated = migrate({ formatVersion: parsed.formatVersion, stateVersion: 0, savedAt: new Date(parsed.savedAt), maps });
  return { formatVersion: migrated.formatVersion, savedAt: migrated.savedAt, maps: migrated.maps };
}

/** Every field a snapshot has must be a Map; a file missing one (or from something else) is refused, never half-restored. */
const SNAPSHOT_FIELDS: readonly (keyof LocalSnapshotMaps)[] = [
  'orgs', 'ints', 'custs', 'projs', 'refs', 'rates', 'agrs', 'insts', 'charges', 'recs', 'supps', 'versions', 'files', 'pays',
  'allocs', 'credits', 'counters', 'props', 'people', 'members', 'exps', 'expCats', 'expReceipts', 'convs', 'expGroups', 'groupMarks', 'inbox',
];

function isSnapshotMaps(value: unknown): value is LocalSnapshotMaps {
  if (value === null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return SNAPSHOT_FIELDS.every((field) => record[field] instanceof Map);
}

/** What the restore confirm names: the person's own records, not bookkeeping rows (people, memberships, counters). */
export function countRecords(maps: LocalSnapshotMaps): number {
  return maps.custs.size + maps.projs.size + maps.recs.size + maps.pays.size + maps.exps.size + maps.convs.size;
}
