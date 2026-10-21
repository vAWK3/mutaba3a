import { useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '../../components/ui/Button';
import { useT } from '../../lib/i18n/core';
import { useTp } from '../../lib/i18n/plural';
import type { HostedProfile, Me, UpdateProfileResponse } from '../api/client';
import { canCreateProfile, coOwnsOthersProfiles, profileEditability } from '../data/profileRules';
import { useProfileKind } from '../data/useProfileKind';
import { profileKey, ME_KEY, useMe } from '../session/me';
import { withProfileLeft } from '../data/profileQueries';
import { useLostAccess } from '../session/lostAccess';
import { Drawer } from './Drawer';
import { LockIcon } from './Icons';
import { ProfileBanner } from './ProfileBanner';
import { ProfileEditForm } from './ProfileEditForm';
import type { ProfileBanner as Banner } from './profileApiErrors';
import { useToast } from './Toast';

/**
 * Manage profiles (MUT-183 plan §2.4): one drawer with two panes, the list
 * (`?manageProfiles=true`) and one profile's edit form (`?editProfile=<id>`).
 * One `Drawer` for both, so moving between panes never replays the slide; the
 * edit form renders its buttons into this drawer's footer through a slot.
 */

interface TypeChangedNote {
  profileId: string;
  type: NonNullable<HostedProfile['type']>;
  count: number;
}

export interface ProfilesManageDrawerProps {
  active: HostedProfile | null;
  /** The profile whose edit pane is open, from the URL; anything not editable shows the list (RT5). */
  editId?: string;
  onEdit: (profileId: string) => void;
  onBack: () => void;
  onNew: () => void;
  onClose: () => void;
}

export function ProfilesManageDrawer({ active, editId, onEdit, onBack, onNew, onClose }: ProfilesManageDrawerProps) {
  const t = useT();
  const tp = useTp();
  const me = useMe();
  const showToast = useToast();
  const [footerSlot, setFooterSlot] = useState<HTMLDivElement | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [typeChanged, setTypeChanged] = useState<TypeChangedNote | null>(null);
  const [ownersBusy, setOwnersBusy] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const forgetOpen = useLostAccess((s) => s.forget);

  const editing = me.profiles.find((profile) => profile.id === editId && profile.owned) ?? null;
  const canCreate = canCreateProfile(me);

  const leaveEdit = (next: Banner | null) => {
    setBanner(next);
    onBack();
  };

  /**
   * MUT-373 (DR4): leaving closes the whole drawer. If the profile was open, the portal moves to the personal profile
   * first, and only then forgets it, so nothing renders "This profile isn't available" in between.
   */
  const onLeftProfile = async (left: HostedProfile) => {
    forgetOpen(left.id);
    const personal = me.profiles.find((profile) => profile.isPersonalDefault);
    if (active?.id === left.id && personal) await navigate({ to: `/p/${personal.id}` });
    else onClose();
    queryClient.setQueryData<Me>(ME_KEY, (current) => withProfileLeft(current, left.id));
    queryClient.removeQueries({ queryKey: profileKey(left.id) });
    void queryClient.invalidateQueries({ queryKey: ME_KEY });
    showToast(t('hosted.profiles.owners.left', { profile: left.name }), { tone: 'info' });
  };

  const onSaved = (profile: HostedProfile, result: UpdateProfileResponse) => {
    const count = result.typeChange?.uncategorizedExpenses ?? 0;
    // Design review Issue 6: expenses left without a category get a lasting note with the way to them.
    if (result.typeChange && count > 0 && result.profile.type) setTypeChanged({ profileId: profile.id, type: result.profile.type, count });
    else showToast(t('hosted.profiles.saved'), { tone: 'info' });
    leaveEdit(null);
  };

  return (
    <Drawer
      title={editing ? editing.name : t('hosted.profiles.manageTitle')}
      // DR5: never close under a leave or removal still in flight.
      onClose={() => !ownersBusy && onClose()}
      closeLabel={t('common.close')}
      footer={editing ? <div ref={setFooterSlot} className="drawer-footer-right" /> : undefined}
    >
      {editing ? (
        <ProfileEditForm
          key={editing.id}
          profile={editing}
          footerSlot={footerSlot}
          onSaved={(result) => onSaved(editing, result)}
          onLeave={leaveEdit}
          onLeftProfile={(left) => void onLeftProfile(left)}
          onOwnersBusy={setOwnersBusy}
        />
      ) : (
        <div className="hp-profiles">
          {typeChanged && (
            <ProfileBanner
              banner={{
                tone: 'info',
                key: 'hosted.profiles.typeChanged',
                count: typeChanged.count,
                vars: { type: t(typeChanged.type === 'BUSINESS' ? 'hosted.profiles.kind.business' : 'hosted.profiles.kind.personal') },
              }}
            >
              {' '}
              <Link to={`/p/${typeChanged.profileId}/expenses`} className="hp-link">
                {t('hosted.profiles.openExpenses')}
              </Link>
            </ProfileBanner>
          )}
          {banner && <ProfileBanner banner={banner} />}
          <div className="hp-profiles-head">
            <span className="hp-muted">
              {tp('hosted.profiles.used', me.limits.maxOwnedProfiles, { owned: String(me.limits.ownedProfiles) })}
              {/* MUT-373 (DR2): only for someone the count would otherwise puzzle. */}
              {coOwnsOthersProfiles(me) && <span className="hp-profiles-cap-hint">{t('hosted.profiles.owners.capHint')}</span>}
            </span>
            <Button variant="secondary" size="sm" aria-disabled={!canCreate || undefined} onClick={() => canCreate && onNew()}>
              {t('hosted.shell.switcher.newProfile')}
            </Button>
          </div>
          <ul className="hp-profile-list">
            {me.profiles.map((profile) => (
              <li key={profile.id}>
                <ProfileRow profile={profile} viewerId={me.user.id} open={profile.id === active?.id} onEdit={onEdit} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </Drawer>
  );
}

function ProfileRow({ profile, viewerId, open, onEdit }: { profile: HostedProfile; viewerId: string; open: boolean; onEdit: (id: string) => void }) {
  const t = useT();
  const kind = useProfileKind(profile, viewerId);
  const editability = profileEditability(profile);
  const body = (
    <>
      <span className="hp-profile-row-text">
        <span className="hp-profile-row-line">
          <span className="hp-profile-row-name" dir="auto" title={profile.name}>
            {profile.name}
          </span>
          {open && <span className="hp-pill-open">{t('hosted.profiles.openNow')}</span>}
        </span>
        {editability.editable ? (
          <span className="hp-option-sub hp-profile-kind" title={kind}>
            {kind}
          </span>
        ) : (
          <span className="hp-option-sub hp-profile-row-reason">
            <LockIcon />
            {t(editability.reason === 'MALAFAT' ? 'hosted.profiles.readOnly.malafat' : 'hosted.profiles.readOnly.operator')}
          </span>
        )}
      </span>
      <span className="hp-profile-row-currency" dir="ltr">
        {profile.defaultCurrency}
      </span>
      {editability.editable && (
        <span className="hp-profile-row-chevron" aria-hidden="true">
          ›
        </span>
      )}
    </>
  );
  if (!editability.editable) return <div className="hp-profile-row hp-profile-row-ro">{body}</div>;
  return (
    <button type="button" className="hp-profile-row press" onClick={() => onEdit(profile.id)}>
      {body}
    </button>
  );
}
