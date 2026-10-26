import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { getLocale, useLanguage } from '../../../lib/i18n/core';
import { useTp } from '../../../lib/i18n/plural';
import type { Language } from '../../../lib/i18n/types';
import { usePrefersReducedMotion } from '../../../lib/motion/mediaQuery';
import { isolateAmount, parseAmountToMinor } from '../../../lib/utils';
import type { ActivitySummary, Currency, HostedProfile } from '../../api/client';
import { useReportViewed } from '../../analytics/reportViewed';
import { CategoryBars } from '../../components/groups/CategoryBars';
import { DayBars } from '../../components/groups/DayBars';
import { Empty, QueryView } from '../../components/QueryView';
import { HeroFigures } from '../../components/reports/HeroFigures';
import { InsightList, TeaserCard, type Teaser } from '../../components/reports/InsightList';
import { ReportControls } from '../../components/reports/ReportControls';
import { addDays, UNCATEGORIZED } from '../../data/expenseGroups';
import { useFxRates } from '../../data/expenseGroupQueries';
import type { ReportsSearch } from '../../data/filters';
import { buildInsights, recordViews, type Insight, type SeenInsights } from '../../data/reportInsights';
import { useNameDirectories, useOwedSummaries, useReportActivity, type NameDirectories, type ProfileLoad } from '../../data/reportQueries';
import {
  bucketFor,
  canReadReports,
  chartBars,
  chooseUnit,
  combine,
  completeMonths,
  convertMoney,
  currenciesIn,
  DEFAULT_PERIOD,
  FULL_STAGE,
  hasNext,
  hasPrevious,
  inUnit,
  isZeroMoney,
  monthPoints,
  NO_CATEGORY_KEY,
  periodRange,
  recordWeight,
  shareRows,
  stageOf,
  stepPeriod,
  sumMoney,
  unlockMonth,
  yearUnlockMonth,
  type Combined,
  type Money,
  type Period,
  type ProfileBlock,
  type Stage,
  type Unit,
} from '../../data/reports';
import { moneyDateFloor, todayInZone } from '../../format/dates';
import { formatAxis, formatBucket, formatMinor, formatMonth, formatPeriod, formatWhole } from '../../format/reportFormat';
import { useMe, useProfile, useWriteGate } from '../../session/me';
import { useIsLocalMode } from '../../session/mode';
import { PageHeader } from './shared';

/**
 * Reports (MUT-175): what came in, where it went, who paid, and what the
 * history says lately. One profile by default, all of them combined behind the
 * switch (DS1–DS5). Composition only: the figures arrive shaped from
 * data/reports.ts and data/reportInsights.ts.
 */

const K = 'hosted.reports';
/** DR9: how long the hero waits for today's rates before showing each currency on its own. */
const RATES_WAIT_MS = 1500;
const SEEN_KEY = 'mutaba3a-reports-seen';
/** A placeholder no translation contains, to split a sentence around an inline button. */
const SLOT = '\u0000';
/** DR25: Month's axis labels sit on these days. */
const AXIS_DAYS = ['01', '08', '15', '22', '29'];
/** The server reports a year beyond the money-date floor (a Year view may start before the floor day). */
const DAYS_BEFORE_FLOOR = 366;
/** DR5: the first-load skeleton's list rows. */
const SKELETON_ROWS = 3;

const monthOf = (day: string) => day.slice(0, 7);

function stageFrom(c: Pick<Combined, 'since' | 'earlier'>, today: string): Stage {
  return stageOf(completeMonths(c.since, c.earlier, today).length);
}

function readSeen(key: string): SeenInsights {
  try {
    const all = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}') as Record<string, SeenInsights>;
    return all[key] ?? {};
  } catch {
    return {};
  }
}

function writeSeen(key: string, seen: SeenInsights) {
  try {
    const all = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}') as Record<string, SeenInsights>;
    localStorage.setItem(SEEN_KEY, JSON.stringify({ ...all, [key]: seen }));
  } catch {
    // No storage (private window): insights simply don't rotate (DR18)
  }
}

