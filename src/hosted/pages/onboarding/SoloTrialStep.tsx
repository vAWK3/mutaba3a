import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '../../../components/ui/Button';
import { useLanguage, useT } from '../../../lib/i18n/core';
import { api } from '../../api/client';
import { LanguageSwitch, Wordmark } from '../../components/Brand';
import { formatDay } from '../../format/dates';
import { ME_KEY } from '../../session/me';

/**
 * MUT-731 (ADR-284, wireframe 5, Basel Q7 and 13554 #2, #4, #7): the one-time 14-day Solo trial, card up front, in a new
 * account's web onboarding (a phone sign-up sees it on its first web visit). The four facts that differ, the card
 * terms with the first-charge date, "Offered only now", and the two buttons Basel named, same size. No close: skipping
 * is choosing Starter. Shown once: the server records it as offered as soon as it shows (POST …/solo-trial/offered).
 *
 * Dark until Solo can be bought: AuthGate shows it only while `SOLO_TRIAL_CHECKOUT` is on and the server offers it
 * (SOLO_TRIAL_OFFER_SINCE). TODO(MUT-702 Part B): Try Solo starts Checkout with `{ plan: 'solo', trial: true }` and
 * the "Then {price} a month" line reads Solo's price from the live price list; until then neither exists, so the line
 * is left out rather than showing a placeholder price.
 */
export const SOLO_TRIAL_CHECKOUT = false;

const TRIAL_DAYS = 14;

export function SoloTrialStep({ soloMonthly }: { soloMonthly?: string | null }) {
  const t = useT();
  const { language } = useLanguage();
  const titleId = useId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const recorded = useRef(false);
  useEffect(() => {
    if (recorded.current) return;
    recorded.current = true;
    void api.soloTrialOffered().catch(() => undefined);
  }, []);
  // The first charge falls on the trial's end; read once when the step shows.
  const [firstCharge] = useState(() => new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  const done = () => queryClient.invalidateQueries({ queryKey: ME_KEY });
  const rows: Array<[string, string, string]> = [
    ['hosted.onboarding.trial.businesses', '1', '1'],
    ['hosted.onboarding.trial.documents', '3', '50'],
    ['hosted.onboarding.trial.scans', '12', '100'],
    ['hosted.onboarding.trial.taxAuthority', '—', '✓'],
  ];
  return (
    <div className="hp-signin">
      <div className="hp-signin-top">
        <LanguageSwitch />
      </div>
      <main className="hp-signin-body">
        <Wordmark />
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
              {rows.map(([key, starter, solo]) => (
                <tr key={key}>
                  <th scope="row">{t(key)}</th>
                  <td>
                    <bdi>{starter}</bdi>
                  </td>
                  <td>
                    <bdi>{solo}</bdi>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hp-starter-fine">
            {t('hosted.onboarding.trial.card', { date: formatDay(firstCharge, language) })}
            {soloMonthly ? ` ${t('hosted.onboarding.trial.then', { price: soloMonthly })}` : ''}
          </p>
          <p className="hp-trial-once">{t('hosted.onboarding.trial.once')}</p>
          <div className="hp-trial-actions">
            <Button
              variant="primary"
              onClick={() => {
                // TODO(MUT-702 Part B): api.startCheckout({ plan: 'solo', trial: true, … }) instead of Billing's Subscribe step.
                void done();
                void navigate({ to: '/', search: { billing: true, step: 'subscribe' } } as never);
              }}
            >
              {t('hosted.onboarding.trial.start')}
            </Button>
            <Button variant="secondary" onClick={() => void done()} data-testid="solo-trial-skip">
              {t('hosted.onboarding.trial.skip')}
            </Button>
          </div>
        </section>
      </main>
    </div>
  );
}
