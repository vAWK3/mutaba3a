import { useLanguage } from '../../../lib/i18n/core';
import type { Currency } from '../../api/client';
import { isZeroDecimal } from '../../format/DecimalAmount';
import { formatBalance } from '../../format/ledger';

/**
 * MUT-774: one client balance in one currency, as the clients list stacks them: what the client owes, "Client in
 * credit · ₪50" below zero (D15, the ledger card's words), or "Settled" at zero. The amount is its own <bdi>.
 */
export function ClientBalance({ balance, currency }: { balance: string; currency: Currency }) {
  const { t, language } = useLanguage();
  if (isZeroDecimal(balance)) return <div className="hp-client-balance hp-muted">{t('hosted.clients.settled')}</div>;
  const b = formatBalance(balance, currency, language);
  return (
    <div className="hp-client-balance" data-testid={`client-balance-${currency}`}>
      {b.inCredit ? <bdi className="hp-ledger-credit">{t('hosted.ledger.inCredit', { amount: b.text })}</bdi> : <bdi>{b.text}</bdi>}
    </div>
  );
}
