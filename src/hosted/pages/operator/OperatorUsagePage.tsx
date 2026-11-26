import { useId, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Badge, type BadgeVariant } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Select } from '../../../components/ui/Input';
import { SegmentedControl } from '../../../components/ui/SegmentedControl';
import { useLanguage, useT } from '../../../lib/i18n/core';
import { api, type OperatorUsagePerson, type UsageCsvView, type UsageMeterView, type UsagePeopleFilter, type UsagePlan } from '../../api/client';
import { AlertIcon } from '../../components/Icons';
import { Empty, QueryView, Skeleton } from '../../components/QueryView';
import { saveBlobAs } from '../../data/download';
import { useOperatorUsageOverview, useOperatorUsagePeople, useOperatorUsageRoutes } from '../../data/operatorUsageQueries';
import { formatMonth } from '../../format/reportFormat';
import { StepUpFailureBanner, useOperatorRun } from '../../operator/OperatorStepUp';
import { usageMonths } from '../../operator/usageMonths';

/**
 * MUT-735 (ADR-281): Operator › Usage, read from the usage ledger (never PostHog). Three views: per plan (payers, near /
 * at / over a cap, events per kind), People (the payers near or at a cap, the upgrade leads, each opening the account)
 * and Routes (the busiest API routes over the last 7 days, with errors and p95). Per plan and People pick a month. The
 * CSV export of the view on screen goes through the operator step-up (the data leaves the system). House recipes only
 * (MUT-458 §3b): list rows, `--text-label` meta, numbers in <bdi>, a month Select, no new component.
 */
type View = 'plans' | 'people' | 'routes';
const SKELETON_ROWS = 4;
const CSV_VIEW: Record<View, UsageCsvView> = { plans: 'overview', people: 'people', routes: 'routes' };

export function OperatorUsagePage() {
  const t = useT();
  const { language } = useLanguage();
  const months = usageMonths(new Date());
  const [view, setView] = useState<View>('plans');
  const [month, setMonth] = useState(months[0]!);
  const [filter, setFilter] = useState<UsagePeopleFilter | 'all'>('near');
  const viewLabel = useId();

  return (
    <div className="hp-operator-usage">
      <div className="hp-operator-usage-bar">
        <SegmentedControl
          value={view}
          onChange={(next) => setView(next as View)}
          ariaLabel={t('hosted.operator.usage.viewLabel')}
          options={[
            { value: 'plans', label: t('hosted.operator.usage.views.plans') },
            { value: 'people', label: t('hosted.operator.usage.views.people') },
            { value: 'routes', label: t('hosted.operator.usage.views.routes') },
          ]}
        />
        {view !== 'routes' && (
          <Select id={viewLabel} label={t('hosted.operator.usage.month')} value={month} onChange={(event) => setMonth(event.target.value)}>
            {months.map((m) => (
              <option key={m} value={m}>
                {formatMonth(m, language, months[0]!)}
              </option>
            ))}
          </Select>
        )}
      </div>
      {view === 'plans' && <PlansView month={month} />}
      {view === 'people' && <PeopleView month={month} filter={filter} onFilter={setFilter} />}
      {view === 'routes' && <RoutesView />}
      <CsvExport view={view} month={month} filter={filter === 'all' ? undefined : filter} />
    </div>
  );
}

function usePlanName() {
  const t = useT();
  return (plan: UsagePlan) => t(`hosted.operator.usage.plan.${plan}`);
}

