import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../../components/ui/Button';
import { useLanguage, useT } from '../../../lib/i18n/core';
import { api } from '../../api/client';
import { trackPortal } from '../../analytics/portalAnalytics';
import { LanguageSwitch, Wordmark } from '../../components/Brand';
import { BillingAddressFields } from '../../components/BillingPlanPicker';
import { addressOf, draftOf, EMPTY_ADDRESS, monthlyPriceOf, savedAddressOf, type AddressDraft } from '../../data/billingPlans';
import { billingQuery, useStartCheckout } from '../../data/billingQueries';
import { formatDay } from '../../format/dates';
import { ME_KEY } from '../../session/me';

/**
 * MUT-731 (ADR-284, wireframe 5, Basel Q7 and 13554 #2, #4, #7): the one-time 14-day Solo trial, card up front, in a new
 * account's web onboarding (a phone sign-up sees it on its first web visit). The four facts that differ, the card
 * terms with the first-charge date, "Offered only now", and the two buttons Basel named, same size. No close: skipping
 * is choosing Starter. Shown once: the server records it as offered as soon as it shows (POST …/solo-trial/offered).
 *
 * MUT-702 Part B (ADR-288, wireframes v3): the "Then … a month" line reads Solo's live price (both currencies, as the
 * country isn't known yet). Try Solo asks the billing address next, then opens Checkout for Solo with `trial: true`.
 * Dark until Solo can be bought: AuthGate shows it only while `SOLO_TRIAL_CHECKOUT` is on and the server offers it
 * (SOLO_TRIAL_OFFER_SINCE).
 */
export const SOLO_TRIAL_CHECKOUT = false;

const TRIAL_DAYS = 14;
export function SoloTrialStep() {
  const t = useT();
  const { language } = useLanguage();
  const titleId = useId();
  const ids = useId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const billing = useQuery(billingQuery);
  const checkout = useStartCheckout();
  const recorded = useRef(false);
  useEffect(() => {
    if (recorded.current) return;
    recorded.current = true;
    void api.soloTrialOffered().catch(() => undefined);
    // MUT-737 (AC6): the first-run plan step was shown (once: the server records it as offered).
    void trackPortal('onboarding_plan_shown', {});
  }, []);
  // The first charge falls on the trial's end; read once when the step shows.
  const [firstCharge] = useState(() => new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  const [asking, setAsking] = useState(false);
  const [draft, setDraft] = useState<AddressDraft | null>(null);
  if (draft === null && billing.data) setDraft(draftOf(savedAddressOf(billing.data), language));
  const address = draft ?? EMPTY_ADDRESS;
  const solo = billing.data?.plans?.find((p) => p.plan === 'solo') ?? null;
  const done = () => queryClient.invalidateQueries({ queryKey: ME_KEY });
  const rows: Array<[string, string, string]> = [
    ['hosted.onboarding.trial.businesses', '1', '1'],
    ['hosted.onboarding.trial.documents', '3', '50'],
    ['hosted.onboarding.trial.scans', '12', '100'],
    ['hosted.onboarding.trial.taxAuthority', '—', '✓'],
  ];
  const price = solo ? monthlyPriceOf(solo, asking ? address.country : null, language, t) : null;
  const terms = (
    <p className="hp-starter-fine">
      {t('hosted.onboarding.trial.card', { date: formatDay(firstCharge, language) })}
      {price ? ` ${t('hosted.onboarding.trial.then', { price })}` : ''}
    </p>
  );
  const ready = addressOf(address);
  const start = () => {
    if (!ready) return;
    checkout.mutate({ plan: 'solo', trial: true, interval: 'month', buyer: 'person', country: ready.country, address: ready, returnPath: '/' }, { onSuccess: () => void done() });
  };

  return (
    <div className="hp-signin">
      <div className="hp-signin-top">
        <LanguageSwitch />
      </div>
      <main className="hp-signin-body">
        <Wordmark />
        {asking ? (
          <section className="hp-card hp-signin-card hp-trial-step" aria-labelledby={titleId} data-testid="solo-trial-address">
            <h1 id={titleId}>{t('hosted.billing.address.title')}</h1>
            <BillingAddressFields idPrefix={ids} draft={address} onChange={setDraft} />
            {terms}
            <div className="hp-trial-actions">
              <Button variant="primary" onClick={start} disabled={!ready || checkout.isPending} isLoading={checkout.isPending} keepLabelWhileLoading>
                {t('hosted.billing.subscribe.continue')}
              </Button>
              <Button variant="secondary" onClick={() => setAsking(false)}>
                {t('hosted.onboarding.trial.back')}
              </Button>
            </div>
          </section>
        ) : (
          <section className="hp-card hp-signin-card hp-trial-step" aria-labelledby={titleId} data-testid="solo-trial-step">
            <h1 id={titleId}>{t('hosted.onboarding.trial.title')}</h1>
            <table className="hp-trial-compare">
              <thead>
                <tr>
                  <td />
                  <th scope="col">{t('hosted.plan.name.starter')}</th>
                  <th scope="col">{t('hosted.plan.name.solo')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([key, starter, soloValue]) => (
                  <tr key={key}>
                    <th scope="row">{t(key)}</th>
                    <td>
                      <bdi>{starter}</bdi>
                    </td>
                    <td>
                      <bdi>{soloValue}</bdi>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {terms}
            <p className="hp-trial-once">{t('hosted.onboarding.trial.once')}</p>
            <div className="hp-trial-actions">
              <Button
                variant="primary"
                onClick={() => {
                  void trackPortal('onboarding_plan_chosen', { choice: 'solo' });
                  // Without a Solo price to buy (plans off on this server), Billing's Subscribe step stays the way in.
                  if (solo) setAsking(true);
                  else {
                    void done();
                    void navigate({ to: '/', search: { billing: true, step: 'subscribe' } } as never);
                  }
                }}
              >
                {t('hosted.onboarding.trial.start')}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  void trackPortal('onboarding_plan_chosen', { choice: 'starter' });
                  void done();
                }}
                data-testid="solo-trial-skip"
              >
                {t('hosted.onboarding.trial.skip')}
              </Button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
