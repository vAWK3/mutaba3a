import { useNavigate } from '@tanstack/react-router';
import { useT } from '../../../lib/i18n/core';
import { useTp } from '../../../lib/i18n/plural';
import type { HostedProfile } from '../../api/client';
import { ProfileKindLine } from '../../components/ProfileKindLine';
import { RowButton, RowGroup } from '../../components/YouRows';
import { atProfileCap, canCreateProfile } from '../../data/profileRules';
import { useMe } from '../../session/me';
import { useIsLocalMode } from '../../session/mode';
import { useProfileDrawers } from '../../shell/ProfileDrawers';
import { switchTarget, type SectionSegment } from '../../shell/youRoutes';

/**
 * You › Profiles (MUT-425; was the profile switcher, hosted-portal.md §7.2): each profile with its kind, the Hosted
 * chip and the shared cue; New profile and Manage profiles (MUT-183); the note that local profiles stay on the device.
 * Picking a profile, the open one included, goes to the section the person came from (`from`), never the record: a
 * client id from one firm means nothing in another. At the cap, New profile stays focusable and says why it does
 * nothing (`aria-disabled`, plan §2.2).
 */
export function YouProfiles({ active, from }: { active: HostedProfile | null; from: SectionSegment | undefined }) {
  const t = useT();
  const tp = useTp();
  const me = useMe();
  // Signed out every profile is on this device: no "Hosted" chip, no note about the old local app (MUT-286)
  const local = useIsLocalMode();
  const drawers = useProfileDrawers();
  const navigate = useNavigate();
  const canCreate = canCreateProfile(me);
  const atCap = atProfileCap(me);

  // MUT-361 (review): say why New profile is off when the lapse gate, not the cap, holds it
  const newProfileSub = atCap
    ? tp('hosted.profiles.used', me.limits.maxOwnedProfiles, { owned: String(me.limits.ownedProfiles) })
    : !canCreate
      ? t('hosted.billing.gate.newProfileBlocked')
      : undefined;

  return (
    <>
      <RowGroup>
        {me.profiles.map((profile) => {
          const current = profile.id === active?.id;
          return (
            <RowButton
              key={profile.id}
              current={current}
              lead={
                <span className="hp-check" aria-hidden="true">
                  {current ? '✓' : ''}
                </span>
              }
              label={
                <span className="hp-option-line">
                  <span dir="auto">{profile.name}</span>
                  {!local && <span className="hp-chip">{t('hosted.shell.switcher.hosted')}</span>}
                </span>
              }
              sub={<ProfileKindLine profile={profile} viewerId={me.user.id} />}
              onClick={() => void navigate({ to: switchTarget(profile.id, from) })}
            />
          );
        })}
      </RowGroup>
      <RowGroup>
        <RowButton tone="action" inert={!canCreate} label={t('hosted.shell.switcher.newProfile')} sub={newProfileSub} onClick={drawers.openNew} />
        <RowButton tone="action" label={t('hosted.shell.switcher.manage')} onClick={drawers.openManage} />
      </RowGroup>
      {!local && <p className="hp-you-foot">{t('hosted.shell.switcher.localFooter')}</p>}
    </>
  );
}
