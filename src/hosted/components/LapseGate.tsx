import { useQuery } from '@tanstack/react-query';
import { useLanguage, useT } from '../../lib/i18n/core';
import { Button } from '../../components/ui/Button';
import type { HostedProfile } from '../api/client';
import { billingQuery } from '../data/billingQueries';
import { isSellable } from '../data/billingView';
import { lapseNoticeOf, type LapseNotice } from '../data/trialPrompt';
import { formatInstant } from '../format/dates';
import { browserTimezone } from '../format/timezones';
import { useMe } from '../session/me';
import { useAccountDrawers } from '../shell/AccountDrawers';
import { AlertIcon, LockIcon } from './Icons';

/**
 * MUT-361 (ADR-181): what the portal shows when the open profile's plan isn't running. `LapseBanner` sits above every
 * page of the profile: a failed payment (GRACE) or read-only. `LockedScreen` replaces the page on a LOCKED profile:
 * Subscribe and Download my records, nothing else (the server refuses the rest anyway). Both offer Subscribe only
 * where a payment of this person's would cover the profile (`coveredProfileIds`, TD-193): anyone else is told to
 * ask the profile's creator. Every action opens a drawer the shell already has: Billing, or Your data.
 */

/** Whether this person's payment would cover the profile, and whether a price can be bought: null while unknown. */
function useCoverage(profileId: string): { covered: boolean; sellable: boolean } | null {
  const billing = useQuery(billingQuery);
  if (!billing.data) return null;
  // A server older than MUT-362 sends no list: then nobody's payment is known to cover it, so no Subscribe.
  return { covered: (billing.data.coveredProfileIds ?? []).includes(profileId), sellable: isSellable(billing.data) };
}

export function LapseBanner({ profile }: { profile: HostedProfile }) {
  const notice = lapseNoticeOf(useMe(), profile);
  if (!notice) return null;
  // A LOCKED profile's pages are the locked screen; only the You page gets through it (MUT-425 eng E1), under this
  if (notice.kind === 'locked') return <LockedNote profile={profile} />;
  return <LapseNote profile={profile} notice={notice} />;
}

/** MUT-425 (eng D7): the locked screen's words and actions as a banner, above the You page of a locked profile. */
function LockedNote({ profile }: { profile: HostedProfile }) {
  const t = useT();
  const drawers = useAccountDrawers();
  const coverage = useCoverage(profile.id);
  const theirs = coverage !== null && !coverage.covered;
  return (
    <section className="hp-banner hp-banner-info hp-lapse-banner" aria-label={t('hosted.billing.gate.label')}>
      <LockIcon />
      <div className="hp-lapse-banner-body">
        <p className="hp-lapse-banner-title">{t('hosted.billing.gate.lockedTitle')}</p>
        <p>{t(theirs ? 'hosted.billing.gate.lockedNotYours' : 'hosted.billing.gate.lockedBody')}</p>
        <div className="hp-lapse-banner-actions">
          <SubscribeAction coverage={coverage} size="sm" />
          <Button variant="secondary" size="sm" onClick={drawers.openYourData}>
            {t('hosted.billing.gate.download')}
          </Button>
        </div>
      </div>
    </section>
  );
}

function LapseNote({ profile, notice }: { profile: HostedProfile; notice: Exclude<LapseNotice, { kind: 'locked' }> }) {
  const t = useT();
  const { language } = useLanguage();
  const drawers = useAccountDrawers();
  const coverage = useCoverage(profile.id);

  if (notice.kind === 'grace') {
    return (
      <section className="hp-banner hp-banner-warning hp-lapse-banner" aria-label={t('hosted.billing.gate.label')}>
        <AlertIcon />
        <div className="hp-lapse-banner-body">
          <p className="hp-lapse-banner-title">{t('hosted.billing.gate.graceTitle')}</p>
          <p>{t('hosted.billing.gate.graceBody')}</p>
          {coverage?.covered !== false && (
            <div className="hp-lapse-banner-actions">
              <button type="button" className="hp-link-button" onClick={() => drawers.openBilling()}>
                {t('hosted.billing.gate.updateCard')}
              </button>
            </div>
          )}
        </div>
      </section>
    );
  }

  const body =
    notice.source === 'TRIAL' && notice.locksAt
      ? t('hosted.billing.gate.readOnlyTrial', { date: formatInstant(notice.locksAt, language, browserTimezone()) })
      : t(notice.source === 'STRIPE' ? 'hosted.billing.gate.readOnlyPaid' : 'hosted.billing.gate.readOnlyNone');
  return (
    <section className="hp-banner hp-banner-info hp-lapse-banner" aria-label={t('hosted.billing.gate.label')}>
      <LockIcon />
      <div className="hp-lapse-banner-body">
        <p className="hp-lapse-banner-title">{t('hosted.billing.gate.readOnlyTitle')}</p>
        <p>{coverage && !coverage.covered ? t('hosted.billing.gate.notYours') : body}</p>
        <div className="hp-lapse-banner-actions">
          <SubscribeAction coverage={coverage} size="sm" />
          <Button variant="secondary" size="sm" onClick={drawers.openYourData}>
            {t('hosted.billing.gate.download')}
          </Button>
        </div>
      </div>
    </section>
  );
}

/**
 * Subscribe where this person's payment covers the profile and a price exists; Billing (which explains) when no price
 * can be bought or the coverage couldn't be read (review: never leave the person with nothing to press); nothing for a
 * profile someone else pays for.
 */
function SubscribeAction({ coverage, size }: { coverage: { covered: boolean; sellable: boolean } | null; size?: 'sm' }) {
  const t = useT();
  const drawers = useAccountDrawers();
  if (coverage && !coverage.covered) return null;
  const subscribe = coverage?.sellable === true;
  return (
    <Button variant="primary" size={size} onClick={() => drawers.openBilling(subscribe ? 'subscribe' : undefined)}>
      {subscribe ? t('hosted.billing.gate.subscribe') : t('hosted.billing.title')}
    </Button>
  );
}

/** The whole page of a LOCKED profile (the one full-page state the portal has, by design: ticket AC4). */
export function LockedScreen({ profile }: { profile: HostedProfile }) {
  const t = useT();
  const drawers = useAccountDrawers();
  const coverage = useCoverage(profile.id);
  const theirs = coverage !== null && !coverage.covered;
  return (
    <div className="hp-empty hp-locked" role="region" aria-labelledby="hp-locked-title">
      <span className="hp-locked-icon" aria-hidden="true">
        <LockIcon />
      </span>
      <h2 id="hp-locked-title">{t('hosted.billing.gate.lockedTitle')}</h2>
      <p>{t(theirs ? 'hosted.billing.gate.lockedNotYours' : 'hosted.billing.gate.lockedBody')}</p>
      <div className="hp-locked-actions">
        <SubscribeAction coverage={coverage} />
        <Button variant="secondary" onClick={drawers.openYourData}>
          {t('hosted.billing.gate.download')}
        </Button>
      </div>
    </div>
  );
}
