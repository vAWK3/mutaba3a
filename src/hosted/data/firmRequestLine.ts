import type { HostedProfile } from '../api/client';

/**
 * MUT-373 (design review DR13): with co-owners, who asked matters — a partner shouldn't wonder, or ask again. An
 * older server sends no `firmRequestedBy`, and then the line reads as before.
 */
export function requestedLine(profile: HostedProfile, viewerId: string, t: (key: string, vars: Record<string, string>) => string, date: string): string {
  const by = profile.firmRequestedBy;
  if (!by) return t('hosted.profiles.firm.requested', { date });
  if (by.userId === viewerId) return t('hosted.profiles.firm.requestedByYou', { date });
  const owner = profile.owners?.find((o) => o.userId === by.userId);
  const name = by.name ?? owner?.email ?? null;
  return name ? t('hosted.profiles.firm.requestedBy', { name, date }) : t('hosted.profiles.firm.requested', { date });
}
