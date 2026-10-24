import { Link, useLocation, useSearch } from '@tanstack/react-router';
import { useT } from '../../lib/i18n/core';
import type { HostedProfile } from '../api/client';
import { useMe } from '../session/me';
import { useIsLocalMode } from '../session/mode';
import { initialsOf } from './initials';
import { isYouPath, parseYouSearch, sectionOf, youPath } from './youRoutes';

/**
 * The sidebar's two ways into the You page (MUT-425), where the profile switcher and the account menu were: the open
 * profile's name opens You › Profiles, the avatar opens You › Account. Each carries the section the person is in as
 * `?from=` (eng D3, D8: profile-less too), and on the You page passes the current `from` through (outside voice O1).
 * Temporary: MUT-426 replaces both with the island.
 */
export function YouLinks({ profile, position }: { profile: HostedProfile | null; position: 'top' | 'bottom' }) {
  const t = useT();
  const me = useMe();
  const local = useIsLocalMode();
  // Only the pathname and `from`: the shell re-renders on neither a filter change nor a drawer key (review)
  const pathname = useLocation({ select: (location) => location.pathname });
  const keptFrom = useSearch({ strict: false, select: (search) => parseYouSearch(search as Record<string, unknown>).from });
  const from = isYouPath(pathname) ? keptFrom : sectionOf(pathname);
  const search = from ? { from } : {};
  const profileId = profile?.id ?? null;

  if (position === 'top') {
    if (me.profiles.length === 0) return null;
    return (
      <Link
        to={youPath(profileId, 'profiles')}
        search={search}
        // Exact: on You › Account the avatar link is the current one, not both (review)
        activeOptions={{ exact: true, includeSearch: false }}
        className="hp-you-link-profile press"
        aria-label={profile ? `${t('hosted.shell.switcher.label')}: ${profile.name}` : t('hosted.shell.switcher.label')}
      >
        <span className="hp-you-link-name" dir="auto">
          {profile ? profile.name : t('hosted.shell.switcher.label')}
        </span>
        {profile && !local && <span className="hp-chip">{t('hosted.shell.switcher.hosted')}</span>}
      </Link>
    );
  }
  return (
    <Link to={youPath(profileId, 'account')} search={search} className="hp-you-link-account press" aria-label={`${t('hosted.shell.account')}: ${me.user.displayName}`}>
      <span className="hp-avatar" aria-hidden="true">
        {initialsOf(me.user.displayName)}
      </span>
      <span className="hp-you-link-who">
        <span>{me.user.displayName}</span>
        {local ? <small>{t('hosted.local.onThisDevice')}</small> : <small dir="ltr">{me.user.email}</small>}
      </span>
    </Link>
  );
}
