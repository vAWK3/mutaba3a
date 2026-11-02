import { Button } from '../../components/ui/Button';
import { useLanguage, useT } from '../../lib/i18n/core';
import { stripeNavigation } from '../data/billingQueries';
import { formatInstant } from '../format/dates';
import { browserTimezone } from '../format/timezones';
import { Amount, Banner } from './billingParts';
import { formatMinor, sentence } from './billingText';
import type { SwitchStep } from './useSwitchStep';

/**
 * MUT-531 (plan D1, R2, §6): Billing's "Switch to yearly" step, in the drawer's body (`?step=switch`, DESIGN.md: one
 * drawer, its body swapped). It shows Stripe's own preview (what is charged today) and confirms at that preview's
 * proration date, so the charge is the amount on screen or nothing at all.
 */

export function SwitchBody({ step }: { step: SwitchStep }) {
  const t = useT();
  const { language } = useLanguage();
  const { preview, failure, approveUrl } = step;
  if (preview.isPending && preview.fetchStatus !== 'idle') {
    return (
      <div className="hp-billing" aria-busy="true">
        <div className="hp-billing-skeleton hp-billing-skeleton-headline" />
        <div className="hp-billing-skeleton" style={{ inlineSize: '65%' }} />
      </div>
    );
  }
  const data = preview.data;
  return (
    <div className="hp-billing">
      {failure && failure !== 'amountChanged' && <Banner tone="error" text={t(`hosted.billing.${failure === 'failed' ? 'states.loadFailed' : `switch.${failure}`}`)} />}
      {failure === 'amountChanged' && <Banner tone="info" text={t('hosted.billing.switch.amountChanged')} />}
      {approveUrl && (
        <div>
          <Button variant="secondary" onClick={() => stripeNavigation.assign(approveUrl)}>
            {t('hosted.billing.switch.approve')}
          </Button>
        </div>
      )}
      {data && (
        <div className="hp-billing-status">
          <p>
            {sentence(t, 'hosted.billing.switch.body', {
              yearly: <Amount minor={data.yearlyAmount} currency={data.currency} language={language} />,
              date: formatInstant(data.renewsOn, language, browserTimezone()),
            })}
          </p>
          <p className="hp-billing-switch-due">{sentence(t, 'hosted.billing.switch.dueToday', { due: <Amount minor={data.amountDue} currency={data.currency} language={language} /> })}</p>
        </div>
      )}
    </div>
  );
}

export function SwitchFooter({ step, onBack }: { step: SwitchStep; onBack: () => void }) {
  const t = useT();
  const { language } = useLanguage();
  const data = step.preview.data;
  const busy = step.mutation.isPending;
  return (
    <div className="drawer-footer-right">
      <Button variant="secondary" onClick={onBack} disabled={busy}>
        {t('hosted.billing.switch.notNow')}
      </Button>
      {data && step.failure !== 'notAvailable' && (
        <Button onClick={step.confirm} disabled={step.preview.isFetching} isLoading={busy} keepLabelWhileLoading aria-busy={busy}>
          {t('hosted.billing.switch.confirm', { due: formatMinor(data.amountDue, data.currency, language) })}
        </Button>
      )}
    </div>
  );
}
