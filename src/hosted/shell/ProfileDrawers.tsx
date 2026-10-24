/* eslint-disable react-refresh/only-export-components */
import { useNavigate, useSearch } from '@tanstack/react-router';
import type { HostedProfile } from '../api/client';
import { omitShellOverlay, parseProfileDrawer, type ProfileDrawerSearch } from '../data/filters';
import { ProfileCreateDrawer } from '../components/ProfileCreateDrawer';
import { ProfilesManageDrawer } from '../components/ProfilesManageDrawer';
import { usePersonWritable } from '../session/me';

/**
 * The shell's profile drawers (MUT-183), on every page and on the empty state.
 * Their state is the URL (ADR-008, eng review R1): opening pushes a history
 * entry, so Back closes the drawer; closing replaces, so Back never reopens it.
 * The router strips these keys before any page sees them (`omitShellOverlay`).
 */

type Raw = Record<string, unknown>;

export function useProfileDrawers() {
  const navigate = useNavigate();
  const state = parseProfileDrawer(useSearch({ strict: false }) as Raw);
  const go = (next: ProfileDrawerSearch, replace: boolean) =>
    void navigate({ to: '.', search: (prev: Raw) => ({ ...omitShellOverlay(prev), ...next }), replace } as never);
  return {
    state,
    openNew: () => go({ newProfile: true }, false),
    openManage: () => go({ manageProfiles: true }, false),
    /** Within the Manage drawer: swap panes in place, no extra history entry. */
    showEdit: (profileId: string) => go({ editProfile: profileId }, true),
    showList: () => go({ manageProfiles: true }, true),
    close: () => go({}, true),
  };
}

export function ProfileDrawers({ active }: { active: HostedProfile | null }) {
  const drawers = useProfileDrawers();
  const { state } = drawers;
  // MUT-361 (review R4): a `?newProfile` link opens nothing while the lapse gate holds every profile the person has.
  const mayCreate = usePersonWritable();
  if (state.newProfile && mayCreate) return <ProfileCreateDrawer active={active} onClose={drawers.close} />;
  if (state.manageProfiles || state.editProfile) {
    return (
      <ProfilesManageDrawer
        active={active}
        editId={state.editProfile}
        onEdit={drawers.showEdit}
        onBack={drawers.showList}
        onNew={drawers.openNew}
        onClose={drawers.close}
      />
    );
  }
  return null;
}
