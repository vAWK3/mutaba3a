/**
 * Optional product areas ("Advanced features", MUT-12).
 *
 * Pure module: no React, no import from `db/` beyond the import-free
 * `defaultSettings.ts`, so `database.ts` can call `reconcileFeaturesWithData`
 * from its v20 upgrade without an import cycle. The React and router read
 * paths live in `./useFeatures.ts`.
 *
 * Rules (design brief `.claude/designs/mut-12-advanced-features-toggle.md`):
 * - every area is off by default;
 * - a stored map is resolved tolerantly (missing → default, unknown → dropped,
 *   non-boolean → off);
 * - data presence only ever switches an area ON, never off.
 */

import type { FeatureKey, Settings } from '../../types';
import { DEFAULT_SETTINGS } from '../../db/defaultSettings';

export type { FeatureKey } from '../../types';

/** Display order in Settings; also the order of auto-enable notices. */
export const FEATURE_KEYS = [
  'invoices',
  'retainers',
  'expenses',
  'insights',
  'planning',
  'projects',
] as const satisfies readonly FeatureKey[];

// Type-level guard: the union in `types/index.ts` and this list must match.
type MissingFromList = Exclude<FeatureKey, (typeof FEATURE_KEYS)[number]>;
const _assertEveryKeyListed: MissingFromList extends never ? true : never = true;
void _assertEveryKeyListed;

export type FeatureFlags = Readonly<Record<FeatureKey, boolean>>;

export const DEFAULT_FEATURES: FeatureFlags = Object.freeze(
  Object.fromEntries(FEATURE_KEYS.map((key) => [key, false])) as Record<FeatureKey, boolean>,
);

/**
 * Resolve whatever is stored on the settings row into a complete map.
 * Accepts the raw row field (`Settings['features']`), an imported object of
 * unknown shape, or nothing.
 */
export function resolveFeatures(stored?: Partial<Record<string, unknown>> | null): FeatureFlags {
  const resolved = { ...DEFAULT_FEATURES } as Record<FeatureKey, boolean>;
  if (!stored) return Object.freeze(resolved);
  for (const key of FEATURE_KEYS) {
    const value = stored[key];
    resolved[key] = value === true;
  }
  return Object.freeze(resolved);
}

/** The single merge used by every writer: a new map with one key changed. */
export function withFeature(flags: FeatureFlags, key: FeatureKey, enabled: boolean): FeatureFlags {
  return Object.freeze({ ...flags, [key]: enabled });
}

/**
 * The areas that are on in `before` and off in `after`, in `FEATURE_KEYS`
 * order. Switching an area on is never a reason to move the user (MUT-15).
 */
export function featuresTurnedOff(before: FeatureFlags, after: FeatureFlags): FeatureKey[] {
  return FEATURE_KEYS.filter((key) => before[key] && !after[key]);
}

// ---------------------------------------------------------------------------
// Data presence probes (auto-enable on upgrade / after restore or import)
// ---------------------------------------------------------------------------

/** Rows with this field set are soft-deleted and do not count as data. */
interface SoftDeletable {
  deletedAt?: string;
}

/** What a probe can see: a Dexie `Transaction` or the `db` itself. */
export interface TableReader {
  table(name: string): {
    toCollection(): { first(): Promise<unknown> };
    filter(fn: (row: unknown) => boolean): { first(): Promise<unknown> };
    get(key: string): Promise<unknown>;
    put(row: unknown): Promise<unknown>;
  };
}

interface Probe {
  table: string;
  /** Whether rows carry `deletedAt` and must be filtered to live ones. */
  softDelete: boolean;
}

/**
 * Which tables prove an area has user data. An empty list means the area owns
 * no data of its own and is never auto-enabled (insights is derived from
 * income and expenses). Archived rows count as data: the user created them
 * and can still reach them inside the area; only soft-deleted rows do not.
 * Projects have no soft delete (`archivedAt` only; `projectRepo.delete` is a
 * hard delete), so any row counts. Vendors belong to the expenses module
 * (`Expense.vendorId`), so they switch expenses on.
 */
