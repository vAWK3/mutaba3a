import { useT } from '../../lib/i18n/core';
import type { HostedProfile } from '../api/client';
import { LockIcon } from './Icons';

/**
 * Income views explain why nothing can be edited (hosted-portal.md §7.4), in the
 * IncomeDrawer locked-notice pattern: reason and next step, `role="note"`. The
 * reason comes from the profile the server described, not a hard-coded list.
 *
 * A personal profile (MUT-93) is checked before the read-write early return:
 * once MUT-65 shipped, a personal profile's `access.payments` is session
 * read-write, which would otherwise hide this notice with no replacement
 * guidance -- there is still no "Record payment" affordance on the portal
 * (deferred to a follow-up), and income here comes from the phone app, not
 * from Malafat and not from nothing.
 */
export function ReadOnlyNotice({ profile }: { profile: HostedProfile }) {
  const t = useT();
  if (profile.isPersonalDefault) {
    return (
      <p className="hp-readonly" role="note">
        <LockIcon />
        <span>{t('hosted.readOnly.personal')}</span>
      </p>
    );
  }
  if (profile.access.payments === 'read-write') return null;
  return (
    <p className="hp-readonly" role="note">
      <LockIcon />
      <span>{t(profile.writerOfRecord === 'MALAFAT' ? 'hosted.readOnly.malafat' : 'hosted.readOnly.none')}</span>
    </p>
  );
}
