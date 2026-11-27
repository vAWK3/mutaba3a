import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '../../components/ui/Button';
import { useLanguage, useT } from '../../lib/i18n/core';
import { useTp } from '../../lib/i18n/plural';
import { trackPlanEvent } from '../analytics/portalAnalytics';
import { billingQuery } from '../data/billingQueries';
import { usePlanPrice } from '../data/billingPlans';
import { sellablePlanOf, upgradeOffered, type PlanLimit, type SellablePlan } from '../data/planUsage';
import { formatDay } from '../format/dates';
import { useMeOrNull } from '../session/me';
import { useIsLocalMode } from '../session/mode';
import { useAccountDrawers } from '../shell/AccountDrawers';
import { AlertIcon } from './Icons';

/**
 * MUT-731 (ADR-284, wireframe 2) and MUT-705: a plan's limit reached, from a 409 PLAN_LIMIT or from the usage the portal
 * already holds. The limit, the day it resets, and Upgrade to <next plan> with that plan's price (only where a plan can
 * be bought here). Butter (warning), not rose: a limit is not an error. The `hp-banner` recipe the lapse banner uses,
 * so no new styles. `onByHand`: a scan's refusal offers to add the expense by hand. `withUpgrade` false when the
 * drawer's own primary button is the upgrade (the Issue drawer at the cap).
 */
export function PlanLimitNotice({ limit, onByHand, withUpgrade = true }: { limit: PlanLimit; onByHand?: () => void; withUpgrade?: boolean }) {
  const t = useT();
  const { language } = useLanguage();
  const me = useMeOrNull();
  const next = sellablePlanOf(limit.nextPlan);
  const upgrade = withUpgrade && upgradeOffered(limit) && next !== null;
  const current = me?.plan?.current ?? null;
  useEffect(() => {
    trackPlanEvent('plan_cap_reached', { limit: analyticsLimit(limit.limit), plan: current ?? 'starter' });
    if (upgradeOffered(limit)) trackPlanEvent('plan_upgrade_offered', { limit: analyticsLimit(limit.limit) });
  }, [limit, current]);
  const monthly = limit.limit === 'documents' || limit.limit === 'scans';
  return (
    <section className="hp-banner hp-banner-warning hp-lapse-banner" role="alert" data-testid="plan-limit-notice" data-limit={limit.limit}>
      <AlertIcon />
      <div className="hp-lapse-banner-body">
        <p className="hp-lapse-banner-title">
          <LimitTitle limit={limit} plan={current} />
        </p>
        {monthly && limit.resetsOn && <p>{t(`hosted.planLimit.${limit.limit}.body`, { date: formatDay(limit.resetsOn, language) })}</p>}
        {upgrade && <NextPlanLine plan={next} />}
        {(upgrade || onByHand) && (
          <div className="hp-lapse-banner-actions">
            {onByHand && (
              <Button variant="secondary" size="sm" onClick={onByHand}>
                {t('hosted.planLimit.scans.byHand')}
              </Button>
            )}
            {upgrade && <UpgradeTo plan={next} size="sm" />}
          </div>
        )}
      </div>
    </section>
  );
}

/** Starter keeps its own titles (MUT-731); a paid plan names itself and the number it includes (MUT-705). */
function LimitTitle({ limit, plan }: { limit: PlanLimit; plan: string | null }): string {
  const t = useT();
  const tp = useTp();
  const monthly = limit.limit === 'documents' || limit.limit === 'scans';
  const paid = sellablePlanOf(plan);
  if (!paid || limit.cap === undefined) {
    return monthly ? t(`hosted.planLimit.${limit.limit}.title`) : t('hosted.planLimit.businesses.title');
  }
  const name = t(`hosted.plan.name.${paid}`);
  if (monthly) return t('hosted.planLimit.reached', { usage: t(`hosted.billing.usage.${limit.limit}`, { used: String(limit.used ?? limit.cap), cap: String(limit.cap) }) });
  return t('hosted.planLimit.includes', { plan: name, items: tp('hosted.billing.plans.businesses', limit.cap) });
}

/** "Business · ₪89.00 a month" (the next plan and its price), from GET /v1/billing `plans`; nothing while it loads. */
function NextPlanLine({ plan }: { plan: SellablePlan }) {
  const t = useT();
  const local = useIsLocalMode();
  const billing = useQuery({ ...billingQuery, enabled: !local });
  const price = usePlanPrice();
  const offered = billing.data?.plans?.find((p) => p.plan === plan);
  const line = offered ? price(offered, savedCountryOf(billing.data)) : null;
  if (!line) return null;
  return (
    <p className="hp-starter-fine" data-testid="next-plan-line">
      {t(`hosted.plan.name.${plan}`)} · {line}
    </p>
  );
}

function savedCountryOf(billing: { billingAddress?: unknown } | undefined): string | null {
  const address = billing?.billingAddress as { country?: string } | null | undefined;
  return address?.country ?? null;
}

/**
 * MUT-705: Upgrade to <plan>. Billing's Subscribe step opened on that plan; for a subscriber, Billing itself, where the
 * plan is changed (MUT-734). Counted as chosen (anonymous, opt-in). `asLink`: a text button inside a quiet line.
 */
export function UpgradeTo({ plan, size, variant = 'primary', asLink = false }: { plan: SellablePlan; size?: 'sm'; variant?: 'primary' | 'secondary'; asLink?: boolean }) {
  const t = useT();
  const drawers = useAccountDrawers();
  const me = useMeOrNull();
  const from = me?.plan?.current ?? 'starter';
  const subscribed = from === 'solo' || from === 'business' || from === 'firm' || from === 'freelancer';
  const upgrade = () => {
    trackPlanEvent('plan_upgrade_chosen', { from, to: plan });
    if (subscribed) drawers.openBilling();
    else drawers.openUpgrade(plan);
  };
  const label = t('hosted.planLimit.upgradeTo', { plan: t(`hosted.plan.name.${plan}`) });
  if (asLink) {
    return (
      <button type="button" className="hp-link-button" onClick={upgrade}>
        {label}
      </button>
    );
  }
  return (
    <Button variant={variant} size={size} onClick={upgrade}>
      {label}
    </Button>
  );
}

/** MUT-731's Upgrade to Solo, kept for the Starter screens: the same button, on Solo. */
export function UpgradeToSolo(props: { size?: 'sm'; variant?: 'primary' | 'secondary'; asLink?: boolean }) {
  return <UpgradeTo plan="solo" {...props} />;
}

/** The contract's names (docs/analytics/events.json): snake case. */
function analyticsLimit(limit: PlanLimit['limit']): string {
  return limit === 'taxAuthority' ? 'tax_authority' : limit;
}