/** True once `ms` have passed while `active`; resets when it stops being active. */
function useElapsed(ms: number, active: boolean): boolean {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setElapsed(true), ms);
    return () => clearTimeout(timer);
  }, [ms, active]);
  return active && elapsed;
}

interface ReportsPageProps {
  search: ReportsSearch;
  setSearch: (next: ReportsSearch) => void;
}

export function ReportsPage({ search, setSearch }: ReportsPageProps) {
  const me = useMe();
  const profile = useProfile();
  const { t, language } = useLanguage();
  const reducedMotion = usePrefersReducedMotion();
  const local = useIsLocalMode();
  const { writable } = useWriteGate();
  const today = todayInZone(profile.timezone);
  const ownProfile = useMemo(() => [profile], [profile]);
  const others = useMemo(() => me.profiles.filter((p) => p.id !== profile.id && canReadReports(p)), [me.profiles, profile.id]);
  const all = search.scope === 'all' && others.length > 0;
  const inView = useMemo(() => (all ? [profile, ...others] : ownProfile), [all, profile, others, ownProfile]);

  // "Lately" always reads this month: insights and the stage never move with the period shown (DR16)
  const latelyRange = useMemo(() => periodRange('month', today, language), [today, language]);
  const own = useReportActivity(ownProfile, latelyRange, 'day');
  const ownLoad = own[0]!;
  const ownStage = ownLoad.data ? stageFrom({ since: ownLoad.data.dataSince, earlier: ownLoad.data.earlierData }, today) : null;
  // DS5: the other profiles' history is read when the switch is on, or to offer it while this profile is young
  const othersLately = useReportActivity(others, latelyRange, 'day', all || (ownStage !== null && ownStage < FULL_STAGE));
  const names = useNameDirectories(inView);
  const blockOf = useBlockOf(names);

  const lately = useMemo(() => combine(readyBlocks(all ? [...own, ...othersLately] : own, blockOf)), [all, own, othersLately, blockOf]);
  const everyone = useMemo(() => combine(readyBlocks([...own, ...othersLately], blockOf)), [own, othersLately, blockOf]);
  const stage = stageFrom(lately, today);

  const period: Period = search.period === 'year' && stage < FULL_STAGE ? 'month' : (search.period ?? DEFAULT_PERIOD);
  const at = search.at ?? today;
  const range = useMemo(() => periodRange(period, at, language), [period, at, language]);
  const bucket = bucketFor(period);
  const view = useReportActivity(inView, range, bucket);
  const owed = useOwedSummaries(inView);
  const viewed = useMemo(() => combine(readyBlocks(view, blockOf)), [view, blockOf]);

  const currencies = useMemo(() => [...new Set([...currenciesIn(viewed), ...currenciesIn(lately)])].sort(), [viewed, lately]);
  const ratesNeeded = currencies.length > 1 || (currencies.length === 1 && currencies[0] !== profile.defaultCurrency);
  const rates = useFxRates(profile.id, profile.defaultCurrency, ratesNeeded);
  const ratesWaitOver = useElapsed(RATES_WAIT_MS, ratesNeeded && rates.isPending);
  const unit = useMemo(() => chooseUnit(currencies, profile.defaultCurrency, rates.data, recordWeight(lately)), [currencies, profile.defaultCurrency, rates.data, lately]);
  // Who paid shows how fast each client pays lately, never a past period's partial figure (review)
  const typicalDays = useMemo(() => new Map(lately.clients.map((c) => [c.key, c.daysToPaid])), [lately.clients]);

  useReportViewed(period, all ? 'all' : 'profile', ownLoad.status === 'ready' ? stage : null, local);
  const insights = useInsights(lately, stage, unit, today, inView.map((p) => p.id).sort().join(','), names.settled);

  const set = (next: Partial<ReportsSearch>) => setSearch({ ...search, ...next });
  const header = <PageHeader title={t(`${K}.title`)} />;

  // This profile can't be read: a plain explainer (DR12). In All profiles it is named and left out instead (D4).
  const mine = view[0]!;
  if (!all && (mine.status === 'forbidden' || ownLoad.status === 'forbidden')) {
    return (
      <>
        {header}
        <Empty title={t(`${K}.noAccess.title`)} body={t(`${K}.noAccess.body`)} />
      </>
    );
  }
  const readyView = view.filter((v) => v.data && v.status !== 'failed' && v.status !== 'forbidden');
  const failed = view.filter((v) => v.status === 'failed');
  // The page-level card when the period has nothing to show, or this profile's "Lately" failed (review: it hung)
  const pageError = (!all && mine.status === 'failed') || (all && readyView.length === 0 && failed.length > 0) || ownLoad.status === 'failed';
  if (pageError) {
    const retryAll = () => [...failed, ...(ownLoad.status === 'failed' ? [ownLoad] : [])].forEach((f) => f.retry());
    return (
      <>
        {header}
        <QueryView queries={[{ isPending: false, isError: true, error: failed[0]?.error ?? ownLoad.error ?? mine.error, refetch: retryAll }]} data={undefined}>
          {() => null}
        </QueryView>
      </>
    );
  }
  const firstLoad = readyView.length === 0 || (ownLoad.status === 'loading' && !ownLoad.data);
  if (firstLoad) return <ReportSkeleton header={header} label={t(`${K}.loading`)} />;
  if (lately.since === null && !lately.earlier && ownLoad.status === 'ready') return <FirstRun header={header} profile={profile} writable={writable} />;

  const busy = view.some((v) => v.stale);
  const holdForRates = ratesNeeded && rates.isPending && !ratesWaitOver;
  const caption = range.from <= today && today <= range.to ? t(`${K}.hero.soFar`, { period: formatPeriod(period, range, language) }) : formatPeriod(period, range, language);
  const empty = isZeroMoney(viewed.received) && isZeroMoney(viewed.spent);
  const teaser = teaserFor({ stage, all, profile, own: ownLoad.data, everyoneStage: stageFrom(everyone, today), lately, today, language, t, onSeeAll: () => set({ scope: 'all' }) });
  const goTo = latestMonthWithData(lately, monthOf(range.from), period);
  const yearUnlock = yearUnlockMonth(lately.since);
  const mover = insights.find((i) => i.id === 'mover')?.subject;
  // The mover is marked only on the month it describes (review)
  const moverKey = mover && period === 'month' && monthOf(range.from) === mover.month ? (mover.key === NO_CATEGORY_KEY ? UNCATEGORIZED : mover.key) : null;

  return (
    <>
      {header}
      <ReportControls
        period={period}
        onPeriod={(p) => set({ period: p, at: undefined })}
        yearLockedUntil={stage < FULL_STAGE ? formatMonth(yearUnlock ?? monthOf(today), language, today) : null}
        canPrevious={hasPrevious(period, at, lately.since, lately.earlier, language, addDays(moneyDateFloor(today), -DAYS_BEFORE_FLOOR))}
        canNext={hasNext(period, at, today, language)}
        onStep={(direction) => set({ at: stepPeriod(period, at, direction, language) })}
        allProfiles={others.length > 0 ? all : null}
        onAllProfiles={(on) => set({ scope: on ? 'all' : undefined })}
      />
      <div className={`hp-report ${busy ? 'hp-report-busy' : ''}`} aria-busy={busy || undefined}>
        {holdForRates ? (
          <div className="hp-report-skeleton" aria-hidden="true">
            <span className="hp-report-skeleton-hero" />
          </div>
        ) : (
          <HeroFigures received={viewed.received} spent={viewed.spent} unit={unit} caption={caption} reducedMotion={reducedMotion} />
        )}
        {all && <CombinedLines view={view} profile={profile} unit={unit} />}
        {!holdForRates && <OwedLine owed={owed} unit={unit} profileId={profile.id} />}
        {insights.length > 0 && <InsightList insights={insights} unit={unit.currency} singleCurrency={unit.singleCurrency} today={today} teaser={teaser} />}
        {empty ? (
          <div className="hp-empty">
            <h2>{t(`${K}.empty.period`, { period: formatPeriod(period, range, language) })}</h2>
            {goTo && (
              <button type="button" className="hp-link-button press" onClick={() => set({ period: 'month', at: `${goTo}-01` })}>
                {t(`${K}.empty.goTo`, { period: formatPeriod('month', periodRange('month', `${goTo}-01`, language), language) })}
              </button>
            )}
          </div>
        ) : (
          <>
            <ReportChart viewed={viewed} unit={unit} period={period} bucket={bucket} today={today} reducedMotion={reducedMotion} />
            <ReportLists viewed={viewed} unit={unit} period={period} range={range} stage={stage} reducedMotion={reducedMotion} moverKey={moverKey} typicalDays={typicalDays} />
          </>
        )}
        {insights.length === 0 && teaser && <TeaserCard teaser={teaser} />}
      </div>
    </>
  );
}

