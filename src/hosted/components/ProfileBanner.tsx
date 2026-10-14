import { useT } from '../../lib/i18n/core';
import { useTp } from '../../lib/i18n/plural';
import { AlertIcon, InfoIcon } from './Icons';
import type { ProfileBanner as Banner } from './profileApiErrors';

/**
 * The top-of-drawer message slot in the profile drawers (design review
 * Issue 5): it stays until the next submit or until it is resolved, never a
 * toast. Errors are announced (`role="alert"`); the cap is a quiet note.
 */
export function ProfileBanner({ banner, children }: { banner: Banner; children?: React.ReactNode }) {
  const t = useT();
  const tp = useTp();
  const text = banner.count === undefined ? t(banner.key, banner.vars) : tp(banner.key, banner.count, banner.vars);
  const error = banner.tone === 'error';
  return (
    <div className={`hp-banner ${error ? 'hp-banner-error' : 'hp-banner-info'}`} role={error ? 'alert' : 'note'}>
      {error ? <AlertIcon /> : <InfoIcon />}
      <span>
        {text}
        {children}
      </span>
    </div>
  );
}
