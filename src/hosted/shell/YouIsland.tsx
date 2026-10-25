import type { CSSProperties } from 'react';
import { Link, useLocation, useSearch } from '@tanstack/react-router';
import { useT } from '../../lib/i18n/core';
import type { HostedProfile } from '../api/client';
import { useMe } from '../session/me';
import { initialsOf } from './initials';
import { islandTarget, isYouPath, parseYouSearch, sectionOf, switchTarget, youPath } from './youRoutes';

/**
 * The six ring colours (MUT-426 eng D2): theme tokens over the brand's `--m-ring1…6` primitives, each at least 3:1
 * against every page surface in its theme (ringColor.test). Profiles have no colour of their own, so the ring is a
 * stable hash of the id: the same on every device, with no API change. Two profiles can share one; the name, not the
 * colour, carries identity on desktop.
 */
export const RING_COLORS = [
  'var(--profile-ring-1)',
  'var(--profile-ring-2)',
  'var(--profile-ring-3)',
  'var(--profile-ring-4)',
  'var(--profile-ring-5)',
  'var(--profile-ring-6)',
] as const;

export type RingColor = (typeof RING_COLORS)[number];

/** FNV-1a over the id's characters: cheap, stable, and spread enough for six buckets. */
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

// eslint-disable-next-line react-refresh/only-export-components -- MUT-426 D1: the ring rule lives with the island
export function ringColorOf(profileId: string): RingColor {
  let hash = FNV_OFFSET;
  for (let i = 0; i < profileId.length; i += 1) hash = Math.imul(hash ^ profileId.charCodeAt(i), FNV_PRIME);
  return RING_COLORS[(hash >>> 0) % RING_COLORS.length];
}

function ringStyle(profile: HostedProfile | null): CSSProperties | undefined {
  return profile ? ({ '--hp-ring': ringColorOf(profile.id) } as CSSProperties) : undefined;
}

/**
 * The You island (MUT-426, epic MUT-423 round 4 variation 3): the open profile's name and your avatar, ringed in the
 * profile's colour. Off the You page it opens You › Profiles, carrying the section (`?from=`, MUT-425 D3/D8) and the
 * exact page (`?back=`, D7). On it, it is lit, and a second press goes back there: never history Back (MUT-425 D4).
 * A phone shows the ringed avatar only (D5); the name is always in the label. Always a link, never a button.
 */
export function YouIsland({ profile }: { profile: HostedProfile | null }) {
  const t = useT();
  const me = useMe();
  // Only the pathname and the You search: the shell re-renders on neither a filter change nor a drawer key (MUT-425)
  const pathname = useLocation({ select: (location) => location.pathname });
  const kept = useSearch({ strict: false, select: (search) => parseYouSearch(search as Record<string, unknown>) });
  const profileId = profile?.id ?? null;
  const onYou = isYouPath(pathname);
  const from = sectionOf(pathname);
  // Only a page deeper than its section needs `back`: the section's own page is where the island returns anyway
  const page = profileId ? parseYouSearch({ back: pathname }).back : undefined;
  const back = profileId && page !== switchTarget(profileId, from) ? page : undefined;
  const label = profile ? t('hosted.shell.island', { name: profile.name }) : t('hosted.you.title');

  return (
    <Link
      to={onYou ? islandTarget(profileId, kept) : youPath(profileId, 'profiles')}
      search={onYou ? undefined : { ...(from ? { from } : {}), ...(back ? { back } : {}) }}
      className={`hp-island hp-glass press${profile ? ' hp-island-named' : ''}${onYou ? ' hp-island-on' : ''}`}
      aria-label={label}
      aria-current={onYou ? 'page' : undefined}
    >
      {profile && (
        <span className="hp-island-name" dir="auto">
          {profile.name}
        </span>
      )}
      <span className="hp-avatar hp-island-avatar" style={ringStyle(profile)} aria-hidden="true">
        {initialsOf(me.user.displayName)}
      </span>
    </Link>
  );
}
