import { useT } from '../../../lib/i18n/core';
import type { HostedProfile } from '../../api/client';
import { SectionTabs } from '../../components/SectionTabs';
import { useMe } from '../../session/me';
import { useIsLocalMode } from '../../session/mode';
import { initialsOf } from '../../shell/initials';
import { youPath, type YouPart, type YouSearch } from '../../shell/youRoutes';
import { YouAccount } from './YouAccount';
import { YouApp } from './YouApp';
import { YouProfiles } from './YouProfiles';

/**
 * The You page (MUT-425, epic MUT-423 round 4 variation 3): who you are, then Profiles · Account · App, one part at a
 * time so no part is ever long. Each part is its own route, so the tabs are links that carry `from` (eng D2/D3) and
 * the island's `back` (MUT-426 D7), and every row opens the shell's existing drawer by its URL key (ProfileDrawers,
 * AccountDrawers): no drawer of its own.
 * `profile` is null on the profile-less `/you` (no profile yet, or one the person lost: eng D3).
 */
export function YouPage({ part, profile, search }: { part: YouPart; profile: HostedProfile | null; search: YouSearch }) {
  const t = useT();
  const profileId = profile?.id ?? null;
  const tabs = [
    { to: youPath(profileId, 'profiles'), label: t('hosted.you.parts.profiles'), exact: true },
    { to: youPath(profileId, 'account'), label: t('hosted.you.parts.account') },
    { to: youPath(profileId, 'app'), label: t('hosted.you.parts.app') },
  ].map((tab) => ({ ...tab, search: { ...(search.from ? { from: search.from } : {}), ...(search.back ? { back: search.back } : {}) } }));

  return (
    <div className="hp-you">
      <YouHeader />
      <SectionTabs variant="segmented" label={t('hosted.you.title')} tabs={tabs} />
      {part === 'profiles' && <YouProfiles active={profile} from={search.from} />}
      {part === 'account' && <YouAccount profile={profile} />}
      {part === 'app' && <YouApp profile={profile} />}
    </div>
  );
}

function YouHeader() {
  const t = useT();
  const { user } = useMe();
  const local = useIsLocalMode();
  return (
    <header className="hp-you-head">
      <span className="hp-avatar hp-avatar--large" aria-hidden="true">
        {initialsOf(user.displayName)}
      </span>
      <div className="hp-you-who">
        <h1 className="hp-you-name" dir="auto">
          {local ? t('hosted.local.onThisDevice') : user.displayName}
        </h1>
        {!local && <small dir="ltr">{user.email}</small>}
      </div>
    </header>
  );
}
