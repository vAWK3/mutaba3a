import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLanguage, useT } from '../../lib/i18n/core';
import { billingQuery } from '../data/billingQueries';
import { isSellable } from '../data/billingView';
import { hideNudge, homeNoticeOf, nudgeHidden, nudgeHideKey, starterUsageOf, type StarterMeter } from '../data/planUsage';
import { formatDay } from '../format/dates';
import { useMe } from '../session/me';
import { useIsLocalMode } from '../session/mode';
import { InfoIcon } from './Icons';
import { UpgradeToSolo } from './PlanLimitNotice';
import { LeftLine } from './StarterPlan';

/**
 * MUT-731 (ADR-284, wireframe 7, Basel 13554 #1 and #5): Home speaks for Starter's fuller meter. From 80% one quiet line
 * (the trial line's recipe, no box); from 90% an info banner with Upgrade to Solo and Hide (hidden until the limit);
 * at the limit a quiet line that can't be hidden: what's used up, when it resets, Upgrade. Nothing at `ok`. Billing's
 * query runs only for someone on Starter.
 */
export function UsageNotice() {
  const me = useMe();
  const local = useIsLocalMode();
  if (local || me.plan?.current !== 'starter') return null;
  return <StarterUsageNotice />;
}

function StarterUsageNotice() {
  const t = useT();
  const { language } = useLanguage();
  const billing = useQuery(billingQuery);
  const [, setHidden] = useState(0);
  const usage = starterUsageOf(billing.data);
  const meter = homeNoticeOf(usage, nudgeHidden);
  if (!usage || !meter || !billing.data) return null;
  const resets = t('hosted.billing.usage.resets', { date: formatDay(usage.resetsOn, language) });
  const counted = t('hosted.billing.usage.thisMonth', { usage: t(`hosted.billing.usage.${meter.meter}`, { used: String(meter.used), cap: String(meter.limit) }) });
  const canUpgrade = isSellable(billing.data);

  if (meter.level === 'nudge') {
    return (
      <section className="hp-banner hp-banner-info hp-lapse-banner" aria-label={t('hosted.billing.usage.title')} data-testid="usage-nudge">
        <InfoIcon />
        <div className="hp-lapse-banner-body">
          <p className="hp-lapse-banner-title">
            <LeftLine meter={meter} />
          </p>
          <p className="hp-starter-fine">
            {counted} · {resets}
          </p>
          <div className="hp-lapse-banner-actions">
            {canUpgrade && <UpgradeToSolo size="sm" />}
            <button
              type="button"
              className="hp-link-button"
              onClick={() => {
                hideNudge(nudgeHideKey(usage.resetsOn, meter.meter));
                setHidden((n) => n + 1);
              }}
            >
              {t('hosted.billing.usage.hide')}
            </button>
          </div>
        </div>
      </section>
    );
  }
  return <QuietLine meter={meter} counted={counted} resets={resets} canUpgrade={canUpgrade} />;
}

function QuietLine({ meter, counted, resets, canUpgrade }: { meter: StarterMeter; counted: string; resets: string; canUpgrade: boolean }) {
  const t = useT();
  return (
    <section className="hp-usage-line" data-level={meter.level} aria-label={t('hosted.billing.usage.title')} data-testid={`usage-${meter.level}`}>
      <p>
        {meter.level === 'at_cap' ? <LeftLine meter={meter} /> : counted} · {resets}
        {meter.level === 'at_cap' && canUpgrade && (
          <>
            {' · '}
            <UpgradeToSolo asLink />
          </>
        )}
      </p>
    </section>
  );
}
