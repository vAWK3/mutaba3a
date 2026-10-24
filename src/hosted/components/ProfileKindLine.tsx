import type { HostedProfile } from '../api/client';
import { useProfileKind } from '../data/useProfileKind';

/** MUT-373 (DR12): the line under a profile's name (kind, and who it's shared with), on the You page and in Manage profiles. */
export function ProfileKindLine({ profile, viewerId }: { profile: HostedProfile; viewerId: string }) {
  const kind = useProfileKind(profile, viewerId);
  return (
    <span className="hp-option-sub hp-profile-kind" title={kind}>
      {kind}
    </span>
  );
}
