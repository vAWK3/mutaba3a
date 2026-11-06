import { useT } from '../../lib/i18n/core';
import type { HostedProfile } from '../api/client';
import { sharingOpen } from '../pages/sharing/sharingRules';
import { useMe } from '../session/me';
import { useIsLocalMode } from '../session/mode';
import { RowGroup, RowNavLink } from './YouRows';

/**
 * MUT-561: the way into a profile's Sharing page, shown only where the page would open (D8). In You › Profiles it is
 * "Share with your accountant" for the open profile; in Manage profiles' edit pane it is "Sharing" for the profile
 * being edited. Either one opens that profile's page, which switches the open profile as every You link does.
 */
export function SharingEntryRow({ profile, place }: { profile: HostedProfile; place: 'you' | 'manage' }) {
  const t = useT();
  const me = useMe();
  const local = useIsLocalMode();
  if (!sharingOpen(me, profile, local)) return null;
  const to = `/p/${profile.id}/you/sharing`;
  return (
    <RowGroup>
      {place === 'you' ? (
        <RowNavLink to={to} label={t('hosted.sharing.entryRow')} sub={<span dir="auto">{profile.name}</span>} />
      ) : (
        <RowNavLink to={to} label={t('hosted.sharing.manageRow')} sub={t('hosted.sharing.manageSub')} />
      )}
    </RowGroup>
  );
}
