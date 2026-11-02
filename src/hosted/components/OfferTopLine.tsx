import { useEffect } from 'react';
import { useLanguage, useT } from '../../lib/i18n/core';
import { trackOfferShown, type OfferPlace } from '../analytics/portalAnalytics';
import type { BillingOffer } from '../api/client';
import { offerAnalyticsName, offerDay, offerEndsToday } from '../data/billingView';

/**
 * MUT-525 (DD6, DD10c, DD13): the launch offer's one line, "Launch offer: 50% off your first year on Yearly, until
 * <date>.", read before Subscribe in the Billing drawer, the read-only notice and the locked page. Plain `--text`, no
 * box, icon or colour (DD9b). The date is the offer's last Jerusalem calendar day. `place` counts it once per page
 * view (D10); `endsToday` adds "Ends today" on that last day (DD10d, the drawer only).
 */
export function OfferTopLine({ offer, place, endsToday = false }: { offer: BillingOffer; place?: OfferPlace; endsToday?: boolean }) {
  const t = useT();
  const { language } = useLanguage();
  useEffect(() => {
    if (place) trackOfferShown(offerAnalyticsName(offer.id), place);
  }, [offer.id, place]);
  return (
    <p className="hp-offer-line">
      {t('hosted.billing.offer.topLine', { date: offerDay(offer.endsAt, language) })}
      {endsToday && offerEndsToday(offer.endsAt, new Date()) && (
        <>
          {' '}
          <span className="hp-offer-today">{t('hosted.billing.offer.endsToday')}</span>
        </>
      )}
    </p>
  );
}