/** DR5: the first-load skeleton in the page's shape — hero, a 168px chart, three rows. */
function ReportSkeleton({ header, label }: { header: ReactNode; label: string }) {
  return (
    <>
      {header}
      <div className="hp-report-skeleton" aria-busy="true" aria-label={label}>
        <span className="hp-report-skeleton-hero" />
        <span className="hp-report-skeleton-chart" />
        {Array.from({ length: SKELETON_ROWS }, (_, i) => (
          <span key={i} className="hp-report-skeleton-row" />
        ))}
      </div>
    </>
  );
}

/** Each loaded profile as a block, with its category and client names (null: a name not known yet). */
function useBlockOf(names: NameDirectories) {
  const { t } = useLanguage();
  return useMemo(
    () =>
      (profile: HostedProfile, activity: ActivitySummary): ProfileBlock => ({
        profileId: profile.id,
        profileName: profile.name,
        activity,
        categoryName: (id) => (id ? (names.byProfile.get(profile.id)?.categories.get(id) ?? null) : t('hosted.groups.detail.uncategorized')),
        clientName: (id) => (id ? (names.byProfile.get(profile.id)?.clients.get(id) ?? '—') : t(`${K}.lists.noClient`)),
      }),
    [names, t],
  );
}

function readyBlocks(loads: readonly ProfileLoad<ActivitySummary>[], blockOf: (profile: HostedProfile, activity: ActivitySummary) => ProfileBlock): ProfileBlock[] {
  return loads.flatMap((load) => (load.data && load.status !== 'failed' && load.status !== 'forbidden' ? [blockOf(load.profile, load.data)] : []));
}

