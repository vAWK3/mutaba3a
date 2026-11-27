import { useId, useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { useLanguage, useT } from '../../lib/i18n/core';
import type { BillingOverview, PlanChangePreview, PlanChangeResult, PlanChangeTarget } from '../api/client';
import type { Language } from '../../lib/i18n/types';
import { useLocation } from '@tanstack/react-router';
import { assertStripeUrl, billingReturnPath, stripeNavigation, useOpenBillingPortal } from '../data/billingQueries';
import { useLimitsLine } from '../data/billingPlans';
import { pendingChangeOf, scheduledChangeOf, UNDO_COLLAPSE_MS, useUndoPlanChange, type ChangePlanState } from '../data/planChangeQueries';
import { formatInstant } from '../format/dates';
import { browserTimezone } from '../format/timezones';
import { Amount, Banner } from './billingParts';
import { formatMinor } from './billingText';
import { BusinessChecklist } from './BusinessChecklist';
import { Scene } from './Scene';
import { useToast } from './Toast';

/**
 * MUT-734 (wireframe mut-734, variant A on every screen): Billing's Change plan pane, the scheduled line with Undo, and
 * the upgrade's done pane. The list and the picked plan's preview share one pane; the preview's main figure is the
 * amount charged now (up) or the day the change happens (down, to Starter), and a downgrade below the businesses owned
 * asks which stay active (checkboxes, "N of N"). Copy is data only (DESIGN.md › Copy).
 */

type Interval = 'month' | 'year';
const day = (iso: string, language: Language) => formatInstant(iso, language, browserTimezone());

function usePlanName() {
  const t = useT();
  return (plan: string) => t(`hosted.plan.name.${plan.toLowerCase()}`);
}

/** The pane's body: the plan list, then the picked plan's preview under it. */
export function ChangePlanBody({ billing, flow }: { billing: BillingOverview; flow: ChangePlanState }) {
  const t = useT();
  const name = usePlanName();
  const limits = useLimitsLine();
  const { language } = useLanguage();
  const group = useId();
  const currency = (billing.subscription?.currency?.toUpperCase() === 'USD' ? 'USD' : 'ILS') as 'ILS' | 'USD';
  const interval: Interval = billing.subscription?.interval === 'year' ? 'year' : 'month';
  const priceOf = (plan: PlanChangeTarget) => {
    if (plan === 'starter') return t('hosted.billing.change.free');
    const pair = billing.plans?.find((p) => p.plan === plan)?.catalog[currency];
    return pair ? t(interval === 'month' ? 'hosted.billing.plans.perMonth' : 'hosted.billing.change.perYear', { price: formatMinor(pair[interval], currency, language) }) : '';
  };
  const limitsOf = (plan: PlanChangeTarget) => {
    if (plan === 'starter') return t('hosted.plan.starter.monthly');
    const offered = billing.plans?.find((p) => p.plan === plan);
    return offered ? limits(offered.limits) : '';
  };
  const ladder: PlanChangeTarget[] = ['starter', 'solo', 'business', 'firm'];
  return (
    <div className="hp-billing hp-change-plan" data-testid="change-plan">
      {flow.failure && <ChangeFailureBanner failure={flow.failure} />}
      <div className="hp-change-list" role="radiogroup" aria-labelledby={group}>
        <span id={group} className="sr-only">
          {t('hosted.billing.change.title')}
        </span>
        {ladder.map((plan) => {
          const current = plan === flow.from;
          const allowed = flow.targets.includes(plan);
          return (
            <label key={plan} className="hp-change-row" data-current={current || undefined} data-testid={`change-row-${plan}`}>
              <input type="radio" name={group} value={plan} checked={flow.picked === plan} disabled={!allowed} onChange={() => flow.pick(plan)} />
              <span className="hp-change-row-text">
                <span className="hp-change-row-name">
                  {name(plan)}
                  {current && (
                    <Badge variant="neutral" size="sm">
                      {t('hosted.billing.change.current')}
                    </Badge>
                  )}
                </span>
                <span className="hp-change-row-limits">{limitsOf(plan)}</span>
              </span>
              <span className="hp-change-row-price">{priceOf(plan)}</span>
            </label>
          );
        })}
      </div>
      {flow.picked && <PreviewCard flow={flow} />}
    </div>
  );
}

/** The picked plan's preview: the amount charged now, or "<plan> from <date>" and the businesses that stay active. */
function PreviewCard({ flow }: { flow: ChangePlanState }) {
  const t = useT();
  const name = usePlanName();
  const limits = useLimitsLine();
  const { language } = useLanguage();
  const data = flow.data;
  if (flow.preview.isError) return <Banner tone="error" text={t('hosted.billing.states.loadFailed')} />;
  if (!data) return <div className="hp-change-preview hp-billing-skeleton hp-billing-skeleton-headline" aria-busy="true" />;
  const limitsLine = data.plan === 'starter' ? t('hosted.plan.starter.monthly') : limits(data.limits);
  if (data.kind === 'upgrade') {
    const due = (data.currency.toUpperCase() === 'USD' ? 'USD' : 'ILS') as 'ILS' | 'USD';
    return (
      <div className="hp-change-preview" aria-live="polite" data-testid="change-preview">
        <span className="hp-change-preview-label">{t('hosted.billing.change.chargedNow')}</span>
        <span className="hp-change-preview-figure">
          <Amount minor={data.amountDue} currency={due} language={language} />
        </span>
        <p className="hp-starter-fine">{limitsLine}</p>
        {/* MUT-703's seam (offers plan §11.6): one line here for the preview's `offerEnds`; none today. */}
      </div>
    );
  }
  return (
    <>
      <div className="hp-change-preview" aria-live="polite" data-testid="change-preview">
        <span className="hp-change-preview-figure hp-change-preview-date">{t('hosted.billing.change.fromDate', { plan: name(data.plan), date: day(data.effectiveAt, language) })}</span>
        <p className="hp-starter-fine">{limitsLine}</p>
      </div>
      {data.mustChoose && (
        <BusinessChecklist
          businesses={data.businesses}
          cap={data.cap}
          chosen={flow.keep}
          onChange={flow.setKeep}
          offLabel={t('hosted.billing.change.readOnlyFrom', { date: day(data.effectiveAt, language) })}
        />
      )}
    </>
  );
}

/** A refused confirm: the card declined (and another card through Stripe's page), a stale amount, or anything else. */
function ChangeFailureBanner({ failure }: { failure: NonNullable<ChangePlanState['failure']> }) {
  const t = useT();
  const { pathname } = useLocation();
  const portal = useOpenBillingPortal();
  return (
    <>
      <Banner tone={failure === 'changed' ? 'info' : 'error'} text={t(`hosted.billing.change.failure.${failure}`)} />
      {failure === 'declined' && (
        <div>
          <Button variant="secondary" isLoading={portal.isPending} keepLabelWhileLoading onClick={() => portal.mutate({ returnPath: billingReturnPath(pathname), flow: 'card' })}>
            {t('hosted.billing.change.otherCard')}
          </Button>
        </div>
      )}
    </>
  );
}

/** The pane's footer: Cancel and Pay <amount> (up) or Confirm (down, off until the businesses are picked). */
export function ChangePlanFooter({ flow, onBack }: { flow: ChangePlanState; onBack: () => void }) {
  const t = useT();
  const { language } = useLanguage();
  const data: PlanChangePreview | undefined = flow.data;
  const label =
    data?.kind === 'upgrade'
      ? t('hosted.billing.change.pay', { amount: formatMinor(data.amountDue, data.currency.toUpperCase() === 'USD' ? 'USD' : 'ILS', language) })
      : t('hosted.billing.change.confirm');
  return (
    <div className="drawer-footer-right">
      <Button variant="secondary" onClick={onBack} disabled={flow.confirm.isPending}>
        {t('common.cancel')}
      </Button>
      <Button onClick={flow.submit} disabled={!flow.ready || flow.confirm.isPending} isLoading={flow.confirm.isPending} keepLabelWhileLoading data-testid="change-confirm">
        {label}
      </Button>
    </div>
  );
}

/**
 * After Confirm on an upgrade (wireframe A): applied → the `plan-upgraded` scene with its motion and the new plan; the
 * bank holding the charge → "Waiting for the payment" with Stripe's page; null otherwise.
 */
export function ChangeDoneBody({ result }: { result: PlanChangeResult }) {
  const t = useT();
  const name = usePlanName();
  if (result.state === 'pending') {
    const url = stripeUrlOrNull(result.hostedInvoiceUrl);
    return (
      <div className="hp-billing">
        <Banner tone="info" text={t('hosted.billing.change.pending', { plan: name(result.change.toPlan) })} />
        {url && (
          <div>
            <Button onClick={() => stripeNavigation.assign(url)}>{t('hosted.billing.change.completePayment')}</Button>
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="hp-billing hp-change-done" data-testid="plan-upgraded">
      <Scene name="plan-upgraded" size={160} motion="plan-upgraded" />
      <h3 className="hp-billing-headline" tabIndex={-1}>
        {t('hosted.billing.change.upgraded', { plan: name(result.change.toPlan) })}
      </h3>
    </div>
  );
}

function stripeUrlOrNull(url: string | null): string | null {
  if (!url) return null;
  try {
    assertStripeUrl(url);
    return url;
  } catch {
    return null;
  }
}

/**
 * Billing's scheduled change (wireframe "sched" A): the `change-scheduled` scene, a "Scheduled" chip, "<plan> from
 * <date>" and Undo. Undo collapses the line (350 ms, undo-toast spec) and says what renews; a pending upgrade shows
 * "Waiting for the payment · <plan>" instead.
 */
export function ScheduledChangeLine({ billing }: { billing: BillingOverview }) {
  const t = useT();
  const name = usePlanName();
  const { language } = useLanguage();
  const toast = useToast();
  const undo = useUndoPlanChange();
  const [leaving, setLeaving] = useState(false);
  const scheduled = scheduledChangeOf(billing);
  const pending = pendingChangeOf(billing);
  if (pending) return <Banner tone="info" text={t('hosted.billing.change.pending', { plan: name(pending.plan) })} />;
  if (!scheduled) return null;
  const renews = billing.subscription?.currentPeriodEnd;
  const takeBack = () =>
    undo.mutate(undefined, {
      onSuccess: () => {
        setLeaving(true);
        setTimeout(() => toast(t('hosted.billing.change.undone', { plan: name(billing.currentPlan ?? 'solo'), date: renews ? day(renews, language) : '' }), { tone: 'info' }), UNDO_COLLAPSE_MS);
      },
    });
  return (
    <div className="hp-scheduled" data-leaving={leaving || undefined} data-testid="scheduled-change">
      <div className="hp-scheduled-inner">
        <Scene name="change-scheduled" size={120} />
        <p className="hp-scheduled-line">
          <span className="hp-billing-chip hp-billing-chip-lavender">{t('hosted.billing.change.scheduled')}</span>
          <span>{t('hosted.billing.change.fromDate', { plan: name(scheduled.plan), date: day(scheduled.at, language) })}</span>
          <button type="button" className="hp-link-button press" onClick={takeBack} disabled={undo.isPending || leaving}>
            {t('hosted.billing.change.undo')}
          </button>
        </p>
        {undo.isError && <Banner tone="error" text={t('hosted.billing.states.loadFailed')} />}
      </div>
    </div>
  );
}
