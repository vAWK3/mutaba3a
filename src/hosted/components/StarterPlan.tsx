import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../components/ui/Button';
import { useLanguage, useT } from '../../lib/i18n/core';
import { useTp } from '../../lib/i18n/plural';
import { trackPlanEvent } from '../analytics/portalAnalytics';
import { api, type Me } from '../api/client';
import { BILLING_KEY } from '../data/billingQueries';
import type { ActiveBusinesses, StarterMeter, StarterUsage } from '../data/planUsage';
import { formatDay } from '../format/dates';
import { ME_KEY, useMe } from '../session/me';
import { useAccountDrawers } from '../shell/AccountDrawers';
import { UpgradeToSolo } from './PlanLimitNotice';
import { useToast } from './Toast';

/**
 * MUT-731 (ADR-284, wireframes 1, 3, 4): the free Starter plan's pieces. Billing's "This month" meters, the plan's
 * lines and the active business; the pick-your-business list (shared by the blocking dialog and Billing's Change);
 * and Continue free on Starter (the read-only banner after a cancel, and Billing).
 */



/** One meter: "2 of 3 documents", its bar, and from 80% what is left (butter, wireframe 1). */
export function UsageMeter({ meter }: { meter: StarterMeter }) {
  const t = useT();
  const label = t(`hosted.billing.usage.${meter.meter}`, { used: String(meter.used), cap: String(meter.limit) });
  return (
    <div className="hp-plan-meter" data-level={meter.level} data-testid={`usage-${meter.meter}`}>
      <span>{label}</span>
      <div className="hp-progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={meter.limit} aria-valuenow={meter.used}>
        <span style={{ inlineSize: `${Math.min(100, Math.round((meter.used / meter.limit) * 100))}%` }} />
      </div>
      {meter.level !== 'ok' && (
        <p className="hp-plan-meter-left">
          <LeftLine meter={meter} />
        </p>
      )}
    </div>
  );
}

/** "1 document left this month" / "No documents left this month". */
export function LeftLine({ meter }: { meter: Pick<StarterMeter, 'meter' | 'left'> }): string {
  const t = useT();
  const tp = useTp();
  if (meter.left <= 0) return t(meter.meter === 'documents' ? 'hosted.billing.usage.documentsUsedUp' : 'hosted.billing.usage.scansUsedUp');
  return tp(meter.meter === 'documents' ? 'hosted.billing.usage.documentsLeft' : 'hosted.billing.usage.scansLeft', meter.left);
}

/** Billing's Starter body: this month's meters (Upgrade from 90%), the plan's lines, and the active business. */
export function StarterBilling({ usage, activeBusinesses, canUpgrade, onChangeActive }: { usage: StarterUsage; activeBusinesses: ActiveBusinesses | null; canUpgrade: boolean; onChangeActive: () => void }) {
  const t = useT();
  const { language } = useLanguage();
  const nudge = [usage.documents, usage.scans].some((m) => m.level === 'nudge' || m.level === 'at_cap');
  return (
    <>
      <section className="hp-billing-plan" aria-labelledby="hp-starter-usage">
        <h4 id="hp-starter-usage" className="hp-starter-heading">
          {t('hosted.billing.usage.title')}
        </h4>
        <UsageMeter meter={usage.documents} />
        <UsageMeter meter={usage.scans} />
        <p className="hp-starter-fine">{t('hosted.billing.usage.resets', { date: formatDay(usage.resetsOn, language) })}</p>
        {nudge && canUpgrade && (
          <div>
            <UpgradeToSolo size="sm" />
          </div>
        )}
      </section>
      <section className="hp-billing-plan" aria-labelledby="hp-starter-plan">
        <h4 id="hp-starter-plan" className="hp-starter-heading">
          {t('hosted.plan.name.starter')}
        </h4>
        <p className="hp-starter-fine">{t('hosted.plan.starter.includes')}</p>
        <p className="hp-starter-fine">{t('hosted.plan.starter.monthly')}</p>
        <p className="hp-starter-fine">{t('hosted.plan.starter.taxAuthority')}</p>
      </section>
      {activeBusinesses && <ActiveBusinessRows activeBusinesses={activeBusinesses} onChange={onChangeActive} />}
    </>
  );
}