export const FEATURE_DATA_PROBES: Readonly<Record<FeatureKey, readonly Probe[]>> = Object.freeze({
  invoices: [{ table: 'documents', softDelete: true }],
  retainers: [{ table: 'retainerAgreements', softDelete: false }],
  expenses: [
    { table: 'expenses', softDelete: true },
    { table: 'vendors', softDelete: false },
  ],
  insights: [],
  planning: [{ table: 'plans', softDelete: false }],
  projects: [{ table: 'projects', softDelete: false }],
});

/** Every table a probe reads, for transaction scopes and test cleanup. */
export const PROBED_TABLES: readonly string[] = Object.freeze(
  FEATURE_KEYS.flatMap((key) => FEATURE_DATA_PROBES[key].map((probe) => probe.table)),
);

const SETTINGS_TABLE = 'settings';
const SETTINGS_ROW_ID = 'default';

async function hasLiveRow(reader: TableReader, probe: Probe): Promise<boolean> {
  const table = reader.table(probe.table);
  const first = probe.softDelete
    ? await table.filter((row) => !(row as SoftDeletable).deletedAt).first()
    : await table.toCollection().first();
  return first !== undefined;
}

/**
 * The areas that currently have user data, in `FEATURE_KEYS` order.
 * Stops at the first live row per table, so the cost is one short scan each.
 */
export async function detectFeaturesWithData(reader: TableReader): Promise<FeatureKey[]> {
  const found: FeatureKey[] = [];
  for (const key of FEATURE_KEYS) {
    for (const probe of FEATURE_DATA_PROBES[key]) {
      if (await hasLiveRow(reader, probe)) {
        found.push(key);
        break;
      }
    }
  }
  return found;
}

function mergeNotice(pending: FeatureKey[] | undefined, added: FeatureKey[]): FeatureKey[] {
  const set = new Set<FeatureKey>([...(pending ?? []), ...added]);
  return FEATURE_KEYS.filter((key) => set.has(key));
}

/**
 * Switch on every area that has data and is not already on; record the newly
 * enabled keys in `featureNotice` so the UI can tell the user once.
 *
 * Runs in the Dexie v20 upgrade (on a `Transaction`) and after a backup
 * restore or data import (on `db`). Idempotent: writes nothing when no key is
 * newly enabled. Never switches an area off.
 *
 * @returns the keys that were newly enabled by this call.
 */
export async function reconcileFeaturesWithData(reader: TableReader): Promise<FeatureKey[]> {
  const present = await detectFeaturesWithData(reader);
  if (present.length === 0) return [];

  const settingsTable = reader.table(SETTINGS_TABLE);
  const stored = (await settingsTable.get(SETTINGS_ROW_ID)) as Settings | undefined;
  const current = resolveFeatures(stored?.features);
  const newlyEnabled = present.filter((key) => !current[key]);
  if (newlyEnabled.length === 0) return [];

  const features = newlyEnabled.reduce((flags, key) => withFeature(flags, key, true), current);
  const next: Settings = {
    ...(stored ?? DEFAULT_SETTINGS),
    id: SETTINGS_ROW_ID,
    features: { ...features },
    featureNotice: mergeNotice(stored?.featureNotice, newlyEnabled),
  };
  await settingsTable.put(next);
  return newlyEnabled;
}

/**
 * `reconcileFeaturesWithData` for the restore/import call sites, where the
 * data load has already succeeded: a failure to switch areas on is logged
 * and swallowed so it can never turn a successful import into an error. The
 * user can still enable the area by hand in Settings.
 */
export async function reconcileFeaturesAfterDataLoad(
  source: 'restore' | 'import' | 'demo' | 'sync',
  reader: TableReader,
): Promise<FeatureKey[]> {
  try {
    return await reconcileFeaturesWithData(reader);
  } catch (error) {
    console.error(`[features] could not reconcile optional areas after ${source}:`, error);
    return [];
  }
}
