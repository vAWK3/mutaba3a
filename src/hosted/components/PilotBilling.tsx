import { useLanguage, useT } from '../../lib/i18n/core';
import { useTp } from '../../lib/i18n/plural';
import type { BillingOverview } from '../api/client';
import { useLimitsLine } from '../data/billingPlans';
import { pilotCurrencyOf, type BillingPilot } from '../data/pilot';
import type { UsageLine, UsageLines } from '../data/usageLines';
import { formatDay } from '../format/dates';
import { SUPPORT_EMAIL } from '../terms';
import { Amount } from './billingParts';
import { sentence } from './billingText';

/**
 * MUT-753 (plan T2, design review 1A, 2A, 2B, 6A): the Pilot panel's body under its status: this month's limits,
 * the three plans with their Expected price and limits (from `pilot.plans`, never written here), and one "Write to
 * us" link last. Minimal copy: numbers, labels, one action. Nothing here refuses or upsells (NOT in scope).
 */
export function PilotBilling({ billing, pilot, usage, onWriteToUs }: { billing: BillingOverview; pilot: BillingPilot; usage: UsageLines | null; onWriteToUs?: () => void }) {
  const t = useT();
  return (
    <>
      {usage && usage.lines.length > 0 && <PlanUsageLines usage={usage} titleId="hp-pilot-usage" />}
      {pilot.plans.length > 0 && <PilotPlans billing={billing} pilot={pilot} />}
      <div>
        <a className="hp-pilot-write" href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(t('hosted.billing.pilot.mailSubject'))}`} onClick={onWriteToUs} data-testid="pilot-write-to-us">
          {t('hosted.billing.pilot.writeToUs')}
        </a>
      </div>
    </>
  );
}

/**
 * MUT-753 (plan T3), shared: a paid plan's usage lines, "12 of 250 documents" with a bar, butter from 90% (2B), the
 * partners each business may have, and when the month starts again. Each line reads as one sentence to a screen
 * reader; the number always shows beside its tone, so colour never carries the meaning alone.
 */
export function PlanUsageLines({ usage, titleId }: { usage: UsageLines; titleId: string }) {
  const t = useT();
  const tp = useTp();
  const { language } = useLanguage();
  return (
    <section className="hp-billing-plan" aria-labelledby={titleId} data-testid="plan-usage-lines">
      <h4 id={titleId} className="hp-starter-heading">
        {t('hosted.billing.usage.title')}
      </h4>
      {usage.lines.map((line) => (
        <UsageLineRow key={line.key} line={line} />
      ))}
      {usage.partnersPerBusiness !== null && <p className="hp-starter-fine">{tp('hosted.billing.pilot.partners', usage.partnersPerBusiness)}</p>}
      <p className="hp-starter-fine">{t('hosted.billing.usage.resets', { date: formatDay(usage.resetsOn, language) })}</p>
    </section>
  );
}

function UsageLineRow({ line }: { line: UsageLine }) {
  const t = useT();
  const key = line.key === 'businesses' ? 'hosted.billing.pilot.businesses' : `hosted.billing.usage.${line.key}`;
  const label = t(key, { used: String(line.used), cap: String(line.cap) });
  return (
    <div className="hp-plan-meter" data-attention={line.attention || undefined} data-testid={`usage-line-${line.key}`}>
      <span>{label}</span>
      <div className="hp-progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={line.cap} aria-valuenow={Math.min(line.used, line.cap)}>
        <span style={{ inlineSize: `${line.percent}%` }} />
      </div>
    </div>
  );
}

function PilotPlans({ billing, pilot }: { billing: BillingOverview; pilot: BillingPilot }) {
  const t = useT();
  const { language } = useLanguage();
  const limits = useLimitsLine();
  const currency = pilotCurrencyOf(billing, pilot.plans);
  return (
    <section className="hp-billing-plan" aria-labelledby="hp-pilot-plans" data-testid="pilot-plans">
      <h4 id="hp-pilot-plans" className="hp-starter-heading">
        {t('hosted.billing.pilot.plansTitle')}
      </h4>
      <ul className="hp-pilot-plans">
        {pilot.plans.map((plan) => {
          const price = plan.expectedMonthly[currency];
          return (
            <li key={plan.plan} className="hp-pilot-plan" data-current={plan.plan === 'business' || undefined} data-testid={`pilot-plan-${plan.plan}`}>
              <span className="hp-pilot-plan-name">
                {t(`hosted.plan.name.${plan.plan}`)}
                {plan.plan === 'business' && <span className="hp-billing-chip hp-billing-chip-lavender">{t('hosted.billing.chip.pilot')}</span>}
              </span>
              {price !== null && (
                <span className="hp-pilot-plan-price">
                  {pilot.pricesExpected && <span className="hp-pilot-expected">{t('hosted.billing.pilot.expected')}</span>}{' '}
                  {sentence(t, 'hosted.billing.plans.perMonth', { price: <Amount minor={price} currency={currency} language={language} /> })}
                </span>
              )}
              <span className="hp-starter-fine">{limits(plan.limits)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