function ActiveBusinessRows({ activeBusinesses, onChange }: { activeBusinesses: ActiveBusinesses; onChange: () => void }) {
  const t = useT();
  const { profiles } = useMe();
  const nameOf = (id: string) => profiles.find((p) => p.id === id)?.name ?? '';
  return (
    <section className="hp-billing-plan hp-billing-profiles" aria-labelledby="hp-starter-active">
      <h4 id="hp-starter-active">{t('hosted.billing.starter.activeBusiness')}</h4>
      <ul>
        {activeBusinesses.active.map((id) => (
          <li key={id}>
            <bdi className="hp-starter-active-name">{nameOf(id)}</bdi>
            <button type="button" className="hp-link-button" onClick={onChange}>
              {t('hosted.billing.starter.changeActive')}
            </button>
          </li>
        ))}
        {activeBusinesses.readOnly.map((id) => (
          <li key={id}>
            <bdi>{nameOf(id)}</bdi>
            <span className="hp-billing-chip hp-billing-chip-rose">{t('hosted.billing.chip.readOnly')}</span>
          </li>
        ))}
        {activeBusinesses.active.length === 0 && (
          <li>
            <button type="button" className="hp-link-button" onClick={onChange}>
              {t('hosted.billing.pickActive.choose')}
            </button>
          </li>
        )}
      </ul>
    </section>
  );
}

/** Choosing the active business: refetches /v1/me and Billing, so the gate's answer and the screens agree. */
export function useChooseActiveBusiness() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (organizationId: string) => api.setActiveBusinesses([organizationId]),
    onSuccess: () => Promise.all([queryClient.invalidateQueries({ queryKey: ME_KEY }), queryClient.invalidateQueries({ queryKey: BILLING_KEY })]),
  });
}

/**
 * Wireframe 3: one radio per business, nothing chosen first (Basel Q5), then "Keep ‹name› active". `onDone` after the
 * server agreed. `idle` labels the button before a choice.
 */
export function PickActiveBusiness({ businesses, onDone, titleId }: { businesses: Me['profiles']; onDone?: () => void; titleId: string }) {
  const t = useT();
  const groupId = useId();
  const [picked, setPicked] = useState<string | null>(null);
  const choose = useChooseActiveBusiness();
  const chosen = businesses.find((b) => b.id === picked) ?? null;
  return (
    <div className="hp-pick-business">
      <p>{t('hosted.billing.pickActive.body')}</p>
      <div className="hp-pick-list" role="radiogroup" aria-labelledby={titleId}>
        {businesses.map((b) => (
          <label key={b.id} className="hp-pick-row" data-testid="pick-business">
            <input type="radio" name={groupId} value={b.id} checked={picked === b.id} onChange={() => setPicked(b.id)} />
            <bdi className="hp-pick-name">{b.name}</bdi>
          </label>
        ))}
      </div>
      <p className="hp-starter-fine">
        {t('hosted.billing.pickActive.personal')} {t('hosted.billing.pickActive.later')}
      </p>
      {choose.isError && (
        <p className="hp-field-error" role="alert">
          {t('hosted.billing.states.loadFailed')}
        </p>
      )}
      <div className="hp-pick-actions">
        <SeePlans />
        <Button
          variant="primary"
          disabled={!chosen}
          isLoading={choose.isPending}
          keepLabelWhileLoading
          data-testid="pick-business-confirm"
          onClick={() => chosen && choose.mutate(chosen.id, { onSuccess: () => onDone?.() })}
        >
          {chosen ? t('hosted.billing.pickActive.confirm', { name: chosen.name }) : t('hosted.billing.pickActive.choose')}
        </Button>
      </div>
    </div>
  );
}

/**
 * Basel (13554 #6): "See plans" on the pick screen (Business keeps 3); Upgrade to Solo everywhere else. It opens
 * Billing's Subscribe step (MUT-705's plan picker replaces it); the blocking dialog steps aside while that is open.
 */
function SeePlans() {
  const t = useT();
  const drawers = useAccountDrawers();
  return (
    <button type="button" className="hp-link-button" onClick={() => drawers.openBilling('subscribe')}>
      {t('hosted.billing.starter.seePlans')}
    </button>
  );
}

/**
 * Wireframe 4: "Continue free on Starter" after a cancel. With one business the toast says so; with more the
 * blocking pick dialog follows on its own (/v1/me says mustChoose).
 */
export function ContinueFreeOnStarter({ size, variant = 'secondary' }: { size?: 'sm'; variant?: 'primary' | 'secondary' }) {
  const t = useT();
  const toast = useToast();
  const queryClient = useQueryClient();
  const choose = useMutation({
    mutationFn: () => api.chooseStarter(),
    onSuccess: async () => {
      trackPlanEvent('starter_continue_chosen');
      await Promise.all([queryClient.invalidateQueries({ queryKey: ME_KEY }), queryClient.invalidateQueries({ queryKey: BILLING_KEY })]);
      const me = queryClient.getQueryData<Me>(ME_KEY);
      if (!me?.plan?.businesses?.mustChoose) toast(t('hosted.billing.starter.chosen'));
    },
  });
  return (
    <Button variant={variant} size={size} isLoading={choose.isPending} keepLabelWhileLoading onClick={() => choose.mutate()} data-testid="continue-starter">
      {t('hosted.lapse.continueStarter')}
    </Button>
  );
}