/** The latest month with money in the history, unless it is the one shown (DR6's "Go to"). */
function latestMonthWithData(c: Combined, shownMonth: string, period: Period): string | null {
  const months = c.history.filter((h) => !isZeroMoney(h.received) || !isZeroMoney(h.spent)).map((h) => h.month);
  const latest = months.at(-1) ?? null;
  return latest && (period !== 'month' || latest !== shownMonth) ? latest : null;
}

interface TeaserInput {
  stage: Stage;
  all: boolean;
  profile: HostedProfile;
  own: ActivitySummary | undefined;
  everyoneStage: Stage;
  lately: Combined;
  today: string;
  language: Language;
  t: ReturnType<typeof useLanguage>['t'];
  onSeeAll: () => void;
}

/** B8, DR17, DS5: what unlocks next, or that the other profiles already have insights. */
function teaserFor({ stage, all, profile, own, everyoneStage, lately, today, language, t, onSeeAll }: TeaserInput): Teaser | null {
  const month = (m: string) => formatMonth(m, language, today);
  if (!all && everyoneStage > stage && own?.dataSince) {
    const unlock = unlockMonth(own.dataSince, stage);
    return { text: t(`${K}.teaser.scope`, { profile: profile.name, month: month(monthOf(own.dataSince)), unlock: unlock ? month(unlock) : '' }), onSeeAll };
  }
  const unlock = unlockMonth(lately.since, stage);
  if (!unlock) return null;
  return { text: t(stage === 1 ? `${K}.teaser.stage1` : `${K}.teaser.stage2`, { month: month(unlock) }) };
}

