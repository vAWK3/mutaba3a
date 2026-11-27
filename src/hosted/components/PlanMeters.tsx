import { useEffect, useState } from 'react';
import { useLanguage, useT } from '../../lib/i18n/core';
import { meterWarns, nextPlanOf, type PlanUsage, type StarterMeter } from '../data/planUsage';
import { formatDay, formatInstant } from '../format/dates';
import { UpgradeTo } from './PlanLimitNotice';

/** The meters count by the Asia/Jerusalem month (MUT-735), so the gift's end is that month's first day there. */
const METER_ZONE = 'Asia/Jerusalem';

/**
 * MUT-705 / MUT-733 / MUT-754 (wireframe mut-733 "meters", variant A): a plan's monthly meters in Billing. One row per
 * meter: its name, "41 of 50" and a thin bar; from 90% the figure and the bar turn butter and "Upgrade to <next plan>"
 * sits under that meter (never on Firm, never while the gift runs); at the cap "Limit reached"; during the gift "No
 * limit until <date>". The number always carries the meaning; colour only repeats it.
 *
 * Motion (`docs/design/motion/2026-11-27/usage-meter`): the fill grows from inline-start on first paint (600 ms,
 * spring), a later change moves it the same way, and the butter tone follows 250 ms after the fill starts (350 ms) only
 * when a meter crosses 90%. Reduced motion shows the final pose (hosted.css).
 */
export function PlanMeters({ usage, canUpgrade }: { usage: PlanUsage; canUpgrade: boolean }) {
  const t = useT();
  const { language } = useLanguage();
  const next = canUpgrade ? nextPlanOf(usage.plan) : null;
  return (
    <section className="hp-billing-plan hp-plan-meters" aria-labelledby="hp-plan-usage" data-testid="plan-meters">
      <h4 id="hp-plan-usage" className="hp-starter-heading">
        {t('hosted.billing.usage.title')}
      </h4>
      <div className="hp-meter-rows">
        <MeterRow meter={usage.documents} next={next} />
        <MeterRow meter={usage.scans} next={next} />
      </div>
      <p className="hp-starter-fine">{t('hosted.billing.usage.resets', { date: formatDay(usage.resetsOn, language) })}</p>
    </section>
  );
}

function MeterRow({ meter, next }: { meter: StarterMeter; next: ReturnType<typeof nextPlanOf> }) {
  const t = useT();
  const { language } = useLanguage();
  const fill = useGrowOnFirstPaint(Math.min(100, Math.round((meter.used / meter.limit) * 100)));
  const warn = meterWarns(meter);
  const name = t(`hosted.billing.usage.meter.${meter.meter}`);
  const count = t('hosted.billing.usage.ofCap', { used: String(meter.used), cap: String(meter.limit) });
  const status = meter.graceUntil
    ? t('hosted.billing.usage.graceUntil', { date: formatInstant(meter.graceUntil, language, METER_ZONE) })
    : meter.level === 'at_cap'
      ? t('hosted.billing.usage.limitReached')
      : null;
  return (
    <div className="hp-meter-row" data-level={meter.level} data-tone={warn ? 'butter' : undefined} data-grace={meter.graceUntil ? true : undefined} data-testid={`meter-${meter.meter}`}>
      <span className="hp-meter-name">{name}</span>
      {status && <span className="hp-meter-status">{status}</span>}
      <span className="hp-meter-count">
        <bdi>{count}</bdi>
      </span>
      <div className="hp-meter-bar" role="progressbar" aria-label={`${name}, ${count}`} aria-valuemin={0} aria-valuemax={meter.limit} aria-valuenow={meter.used}>
        <span style={{ inlineSize: `${fill}%` }} />
      </div>
      {warn && next && (
        <div className="hp-meter-upgrade">
          <UpgradeTo plan={next} asLink />
        </div>
      )}
    </div>
  );
}

/** The fill starts at 0 and moves to its value on the next frame, so the first paint grows (the spec's first step). */
function useGrowOnFirstPaint(percent: number): number {
  const [painted, setPainted] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setPainted(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  return painted ? percent : 0;
}
