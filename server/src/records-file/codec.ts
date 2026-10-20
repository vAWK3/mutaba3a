import type { LocalSnapshotMaps } from '../repositories/memory.js';

/**
 * The records file's text (MUT-286 D2, brief §2.5), shared by the portal's
 * local mode (`src/hosted/local/recordsFile.ts`) and the hosted export
 * (MUT-325): a `MemoryLedgerStore` snapshot as JSON, with the three things
 * JSON can't hold tagged so they come back as themselves — `Map` (every
 * snapshot field), `Date` (timestamps) and `bigint` (minor-unit amounts,
 * which must never pass through a float). Pure: the portal bundles it.
 */

export const RECORDS_FILE_KIND = 'mutaba3a-local-records';

/** Every map a snapshot has, in `MemoryLedgerStore.snapshot()`'s order. A file missing one is refused, never half-restored. */
export const SNAPSHOT_FIELDS: readonly (keyof LocalSnapshotMaps)[] = [
  'orgs', 'ints', 'custs', 'projs', 'refs', 'rates', 'agrs', 'insts', 'charges', 'recs', 'supps', 'versions', 'files', 'pays',
  'allocs', 'credits', 'counters', 'props', 'people', 'members', 'exps', 'expCats', 'expReceipts', 'convs', 'expGroups', 'groupMarks', 'inbox',
];

/**
 * MUT-325: a file made from a hosted account, not on a device. A label, not a format change: it sits beside `maps`,
 * so the format version stays and older builds read the file as they always did.
 */
export const HOSTED_EXPORT_ORIGIN = 'hosted-export';

export interface RecordsFileHeader {
  formatVersion: number;
  savedAt: Date;
  origin?: typeof HOSTED_EXPORT_ORIGIN;
}

/** One run of one field's entries; a field's pages arrive together, fields in `SNAPSHOT_FIELDS` order. */
export interface RecordsFilePage {
  field: keyof LocalSnapshotMaps;
  entries: ReadonlyArray<readonly [unknown, unknown]>;
}

const MAP_TAG = '$map';
const DATE_TAG = '$date';
const BIGINT_TAG = '$bigint';

export function encodeTagged(value: unknown): unknown {
  if (value instanceof Map) return { [MAP_TAG]: [...value].map(([k, v]) => [k, encodeTagged(v)]) };
  if (value instanceof Date) return { [DATE_TAG]: value.toISOString() };
  if (typeof value === 'bigint') return { [BIGINT_TAG]: value.toString() };
  if (Array.isArray(value)) return value.map(encodeTagged);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encodeTagged(v)]));
  }
  return value;
}

/** The inverse of `encodeTagged`. `malformedEntry` is called for a `$map` entry that isn't a `[key, value]` pair. */
export function decodeTagged(value: unknown, malformedEntry: () => never = () => { throw new Error('malformed records file map entry'); }): unknown {
  if (Array.isArray(value)) return value.map((v) => decodeTagged(v, malformedEntry));
  if (value === null || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 1) {
    const [tag] = keys;
    const tagged = record[tag as string];
    if (tag === MAP_TAG && Array.isArray(tagged)) {
      return new Map(tagged.map((entry: unknown) => {
        if (!Array.isArray(entry) || entry.length !== 2) malformedEntry();
        return [entry[0], decodeTagged(entry[1], malformedEntry)] as const;
      }));
    }
    if (tag === DATE_TAG && typeof tagged === 'string') return new Date(tagged);
    if (tag === BIGINT_TAG && typeof tagged === 'string') return BigInt(tagged);
  }
  return Object.fromEntries(keys.map((k) => [k, decodeTagged(record[k], malformedEntry)]));
}

function headerJson(header: RecordsFileHeader): Record<string, unknown> {
  return { kind: RECORDS_FILE_KIND, formatVersion: header.formatVersion, savedAt: header.savedAt.toISOString(), ...(header.origin ? { origin: header.origin } : {}) };
}

/** The whole file in one string, from maps already in memory (a device's own download). */
export function encodeRecordsFileText(header: RecordsFileHeader, maps: LocalSnapshotMaps): string {
  return JSON.stringify({ ...headerJson(header), maps: encodeTagged(maps) });
}

/**
 * The same file, written as its pages arrive (MUT-325): a hosted export never
 * holds a whole profile in memory, only the page being written. Every field
 * is written exactly once, in `SNAPSHOT_FIELDS` order, an empty map for a
 * field no page names; a page for a field already passed is a bug and throws.
 */
export async function writeRecordsFile(write: (chunk: string) => Promise<void>, header: RecordsFileHeader, pages: AsyncIterable<RecordsFilePage>): Promise<void> {
  const head = JSON.stringify(headerJson(header));
  await write(`${head.slice(0, -1)},"maps":{`);
  let next = 0; // index of the first field not yet opened
  let open = false; // a field's map is open
  let first = true; // no entry written yet in the open map

  const closeOpen = async () => {
    if (open) await write(']}');
    open = false;
  };
  const openField = async (index: number) => {
    await write(`${index === 0 ? '' : ','}${JSON.stringify(SNAPSHOT_FIELDS[index])}:{"${MAP_TAG}":[`);
    open = true;
    first = true;
  };

  for await (const page of pages) {
    const index = SNAPSHOT_FIELDS.indexOf(page.field);
    if (index < next - 1 || index === -1 || (index === next - 1 && !open)) throw new Error(`records file pages out of order at ${String(page.field)}`);
    if (index >= next) {
      await closeOpen();
      for (; next < index; next++) await write(`${next === 0 ? '' : ','}${JSON.stringify(SNAPSHOT_FIELDS[next])}:{"${MAP_TAG}":[]}`);
      await openField(index);
      next = index + 1;
    }
    if (page.entries.length === 0) continue;
    const body = page.entries.map(([k, v]) => JSON.stringify([k, encodeTagged(v)])).join(',');
    await write(first ? body : `,${body}`);
    first = false;
  }

  await closeOpen();
  for (; next < SNAPSHOT_FIELDS.length; next++) await write(`${next === 0 ? '' : ','}${JSON.stringify(SNAPSHOT_FIELDS[next])}:{"${MAP_TAG}":[]}`);
  await write('}}');
}