function PlansView({ month }: { month: string }) {
  const t = useT();
  const planName = usePlanName();
  const query = useOperatorUsageOverview(month);
  return (
    <QueryView
      queries={[query]}
      data={query.data}
      isEmpty={(o) => o.plans.length === 0}
      loading={<Skeleton rows={SKELETON_ROWS} />}
      empty={<Empty title={t('hosted.operator.usage.emptyMonthTitle')} />}
    >
      {(overview) => (
        <ul className="hp-passkey-list hp-operator-list" aria-label={t('hosted.operator.usage.plansLabel')} aria-busy={query.isPlaceholderData || undefined}>
          {overview.plans.map((p) => (
            <li key={p.plan} className="hp-passkey-row" aria-label={planName(p.plan)} data-usage-plan={p.plan}>
              <span className="hp-passkey-text">
                <span className="hp-passkey-name">{planName(p.plan)}</span>
                <span className="hp-option-sub">
                  {t('hosted.operator.usage.payers', { count: p.payers })} · {t('hosted.operator.usage.near', { count: p.near })} · {t('hosted.operator.usage.capped', { count: p.capped })}
                  {p.over > 0 && <> · {t('hosted.operator.usage.over', { count: p.over })}</>}
                </span>
                <span className="hp-option-sub">
                  {p.kinds.map((k, i) => (
                    <span key={k.kind}>
                      {i > 0 && ' · '}
                      {t(`hosted.operator.usage.kind.${k.kind}`)} <bdi dir="ltr">{k.events}</bdi>
                    </span>
                  ))}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </QueryView>
  );
}

const LEVEL_BADGE: Record<UsageMeterView['level'], BadgeVariant | null> = { ok: null, near: 'info', nudge: 'warning', at_cap: 'error' };

/** "Documents 41 / 50", or "Documents 7 · no cap", with the level as a badge from 80%. */
export function MeterLine({ meter }: { meter: UsageMeterView }) {
  const t = useT();
  const badge = LEVEL_BADGE[meter.level];
  return (
    <span className="hp-operator-meter" data-meter={meter.meter}>
      {t(`hosted.operator.usage.meter.${meter.meter}`)}{' '}
      {meter.limit === null ? (
        <>
          <bdi dir="ltr">{meter.used}</bdi> · {t('hosted.operator.usage.noCap')}
        </>
      ) : (
        <bdi dir="ltr">
          {meter.used} / {meter.limit}
        </bdi>
      )}
      {badge && (
        <>
          {' '}
          <Badge variant={badge} size="sm">
            {t(`hosted.operator.usage.level.${meter.level}`)}
          </Badge>
        </>
      )}
    </span>
  );
}

function PeopleView({ month, filter, onFilter }: { month: string; filter: UsagePeopleFilter | 'all'; onFilter: (next: UsagePeopleFilter | 'all') => void }) {
  const t = useT();
  const query = useOperatorUsagePeople(month, filter === 'all' ? undefined : filter);
  const people = query.data?.pages.flatMap((page) => page.items);
  return (
    <>
      <SegmentedControl
        className="hp-operator-usage-filter"
        value={filter}
        onChange={(next) => onFilter(next as UsagePeopleFilter | 'all')}
        ariaLabel={t('hosted.operator.usage.filterLabel')}
        options={[
          { value: 'near', label: t('hosted.operator.usage.filters.near') },
          { value: 'capped', label: t('hosted.operator.usage.filters.capped') },
          { value: 'over', label: t('hosted.operator.usage.filters.over') },
          { value: 'all', label: t('hosted.operator.usage.filters.all') },
        ]}
      />
      <QueryView
        queries={[query]}
        data={people}
        isEmpty={(list) => list.length === 0}
        loading={<Skeleton rows={SKELETON_ROWS} />}
        empty={<Empty title={t('hosted.operator.usage.emptyPeopleTitle')} body={t('hosted.operator.usage.emptyPeopleBody')} />}
      >
        {(list) => (
          <>
            <ul className="hp-passkey-list hp-operator-list" aria-label={t('hosted.operator.usage.peopleLabel')} aria-busy={query.isPlaceholderData || undefined}>
              {list.map((person) => (
                <PersonRow key={person.subjectKey} person={person} />
              ))}
            </ul>
            {query.hasNextPage && (
              <div className="hp-operator-more">
                <Button type="button" variant="secondary" isLoading={query.isFetchingNextPage} keepLabelWhileLoading onClick={() => void query.fetchNextPage()}>
                  {t('hosted.operator.accounts.loadMore')}
                </Button>
              </div>
            )}
          </>
        )}
      </QueryView>
    </>
  );
}

function PersonRow({ person }: { person: OperatorUsagePerson }) {
  const planName = usePlanName();
  const body = (
    <span className="hp-passkey-text">
      <span className="hp-passkey-name">
        <bdi dir="auto">{person.name}</bdi>
      </span>
      <span className="hp-option-sub">
        {person.email && (
          <>
            <bdi dir="ltr">{person.email}</bdi> ·{' '}
          </>
        )}
        {planName(person.plan)}
      </span>
      <span className="hp-option-sub hp-operator-meters">
        {person.meters.map((m) => (
          <MeterLine key={m.meter} meter={m} />
        ))}
      </span>
    </span>
  );
  return (
    <li className="hp-passkey-row" aria-label={person.name}>
      {person.userId ? (
        <Link className="hp-operator-account-link press" to="/operator/accounts/$userId" params={{ userId: person.userId }}>
          {body}
          <span className="hp-you-row-tail" aria-hidden="true">
            ›
          </span>
        </Link>
      ) : (
        body
      )}
    </li>
  );
}

function RoutesView() {
  const t = useT();
  const query = useOperatorUsageRoutes();
  return (
    <QueryView
      queries={[query]}
      data={query.data}
      isEmpty={(r) => r.routes.length === 0}
      loading={<Skeleton rows={SKELETON_ROWS} />}
      empty={<Empty title={t('hosted.operator.usage.emptyRoutesTitle')} />}
    >
      {(report) => (
        <>
          <p className="hp-option-sub">{t('hosted.operator.usage.routesRange', { from: report.from, to: report.to })}</p>
          <ul className="hp-passkey-list hp-operator-list" aria-label={t('hosted.operator.usage.routesLabel')}>
            {report.routes.map((r) => (
              <li key={r.routeKey} className="hp-passkey-row" aria-label={r.routeKey}>
                <span className="hp-passkey-text">
                  <span className="hp-passkey-name hp-operator-email" dir="ltr">
                    {r.routeKey}
                  </span>
                  <span className="hp-option-sub">
                    {t('hosted.operator.usage.requests', { count: r.count })} · {t('hosted.operator.usage.errors', { client: r.clientErrors, server: r.serverErrors })} ·{' '}
                    {r.p95Ms === null ? '—' : r.p95Over ? t('hosted.operator.usage.p95Over') : t('hosted.operator.usage.p95', { ms: r.p95Ms })}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </QueryView>
  );
}

/** The view on screen as CSV. The export leaves the system, so it goes through the step-up like a write. */
function CsvExport({ view, month, filter }: { view: View; month: string; filter: UsagePeopleFilter | undefined }) {
  const t = useT();
  // The step-up window as the lists last read it; a 403 on the export updates it (useOperatorRun).
  const overview = useOperatorUsageOverview(month);
  const run = useOperatorRun(overview.data?.stepUpUntil ?? null);
  const [failed, setFailed] = useState(false);

  async function download() {
    setFailed(false);
    try {
      const file = await run.run(() => api.operatorUsageCsv({ view: CSV_VIEW[view], month: view === 'routes' ? undefined : month, filter: view === 'people' ? filter : undefined }));
      if (file) saveBlobAs(file.blob, file.filename);
    } catch {
      setFailed(true);
    }
  }

  const label = run.label === 'plain' ? t('hosted.operator.usage.export') : run.label === 'passkey' ? t('hosted.operator.usage.exportWithPasskey') : t('hosted.operator.stepUp.confirmWithPasskey');
  return (
    <div className="hp-operator-usage-export">
      <Button type="button" variant="secondary" isLoading={run.busy} keepLabelWhileLoading onClick={() => void download()}>
        {label}
      </Button>
      {run.failure && <StepUpFailureBanner failure={run.failure} error={run.failureError} />}
      {failed && (
        <div className="hp-banner hp-banner-error" role="alert">
          <AlertIcon />
          <span>{t('hosted.operator.failed')}</span>
        </div>
      )}
    </div>
  );
}
