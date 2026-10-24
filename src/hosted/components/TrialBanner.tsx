import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLanguage, useT } from '../../lib/i18n/core';
import { useTp } from '../../lib/i18n/plural';
import { trackPortal } from '../analytics/portalAnalytics';
import { billingQuery } from '../data/billingQueries';
import { isSellable } from '../data/billingView';
import { trialBannerOf, type TrialNotice } from '../data/trialPrompt';
import { useAnswerTrialPrompt } from '../data/trialPromptQueries';
import { formatInstant } from '../format/dates';
import { browserTimezone } from '../format/timezones';
import { useMe } from '../session/me';
import { useIsLocalMode } from '../session/mode';
import { useAccountDrawers } from '../shell/AccountDrawers';
import { InfoIcon } from './Icons';

/**
 * MUT-418: the Home reminder while the person's free trial runs with no card: "N days left in your free trial · Add
 * a card". Hiding it lasts 3 days on every device (stored on the server); in the trial's last 3 days it can't be
 * hidden. "Add a card" opens Billing's Subscribe step, and only when a card can be taken (D7). Gone once Stripe pays.
 */
export function TrialBanner() {
  const me = useMe();
  const local = useIsLocalMode();
  const notice = local ? null : trialBannerOf(me, new Date());
  return notice ? <TrialNote notice={notice} /> : null;
}

function TrialNote({ notice }: { notice: TrialNotice }) {
  const t = useT();
  const tp = useTp();
  const { language } = useLanguage();
  const drawers = useAccountDrawers();
  const answer = useAnswerTrialPrompt();
  const billing = useQuery(billingQuery);
  const sellable = billing.data ? isSellable(billing.data) : false;
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current) return;
    shown.current = true;
    void trackPortal('trial_card_prompt_shown', { prompt: 'banner' });
  }, []);

  const addCard = () => {
    void trackPortal('trial_card_prompt_accepted', { prompt: 'banner' });
    drawers.openBilling('subscribe');
  };
  const hide = () => {
    void trackPortal('trial_card_prompt_skipped', { prompt: 'banner' });
    answer.mutate('banner-snoozed');
  };

  return (
    <section className="hp-banner hp-banner-info hp-trial-banner" aria-label={t('hosted.billing.trialBanner.label')}>
      <InfoIcon />
      <div className="hp-trial-banner-body">
        <p className="hp-trial-banner-title">
          {tp('hosted.billing.headline.trialDaysLeft', notice.daysLeft)}
          {sellable && (
            <>
              {' · '}
              <button type="button" className="hp-link-button" onClick={addCard}>
                {t('hosted.billing.trialBanner.addCard')}
              </button>
            </>
          )}
        </p>
        <p className="hp-trial-banner-note">{t('hosted.billing.trialBanner.endsOn', { date: formatInstant(notice.endsAt, language, browserTimezone()) })}</p>
      </div>
      {notice.dismissible && (
        <button type="button" className="hp-link-button hp-trial-banner-hide" onClick={hide}>
          {t('hosted.billing.trialBanner.hide')}
        </button>
      )}
    </section>
  );
}
