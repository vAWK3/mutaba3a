/**
 * A data file the person picked in Settings › Your data › Restore (MUT-88,
 * ADR-072): what it is, and the hand-off that carries a non-backup file to
 * the import page so it isn't picked twice.
 */

export type DataFileKind =
  | { kind: 'fullBackup'; timestamp?: string; version: number; records: number }
  | { kind: 'businessExport' }
  | { kind: 'csv' }
  | { kind: 'unknown' };

/** A full backup (`src/db/backup.ts`): `{ version, timestamp, tables }`. */
export function isFullBackup(data: unknown): data is { version: number; timestamp?: string; tables: Record<string, unknown> } {
  if (typeof data !== 'object' || data === null) return false;
  const { version, tables } = data as { version?: unknown; tables?: unknown };
  return typeof version === 'number' && typeof tables === 'object' && tables !== null;
}

/** A legacy (v1) export carries at least one array of rows to restore. */
export function hasLegacyRows(data: { clients?: unknown; projects?: unknown; transactions?: unknown }): boolean {
  return [data.clients, data.projects, data.transactions].some((rows) => Array.isArray(rows) && rows.length > 0);
}

function isBusinessExport(data: { version?: unknown; profile?: unknown }): boolean {
  return data.version === 2 && !!data.profile;
}

function countRecords(tables: Record<string, unknown>): number {
  return Object.values(tables).reduce<number>((sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0), 0);
}

/** Read a picked file's name and text once and say where it belongs. */
export function classifyDataFile(name: string, text: string): DataFileKind {
  const lower = name.toLowerCase();
  if (lower.endsWith('.csv')) return { kind: 'csv' };
  if (!lower.endsWith('.json')) return { kind: 'unknown' };

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { kind: 'unknown' };
  }
  if (typeof data !== 'object' || data === null) return { kind: 'unknown' };

  if (isFullBackup(data)) {
    return { kind: 'fullBackup', timestamp: data.timestamp, version: data.version, records: countRecords(data.tables) };
  }
  const rows = data as Parameters<typeof hasLegacyRows>[0] & Parameters<typeof isBusinessExport>[0];
  if (isBusinessExport(rows) || hasLegacyRows(rows)) return { kind: 'businessExport' };
  return { kind: 'unknown' };
}

// One slot: Restore puts a file here and navigates; the import page takes it
// once (a second take finds nothing, so a remount never re-imports).
let pendingImport: File | undefined;

export function setPendingImport(file: File): void {
  pendingImport = file;
}

export function takePendingImport(): File | undefined {
  const file = pendingImport;
  pendingImport = undefined;
  return file;
}
