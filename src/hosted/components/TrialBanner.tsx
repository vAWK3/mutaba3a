import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../lib/i18n/core';
import { useTp } from '../../lib/i18n/plural';
import { trackPortal } from '../analytics/portalAnalytics';
import { billingQuery } from '../data/billingQueries';
import { isSellable } from '../data/billingView';
import { trialBannerOf, type TrialNotice } from '../data/trialPrompt';
import { useAnswerTrialPrompt } from '../data/trialPromptQueries';
import { useMe } from '../session/me';
import { useIsLocalMode } from '../session/mode';
import { useAccountDrawers } from '../shell/AccountDrawers';

/**
 * MUT-418: the Home reminder while the person's free trial runs with no card: "N days left in your free trial · Add
 * a card". Hiding it lasts 3 days on every device (stored on the server); in the trial's last 3 days it can't be
 * hidden. "Add a card" opens Billing's Subscribe step, and only when a card can be taken (D7). Gone once Stripe pays.
 * MUT-426 (D4): one quiet line on Owed, with no icon and no box; the end date lives on You › Account's Billing row.
 */
export function TrialBanner() {
  const me = useMe();
  const local = useIsLocalMode();
  const notice = local ? null : trialBannerOf(me, new Date());
  return notice ? <TrialNote notice={notice} /> : null;
}

function TrialNote({ notice }: { notice: Extract<TrialNotice, { kind: 'trial' }> }) {
  const t = useT();
  const tp = useTp();
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
    <section className="hp-trial-line" aria-label={t('hosted.billing.trialBanner.label')}>
      <p>
        {tp('hosted.billing.headline.trialDaysLeft', notice.daysLeft)}
        {sellable && (
          <>
            {' · '}
            <button type="button" className="hp-link-button" onClick={addCard}>
              {t('hosted.billing.trialBanner.addCard')}
            </button>
          </>
        )}
        {notice.dismissible && (
          <>
            {' · '}
            <button type="button" className="hp-link-button" onClick={hide}>
              {t('hosted.billing.trialBanner.hide')}
            </button>
          </>
        )}
      </p>
    </section>
  );
}
