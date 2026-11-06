import type { ReactNode } from 'react';
import { useT } from '../../lib/i18n/core';
import { RadioCards } from './RadioCards';
import type { Language } from '../../lib/i18n/types';
import { formatMinor } from './billingText';
import { AlertIcon } from './Icons';

/** The Billing drawer's small parts, shared by its status view and its steps (MUT-362; MUT-531 split them out). */

/** `live={false}` for a banner the drawer's own live region already announces. */
export function Banner({ tone, text, live = true }: { tone: 'ok' | 'info' | 'error'; text: ReactNode; live?: boolean }) {
  return (
    <div className={`hp-banner hp-banner-${tone}`} role={!live ? undefined : tone === 'error' ? 'alert' : 'status'}>
      <AlertIcon />
      <span>{text}</span>
    </div>
  );
}

/** Amounts are plain `<bdi>` in the figure face (MUT-109), so ₪39 reads correctly inside Arabic. */
export function Amount({ minor, currency, language }: { minor: number; currency: 'ILS' | 'USD'; language: Language }) {
  return <bdi className="hp-amount">{formatMinor(minor, currency, language)}</bdi>;
}

/**
 * "You're buying: for yourself | for a business", as the Subscribe step words it (MUT-418); shared with the
 * Accountant plan's offer (MUT-562), so both ask the same question the same way.
 */
export function BuyerChoice({ idPrefix, value, onChange, consumerEverywhere }: { idPrefix: string; value: 'person' | 'business'; onChange: (buyer: 'person' | 'business') => void; consumerEverywhere: boolean }) {
  const t = useT();
  return (
    <div className="hp-billing-field">
      <span id={`${idPrefix}-buyer`} className="input-label">
        {t('hosted.billing.subscribe.buyer')}
      </span>
      <RadioCards
        name={`${idPrefix}-buyer`}
        labelledBy={`${idPrefix}-buyer`}
        value={value}
        onChange={onChange}
        options={[
          { value: 'person', label: t('hosted.billing.subscribe.person'), note: t(consumerEverywhere ? 'hosted.billing.subscribe.personNoteEverywhere' : 'hosted.billing.subscribe.personNote') },
          { value: 'business', label: t('hosted.billing.subscribe.business'), note: t('hosted.billing.subscribe.businessNote') },
        ]}
      />
    </div>
  );
}

