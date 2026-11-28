import { Badge } from '../../../components/ui/Badge';
import { useLanguage, useT } from '../../../lib/i18n/core';
import type { OperatorAccount } from '../../api/client';
import { formatMinor } from '../../components/billingText';
import { RowGroup } from '../../components/YouRows';
import { dayText } from '../../operator/time';

type PlanChangeRow = OperatorAccount['planHistory'][number];

const STATE_TONE: Record<PlanChangeRow['state'], 'success' | 'info' | 'warning' | 'neutral' | 'error'> = {
  APPLIED: 'success',
  SCHEDULED: 'info',
  PENDING: 'warning',
  UNDONE: 'neutral',
  FAILED: 'error',
};

/**
 * MUT-734 (AC12): the person's plan changes, newest first: date, from → to, the kind and its state, and what an upgrade
 * charged. Read from the operator account view's `planHistory` (`billing_plan_changes`).
 */
export function OperatorPlanHistory({ account }: { account: OperatorAccount }) {
  const t = useT();
  const { language } = useLanguage();
  const rows = account.planHistory ?? [];
  const plan = (name: string) => t(`hosted.plan.name.${name.toLowerCase()}`);
  return (
    <RowGroup label={t('hosted.operator.planHistory.title')}>
      {rows.length === 0 && <p className="hp-you-row hp-you-row--note">{t('hosted.operator.planHistory.none')}</p>}
      {rows.map((row) => (
        <div key={row.id} className="hp-you-row hp-operator-profile" data-testid="plan-history-row">
          <span className="hp-you-row-text">
            <span className="hp-you-row-label">
              {plan(row.fromPlan)} → {plan(row.toPlan)}
            </span>
            <small>
              {dayText(row.createdAt, language)} · {t(`hosted.operator.planHistory.kind.${row.kind}`)}
              {row.state === 'SCHEDULED' && <> · {t('hosted.operator.planHistory.on', { date: dayText(row.effectiveAt, language) })}</>}
              {row.amountMinor !== null && row.currency && (
                <>
                  {' · '}
                  <bdi>{formatMinor(row.amountMinor, row.currency as 'ILS' | 'USD', language)}</bdi>
                </>
              )}
            </small>
          </span>
          <span className="hp-operator-chips">
            <Badge variant={STATE_TONE[row.state]} size="sm">
              {t(`hosted.operator.planHistory.state.${row.state}`)}
            </Badge>
          </span>
        </div>
      ))}
    </RowGroup>
  );
}