/** Insights wait for the names they quote (review: never "—"), and rank against this profile set's own history (DR18). */
function useInsights(lately: Combined, stage: Stage, unit: Unit, today: string, seenKey: string, namesSettled: boolean): Insight[] {
  const points = useMemo(() => monthPoints(lately, completeMonths(lately.since, lately.earlier, today), unit), [lately, today, unit]);
  const seen = useMemo(() => readSeen(seenKey), [seenKey]);
  const insights = useMemo(
    () => (namesSettled ? buildInsights({ stage, months: points, daysToPaid: lately.daysToPaid }, seen) : []),
    [namesSettled, stage, points, lately.daysToPaid, seen],
  );
  const recorded = useRef<string | null>(null);
  useEffect(() => {
    // One counted visit per page open and profile set (DR18)
    if (insights.length === 0 || recorded.current === seenKey) return;
    recorded.current = seenKey;
    writeSeen(seenKey, recordViews(readSeen(seenKey), insights));
  }, [insights, seenKey]);
  return insights;
}

/** DR6/DR8: no records yet — one block and the two capture actions this profile allows. */
export function FirstRun({ header, profile, writable }: { header: ReactNode; profile: HostedProfile; writable: boolean }) {
  const { t } = useLanguage();
  const canIncome = writable && profile.access.capture === 'read-write' && profile.income.received;
  const canExpense = writable && profile.access.expenses === 'read-write';
  return (
    <>
      {header}
      <Empty
        title={t(`${K}.firstRun.title`)}
        body={t(`${K}.firstRun.body`)}
        action={
          (canIncome || canExpense) && (
            <div className="hp-report-actions">
              {canIncome && (
                <Link to={`/p/${profile.id}/payments`} search={{ newIncome: 'received' }} className="hp-link">
                  {t('hosted.income.add')}
                </Link>
              )}
              {canExpense && (
                <Link to={`/p/${profile.id}/expenses`} search={{ newExpense: '1' }} className="hp-link">
                  {t('hosted.expenses.record')}
                </Link>
              )}
            </div>
          )
        }
      />
    </>
  );
}

/**
 * DS1/DS3/D4: the disclaimer (or, with a failure, the partial line in its place, with Retry), this profile's share,
 * and any profile left out.
 */
function CombinedLines({ view, profile, unit }: { view: readonly ProfileLoad<ActivitySummary>[]; profile: HostedProfile; unit: Unit }) {
  const { t, language } = useLanguage();
  const tp = useTp();
  const [listOpen, setListOpen] = useState(false);
  const failed = view.filter((v) => v.status === 'failed');
  const forbidden = view.filter((v) => v.status === 'forbidden');
  const included = view.filter((v) => v.data && v.status !== 'failed' && v.status !== 'forbidden');
  const mine = view.find((v) => v.profile.id === profile.id)?.data;
  const share = mine ? inUnit(moneyOf(mine, 'received'), unit) : null;
  const list = new Intl.ListFormat(getLocale(language), { type: 'conjunction' });
  // "{profiles} combined · …": the profile count is a button that lists the names (DS3), wherever the language puts it
  const [before, after] = t(`${K}.combined.line`, { profiles: SLOT }).split(SLOT);
  return (
    <div className="hp-report-combined">
      {failed.length > 0 ? (
        <p className="hp-banner hp-banner-info">
          {t(`${K}.combined.partial`, { loaded: included.length, total: view.length, profile: list.format(failed.map((f) => f.profile.name)) })}{' '}
          <button type="button" className="hp-link-button press" onClick={() => failed.forEach((f) => f.retry())}>
            {t(`${K}.combined.retry`)}
          </button>
        </p>
      ) : (
        <p className="hp-report-note">
          {before}
          <button type="button" className="hp-link-button press" aria-expanded={listOpen} onClick={() => setListOpen((v) => !v)}>
            {tp(`${K}.combined.profiles`, included.length)}
          </button>
          {after}
        </p>
      )}
      {listOpen && failed.length === 0 && (
        <ul className="hp-report-profiles" aria-label={t(`${K}.combined.listTitle`)}>
          {included.map((v) => (
            <li key={v.profile.id}>{v.profile.name}</li>
          ))}
        </ul>
      )}
      {share !== null && (
        <p className="hp-report-note">
          {t(`${K}.combined.share`, { profile: profile.name, amount: isolateAmount(formatWhole(share, unit.currency, language)) })}
          {unit.singleCurrency && ` · ${t(`${K}.insights.singleCurrency`, { currency: unit.currency })}`}
        </p>
      )}
      {forbidden.map((f) => (
        <p key={f.profile.id} className="hp-report-note hp-muted">
          {t(`${K}.combined.forbidden`, { profile: f.profile.name })}
        </p>
      ))}
    </div>
  );
}

