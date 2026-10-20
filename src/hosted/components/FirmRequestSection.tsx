import { useId } from 'react';
import { Button } from '../../components/ui/Button';
import { useLanguage } from '../../lib/i18n/core';
import { firmRequestState } from '../data/profileRules';
import { useRequestFirm } from '../data/profileQueries';
import { formatInstant } from '../format/dates';
import { useMe } from '../session/me';
import { useIsLocalMode } from '../session/mode';
import { ProfileBanner } from './ProfileBanner';

/**
 * MUT-300 (DR1): the owner's way to ask for firm features, at the foot of a
 * Business profile's edit pane. It reads the profile from `/v1/me`, not the
 * copy the pane opened with, so Requested shows the moment the server has it
 * and after any reload. No modal: one button, then one line. The request
 * doesn't bump the profile's version (eng review O3), so the pane's Save
 * keeps working. Never signed out on this device (MUT-286): no operator
 * would ever see a request saved there.
 */
export function FirmRequestSection({ profileId }: { profileId: string }) {
  const { t, language } = useLanguage();
  const headingId = useId();
  const profile = useMe().profiles.find((p) => p.id === profileId);
  const request = useRequestFirm(profileId);
  const local = useIsLocalMode();
  if (!profile || local) return null;
  const state = firmRequestState(profile);
  if (state === 'hidden') return null;

  return (
    <section className="hp-firm-request" aria-labelledby={headingId}>
      <h3 id={headingId} className="form-label">
        {t('hosted.profiles.firm.title')}
      </h3>
      {state === 'requested' ? (
        <p className="form-hint">{t('hosted.profiles.firm.requested', { date: formatInstant(profile.firmRequestedAt, language, profile.timezone) })}</p>
      ) : (
        <>
          <p className="form-hint">{t('hosted.profiles.firm.body')}</p>
          {request.isError && <ProfileBanner banner={{ tone: 'error', key: 'hosted.profiles.firm.error' }} />}
          <Button type="button" variant="secondary" aria-disabled={request.isPending || undefined} onClick={() => !request.isPending && request.mutate()}>
            {request.isPending ? t('hosted.profiles.firm.requesting') : t('hosted.profiles.firm.request')}
          </Button>
        </>
      )}
    </section>
  );
}
