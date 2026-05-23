/**
 * Cross-profile transaction statistics for shared clients.
 * Returns per-profile transaction counts and totals for clients
 * that have transactions in multiple profiles.
 */

import { db } from './database';
import { excludeDeleted } from './baseQuery';

export interface ProfileStat {
  profileId: string;
  profileName: string;
  txCount: number;
  totalMinor: number;
}

/**
 * Get cross-profile stats for all clients that have transactions in 2+ profiles.
 * Returns a Map of clientId -> ProfileStat[] (only for clients with multi-profile data).
 */
export async function getCrossProfileClientStats(): Promise<Map<string, ProfileStat[]>> {
  const transactions = await db.transactions.toArray();
  const profiles = await db.businessProfiles.toArray();
  const profileMap = new Map(profiles.map(p => [p.id, p.name]));

  // Group non-deleted transactions by clientId + profileId
  const clientProfileMap = new Map<string, Map<string, { count: number; total: number }>>();

  for (const tx of transactions) {
    if (!excludeDeleted(tx)) continue;
    if (!tx.clientId || !tx.profileId) continue;

    let profileGroup = clientProfileMap.get(tx.clientId);
    if (!profileGroup) {
      profileGroup = new Map();
      clientProfileMap.set(tx.clientId, profileGroup);
    }

    let stats = profileGroup.get(tx.profileId);
    if (!stats) {
      stats = { count: 0, total: 0 };
      profileGroup.set(tx.profileId, stats);
    }

    stats.count++;
    stats.total += tx.amountMinor;
  }

  // Only return clients with transactions in 2+ profiles
  const result = new Map<string, ProfileStat[]>();
  for (const [clientId, profileGroup] of clientProfileMap) {
    if (profileGroup.size < 2) continue;

    const profileStats: ProfileStat[] = [];
    for (const [profileId, stats] of profileGroup) {
      profileStats.push({
        profileId,
        profileName: profileMap.get(profileId) || 'Unknown',
        txCount: stats.count,
        totalMinor: stats.total,
      });
    }
    result.set(clientId, profileStats);
  }

  return result;
}
