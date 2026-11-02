import type { ReactNode } from 'react';
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
