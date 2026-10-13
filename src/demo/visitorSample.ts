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

import { getRepositories } from '../db';
import { withFeature } from '../lib/features/features';
import { hasDemoData, removeDemoData, seedDemoData, getDemoProfileIds } from './seedData';
import {
  clearSampleSession,
  readSampleSession,
  writeSampleSession,
} from './sampleSession';

export { readSampleSession } from './sampleSession';

export type VisitorEntryResult = { kind: 'sample'; profileId: string } | { kind: 'own-data' };

/** The sample business whose Clients list has the most clients owing. */
async function pickSampleProfile(): Promise<string> {
  const owing = await getRepositories().base.demoData.listUnpaidSampleIncome();

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

  if (await getRepositories().base.demoData.hasOwnData()) return { kind: 'own-data' };

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
  return getRepositories().base.demoData.countSessionAdditions(session.startedAt);
}

/** Remove the sample and the session's additions; switch the sample's areas back off. */
export async function leaveVisitorSample(): Promise<void> {
  const session = readSampleSession();
  await removeDemoData();

  if (session) {
    await getRepositories().base.demoData.removeSessionAdditions(session.startedAt);

    if (session.enabledFeatures.length > 0) {
      const { settings: settingsRepo } = getRepositories().base;
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
