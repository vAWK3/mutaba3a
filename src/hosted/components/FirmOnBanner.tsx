import { useState } from 'react';
import { useLanguage } from '../../lib/i18n/core';
import { useMe, useProfile } from '../session/me';
import { firmBannerKey, rememberFirmBannerDismissed, wasFirmBannerDismissed } from '../data/firmBanner';
import { InfoIcon } from './Icons';

/**
 * MUT-300 (DR5): one dismissible "Firm features are on" note on the
 * Overview, no onboarding checklist; empty states carry the next action as
 * firm tools ship. Losing the stored dismissal only shows the note once
 * more, so it needs no server round trip (data/firmBanner.ts).
 */
export function FirmOnBanner() {
  const profile = useProfile();
  const me = useMe();
  // A fresh note per profile, so switching profiles reads that profile's dismissal
  return profile.firm ? <FirmNote key={profile.id} storageKey={firmBannerKey(me.user.id, profile.id)} profileName={profile.name} /> : null;
}

function FirmNote({ storageKey, profileName }: { storageKey: string; profileName: string }) {
  const { t } = useLanguage();
  const [dismissed, setDismissed] = useState(() => wasFirmBannerDismissed(storageKey));
  if (dismissed) return null;

  const dismiss = () => {
    rememberFirmBannerDismissed(storageKey);
    setDismissed(true);
  };

  return (
    <div className="hp-banner hp-banner-info" role="note">
      <InfoIcon />
      <span>
        {t('hosted.firm.banner.text', { profile: profileName })}{' '}
        <button type="button" className="hp-link-button" onClick={dismiss}>
          {t('hosted.firm.banner.dismiss')}
        </button>
      </span>
    </div>
  );
}
