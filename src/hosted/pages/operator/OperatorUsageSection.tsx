import { useLanguage, useT } from '../../../lib/i18n/core';
import { QueryView, Skeleton } from '../../components/QueryView';
import { RowGroup } from '../../components/YouRows';
import { useOperatorAccountUsage } from '../../data/operatorUsageQueries';
import { formatMonth } from '../../format/reportFormat';
import { MeterLine } from './OperatorUsagePage';

/**
 * MUT-735 (ADR-281): an account's usage on its operator page: the last six months, newest first, each month's
 * documents and scans against the plan it had (a month with no cap says so), then each profile's documents and scans
 * this month. Read only; if it can't be read the section is left out (an API before MUT-735, or a failure).
 */
export function OperatorUsageSection({ userId }: { userId: string }) {
  const t = useT();
  const { language } = useLanguage();
  const query = useOperatorAccountUsage(userId);
  // Usage is a report beside the account, never in the way of acting on it: a failed read leaves the section out.
  if (query.isError) return null;
  return (
    <RowGroup label={t('hosted.operator.usage.sectionTitle')}>
      <QueryView queries={[query]} data={query.data} loading={<Skeleton rows={2} />}>
        {(usage) => {
          const current = usage.months.at(-1)!.month;
          const newestFirst = [...usage.months].reverse();
          return (
            <div className="hp-operator-usage-section" data-account-usage>
              {newestFirst.map((m) => (
                <div key={m.month} className="hp-you-row" data-usage-month={m.month}>
                  <span className="hp-you-row-text">
                    <span className="hp-you-row-label">
                      {formatMonth(m.month, language, current)} · {t(`hosted.operator.usage.plan.${m.plan}`)}
                    </span>
                    <small className="hp-operator-meters">
                      {m.meters.map((meter) => (
                        <MeterLine key={meter.meter} meter={meter} />
                      ))}
                    </small>
                  </span>
                </div>
              ))}
              {usage.profiles.map((p) => {
                const now = p.months.at(-1)!;
                return (
                  <div key={p.organizationId ?? 'person'} className="hp-you-row" data-usage-profile={p.organizationId ?? ''}>
                    <span className="hp-you-row-text">
                      <span className="hp-you-row-label">
                        <bdi dir="auto">{p.name ?? t('hosted.operator.usage.personLevel')}</bdi>
                      </span>
                      <small>
                        {t('hosted.operator.usage.profileThisMonth', { documents: now.documents, scans: now.scans })}
                      </small>
                    </span>
                  </div>
                );
              })}
            </div>
          );
        }}
      </QueryView>
    </RowGroup>
  );
}
