import { useEffect } from 'react';
import { Button } from '../../components/ui/Button';
import { useLanguage, useT } from '../../lib/i18n/core';
import { trackPlanEvent } from '../analytics/portalAnalytics';
import { upgradeOffered, type PlanLimit } from '../data/planUsage';
import { formatDay } from '../format/dates';
import { useAccountDrawers } from '../shell/AccountDrawers';
import { AlertIcon } from './Icons';

/**
 * MUT-731 (ADR-284, wireframe 2): a Starter limit reached, from a 409 PLAN_LIMIT or from the usage the portal already
 * holds. The limit, the day it resets, and Upgrade to Solo (only where a plan can be bought here; it opens Billing's
 * Subscribe step until MUT-705's plan picker). Butter (warning), not rose: a limit is not an error. The `hp-banner`
 * recipe the lapse banner uses, so no new styles. `onByHand`: a scan's refusal offers to add the expense by hand.
 * `withUpgrade` false when the drawer's own primary button is the upgrade (the Issue drawer at 3 of 3).
 */
export function PlanLimitNotice({ limit, onByHand, withUpgrade = true }: { limit: PlanLimit; onByHand?: () => void; withUpgrade?: boolean }) {
  const t = useT();
  const { language } = useLanguage();
  const upgrade = withUpgrade && upgradeOffered(limit);
  useEffect(() => {
    trackPlanEvent('plan_cap_reached', { limit: analyticsLimit(limit.limit) });
    if (upgradeOffered(limit)) trackPlanEvent('plan_upgrade_offered', { limit: analyticsLimit(limit.limit) });
  }, [limit]);
  const monthly = limit.limit === 'documents' || limit.limit === 'scans';
  const title = monthly ? t(`hosted.planLimit.${limit.limit}.title`) : t('hosted.planLimit.businesses.title');
  return (
    <section className="hp-banner hp-banner-warning hp-lapse-banner" role="alert" data-testid="plan-limit-notice" data-limit={limit.limit}>
      <AlertIcon />
      <div className="hp-lapse-banner-body">
        <p className="hp-lapse-banner-title">{title}</p>
        {monthly && limit.resetsOn && <p>{t(`hosted.planLimit.${limit.limit}.body`, { date: formatDay(limit.resetsOn, language) })}</p>}
        {(upgrade || onByHand) && (
          <div className="hp-lapse-banner-actions">
            {onByHand && (
              <Button variant="secondary" size="sm" onClick={onByHand}>
                {t('hosted.planLimit.scans.byHand')}
              </Button>
            )}
            {upgrade && <UpgradeToSolo size="sm" />}
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * Upgrade to Solo: Billing's Subscribe step (MUT-705's plan picker replaces it). Counted as chosen (anonymous,
 * opt-in). `asLink`: a text button inside a quiet line (wireframe 7).
 */
export function UpgradeToSolo({ size, variant = 'primary', asLink = false }: { size?: 'sm'; variant?: 'primary' | 'secondary'; asLink?: boolean }) {
  const t = useT();
  const drawers = useAccountDrawers();
  const upgrade = () => {
    trackPlanEvent('plan_upgrade_chosen', { from: 'starter', to: 'solo' });
    drawers.openBilling('subscribe');
  };
  if (asLink) {
    return (
      <button type="button" className="hp-link-button" onClick={upgrade}>
        {t('hosted.planLimit.upgradeSolo')}
      </button>
    );
  }
  return (
    <Button variant={variant} size={size} onClick={upgrade}>
      {t('hosted.planLimit.upgradeSolo')}
    </Button>
  );
}

/** The contract's names (docs/analytics/events.json): snake case. */
function analyticsLimit(limit: PlanLimit['limit']): string {
  return limit === 'taxAuthority' ? 'tax_authority' : limit;
}