function moneyOf(activity: ActivitySummary, field: 'received' | 'spent'): Money {
  return new Map(activity.currencies.map((c) => [c.currency, parseAmountToMinor(c[field], c.currency)]));
}

/** DR2: "Owed to you now", its own line, static while stepping; links to the receivables, its name the visible text (review). */
function OwedLine({ owed, unit, profileId }: { owed: ReturnType<typeof useOwedSummaries>; unit: Unit; profileId: string }) {
  const { t, language } = useLanguage();
  const loaded = owed.filter((o) => o.data);
  if (loaded.length === 0) return null;
  const money = sumMoney(loaded.map((o) => new Map(o.data!.currencies.map((c) => [c.currency, parseAmountToMinor(c.outstanding, c.currency)] as [Currency, number]))));
  const label = t(`${K}.owed.label`);
  if (isZeroMoney(money)) {
    return (
      <p className="hp-report-owed">
        {label} <bdi>{formatWhole(0, unit.currency, language)}</bdi>
      </p>
    );
  }
  const converted = unit.rates ? convertMoney(money, unit.rates) : null;
  const figures = converted
    ? [`${[...money.keys()].some((c) => c !== unit.currency) ? '≈ ' : ''}${formatWhole(parseAmountToMinor(converted.total, unit.currency), unit.currency, language)}`]
    : [...money].filter(([, minor]) => minor !== 0).map(([currency, minor]) => formatWhole(minor, currency, language));
  return (
    <p className="hp-report-owed">
      <Link to={`/p/${profileId}/receivables`} className="hp-link" aria-description={t(`${K}.owed.open`)}>
        {label} <bdi>{figures.join(' · ')}</bdi> <span aria-hidden="true">›</span>
      </Link>
    </p>
  );
}

/** The received-and-spent chart with its legend and the selected bar's values (DR13, DR22, DR25, DR26). */
function ReportChart({ viewed, unit, period, bucket, today, reducedMotion }: { viewed: Combined; unit: Unit; period: Period; bucket: 'day' | 'month'; today: string; reducedMotion: boolean }) {
  const { t, language } = useLanguage();
  const { bars, spent, other } = useMemo(() => chartBars(viewed, unit, bucket), [viewed, unit, bucket]);
  const future = (bar: { from: string }) => bar.from > today;
  const isToday = (bar: { from: string; to: string }) => bar.from <= today && today <= bar.to;
  const fallback = [...bars].reverse().find((b) => !future(b) && (b.minor > 0 || (spent.get(b.key) ?? 0) > 0))?.key ?? bars.find((b) => b.from === today)?.key;
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const selected = bars.some((b) => b.key === picked) ? picked : (bars.find(isToday)?.key ?? fallback);
  const money = (minor: number) => isolateAmount(formatMinor(minor, unit.currency, language));
  const describe = (bar: (typeof bars)[number]) => t(`${K}.chart.bar`, { date: formatBucket(bar.from, bucket, language), received: money(bar.minor), spent: money(spent.get(bar.key) ?? 0) });
  const chosen = bars.find((b) => b.key === selected);
  const line = chosen ? t(`${K}.chart.selected`, { date: formatBucket(chosen.from, bucket, language), received: money(chosen.minor), spent: money(spent.get(chosen.key) ?? 0) }) : '';
  return (
    <section className="hp-report-section" aria-label={t(bucket === 'day' ? `${K}.chart.days` : `${K}.chart.months`)}>
      <h2>{t(bucket === 'day' ? `${K}.chart.days` : `${K}.chart.months`)}</h2>
      <p className="hp-report-legend" aria-hidden="true">
        <span className="hp-legend-received">{t(`${K}.hero.received`)}</span>
        <span className="hp-legend-spent">{t(`${K}.hero.spent`)}</span>
      </p>
      <div className={`hp-report-chart ${period === 'month' ? 'hp-report-chart-dense' : ''}`}>
        <DayBars
          bars={bars}
          label={t(bucket === 'day' ? `${K}.chart.labelDays` : `${K}.chart.labelMonths`)}
          describe={describe}
          axisLabel={(bar) => (period !== 'month' || AXIS_DAYS.includes(bar.from.slice(8, 10)) ? formatAxis(bar.from, period, language) : null)}
          gapLabel={() => t(`${K}.chart.beforeStart`)}
          hasOther={(bar) => other.has(bar.key)}
          selected={selected}
          onJump={(bar) => setPicked(bar.key)}
          reducedMotion={reducedMotion}
          second={(bar) => spent.get(bar.key) ?? 0}
          future={future}
          today={isToday}
          enterStagger
        />
      </div>
      {/* DR26: shown always; said once, only when the person picks a bar (review: not on every step) */}
      <p className="hp-report-selected">{line}</p>
      <p className="sr-only" aria-live="polite">
        {picked ? line : ''}
      </p>
    </section>
  );
}

