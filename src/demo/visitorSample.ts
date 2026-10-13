/**
 * The landing page's way into the app (MUT-78, ADR-042): open straight on a
 * sample business, with no dialogs, and leave it cleanly.
 *
 * The sample only ever goes into a database with none of the person's own
 * data, so it can never mix with theirs. Leaving removes the sample and
 * anything added during the session (rows created after the session started
 * that aren't `demo_` rows), and switches off the optional areas the sample
 * switched on. Rows older than the session — a restored backup — survive.
 */

import type { Table } from 'dexie';
import { db } from '../db/database';
import { settingsRepo } from '../db/repository';
import { withFeature } from '../lib/features/features';
import { DEMO_ID_PREFIX, DEMO_PREFIXES } from './constants';
import { hasDemoData, removeDemoData, seedDemoData, getDemoProfileIds } from './seedData';
import {
  clearSampleSession,
  readSampleSession,
  writeSampleSession,
  type SampleSession,
} from './sampleSession';

export { readSampleSession } from './sampleSession';

export type VisitorEntryResult = { kind: 'sample'; profileId: string } | { kind: 'own-data' };

interface DatedRow {
  id: string;
  createdAt?: string;
}

/** Tables where a visitor can add rows while looking around. */
function sessionTables(): Table<DatedRow, string>[] {
  return [
    db.businessProfiles,
    db.clients,
    db.projects,
    db.transactions,
    db.paymentRecords,
    db.expenses,
    db.retainerAgreements,
  ] as unknown as Table<DatedRow, string>[];
}

/**
 * Tables whose non-sample rows mean the person has data of their own.
 * `documents` stays after MUT-145: invoices issued before document generation
 * was retired are still the person's data (ADR-029, ADR-042).
 */
function ownDataTables(): Table<DatedRow, string>[] {
  return [db.clients, db.projects, db.transactions, db.expenses, db.documents] as unknown as Table<
    DatedRow,
    string
  >[];
}

const isSampleRow = (row: DatedRow) => row.id.startsWith(DEMO_ID_PREFIX);

/**
 * Any client, project, entry, expense or document that isn't part of the
 * sample. An empty business profile (e.g. from "Skip for now") doesn't count.
 */
async function hasOwnData(): Promise<boolean> {
  for (const table of ownDataTables()) {
    if (await table.filter((row) => !isSampleRow(row)).first()) return true;
  }
  return false;
}

/** The sample business whose Clients list has the most clients owing. */
async function pickSampleProfile(): Promise<string> {
  const owing = await db.transactions
    .where('id')
    .startsWith(DEMO_PREFIXES.transaction)
    .filter((tx) => tx.kind === 'income' && tx.status === 'unpaid' && !tx.deletedAt)
    .toArray();

  const clientsByProfile = new Map<string, Set<string>>();
  for (const tx of owing) {
    if (!tx.profileId || !tx.clientId) continue;
    const clients = clientsByProfile.get(tx.profileId) ?? new Set<string>();
    clients.add(tx.clientId);
    clientsByProfile.set(tx.profileId, clients);
  }

  const ids = getDemoProfileIds();
  return ids.reduce((best, id) =>
    (clientsByProfile.get(id)?.size ?? 0) > (clientsByProfile.get(best)?.size ?? 0) ? id : best
  );
}

function addedDuringSession(session: SampleSession) {
  return (row: DatedRow) => !isSampleRow(row) && !!row.createdAt && row.createdAt >= session.startedAt;
}

/**
 * Open the sample for a visitor. Returns `own-data` (and changes nothing)
 * when the database already holds the person's own data.
 */
export async function enterVisitorSample(): Promise<VisitorEntryResult> {
  const existing = readSampleSession();
  if (existing) {
    if (await hasDemoData()) return { kind: 'sample', profileId: existing.profileId };
    clearSampleSession();
  }

  if (await hasOwnData()) return { kind: 'own-data' };

  const startedAt = new Date().toISOString();
  const stats = await seedDemoData({ announceFeatures: false });
  const profileId = await pickSampleProfile();
  writeSampleSession({ profileId, enabledFeatures: stats.featuresEnabled, startedAt });
  return { kind: 'sample', profileId };
}

/** How many rows the visitor added while looking around (not sample rows, not older rows). */
export async function countSessionAdditions(): Promise<number> {
  const session = readSampleSession();
  if (!session) return 0;
  const added = addedDuringSession(session);
  const counts = await Promise.all(sessionTables().map((table) => table.filter(added).count()));
  return counts.reduce((sum, n) => sum + n, 0);
}

/** Remove the sample and the session's additions; switch the sample's areas back off. */
export async function leaveVisitorSample(): Promise<void> {
  const session = readSampleSession();
  await removeDemoData();

  if (session) {
    const added = addedDuringSession(session);
    await db.transaction('rw', sessionTables(), async () => {
      for (const table of sessionTables()) {
        await table.filter(added).delete();
      }
    });

    if (session.enabledFeatures.length > 0) {
      const settings = await settingsRepo.get();
      const features = session.enabledFeatures.reduce(
        (flags, key) => withFeature(flags, key, false),
        settings.features
      );
      const notice = (settings.featureNotice ?? []).filter((key) => !session.enabledFeatures.includes(key));
      await settingsRepo.update({ features, featureNotice: notice.length > 0 ? notice : undefined });
    }
  }

  clearSampleSession();
}
