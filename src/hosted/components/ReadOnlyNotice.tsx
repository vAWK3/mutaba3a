import { useT } from '../../lib/i18n/core';
import type { HostedProfile } from '../api/client';
import { LockIcon } from './Icons';

/**
 * Income views explain why nothing can be edited (hosted-portal.md §7.4), in the
 * IncomeDrawer locked-notice pattern: reason and next step, `role="note"`. The
 * reason comes from the profile the server described, not a hard-coded list.
 */
export function ReadOnlyNotice({ profile }: { profile: HostedProfile }) {
  const t = useT();
  if (profile.access.payments === 'read-write') return null;
  return (
    <p className="hp-readonly" role="note">
      <LockIcon />
      <span>{t(profile.writerOfRecord === 'MALAFAT' ? 'hosted.readOnly.malafat' : 'hosted.readOnly.none')}</span>
    </p>
  );
}