/** "Where it went" and "Who paid" (DR7, DR23, DR30), labelled when a rate is missing (D3, Basel's review answer). */
function ReportLists({
  viewed,
  unit,
  period,
  range,
  stage,
  reducedMotion,
  moverKey,
  typicalDays,
}: {
  viewed: Combined;
  unit: Unit;
  period: Period;
  range: { from: string; to: string };
  stage: Stage;
  reducedMotion: boolean;
  moverKey: string | null;
  typicalDays: ReadonlyMap<string, number | null>;
}) {
  const { t, language } = useLanguage();
  const tp = useTp();
  const categories = useMemo(() => shareRows(viewed.categories, unit), [viewed.categories, unit]);
  const clients = useMemo(() => shareRows(viewed.clients, unit), [viewed.clients, unit]);
  const byKey = useMemo(() => new Map(viewed.clients.map((c) => [c.key, c])), [viewed.clients]);
  const periodName = formatPeriod(period, range, language);
  const received = inUnit(viewed.received, unit);
  const onlyNote = unit.singleCurrency ? <p className="hp-report-note hp-muted">{t(`${K}.insights.singleCurrency`, { currency: unit.currency })}</p> : null;
  return (
    <div className="hp-report-lists">
      <section className="hp-report-section" aria-label={t(`${K}.lists.whereItWent`)}>
        <h2>{t(`${K}.lists.whereItWent`)}</h2>
        {onlyNote}
        {categories.length === 0 ? (
          <p className="hp-muted">{t(`${K}.lists.noSpending`, { period: periodName })}</p>
        ) : (
          <CategoryBars rows={categories} currency={unit.currency} reducedMotion={reducedMotion} meta={(row) => (moverKey && row.key === moverKey ? t(`${K}.lists.biggestChange`) : null)} />
        )}
      </section>
      {received > 0 && clients.length > 0 && (
        <section className="hp-report-section" aria-label={t(`${K}.lists.whoPaid`)}>
          <h2>{t(`${K}.lists.whoPaid`)}</h2>
          {onlyNote}
          <CategoryBars
            rows={clients}
            currency={unit.currency}
            reducedMotion={reducedMotion}
            detail={(row) => byKey.get(row.key)?.profileName ?? null}
            meta={(row) => {
              const days = typicalDays.get(row.key);
              if (stage < FULL_STAGE || days === null || days === undefined) return null;
              return days === 0 ? t(`${K}.lists.typicallySameDay`) : tp(`${K}.lists.typically`, days);
            }}
          />
        </section>
      )}
    </div>
  );
}
