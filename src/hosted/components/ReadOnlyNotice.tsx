import { useT } from '../../lib/i18n/core';
import type { HostedProfile } from '../api/client';
import { incomeAffordancesFor } from '../data/incomeAffordances';
import { LockIcon } from './Icons';

/**
 * Income views explain why nothing can be edited (hosted-portal.md §7.4), in the
 * IncomeDrawer locked-notice pattern: reason and next step, `role="note"`. The
 * reason comes from the profile the server described, not a hard-coded list.
 *
 * A personal profile (MUT-93) is checked before the read-write early return.
 * Since MUT-133 it can write income from the portal, so it gets no notice,
 * the rule every other writable profile already follows (design review 12A).
 * The personal copy remains only as the fallback for a personal profile whose
 * published rules ever offer no income writes.
 */
export function ReadOnlyNotice({ profile }: { profile: HostedProfile }) {
  const t = useT();
  if (profile.isPersonalDefault) {
    if (incomeAffordancesFor(profile).kinds.length > 0) return null;
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
