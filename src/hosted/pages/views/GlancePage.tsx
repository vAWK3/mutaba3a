import { Fragment, useMemo, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useLanguage } from '../../../lib/i18n/core';
import { useTp } from '../../../lib/i18n/plural';
import { usePrefersReducedMotion } from '../../../lib/motion/mediaQuery';
import { ApiError, type HostedProfile, type Verdict } from '../../api/client';
import { useGlanceViewed } from '../../analytics/reportViewed';
import { Empty, QueryView } from '../../components/QueryView';
import { BreakdownButton, CountUp } from '../../components/reports/HeroFigures';
import { ReportControls } from '../../components/reports/ReportControls';
import { LockedScreen } from '../../components/LapseGate';
import { addDays } from '../../data/expenseGroups';
import type { GlanceSearch } from '../../data/filters';
import { DEFAULT_PERIOD, canReadReports, hasNext, hasPrevious, periodRange, stepPeriod, type Period, type Range } from '../../data/reports';
import { allLocked, glanceOf, isFirstRun, outsideProfiles, verdictAllLocked, type Amount, type Glance, type GlanceRow } from '../../data/verdict';
import { useVerdict, verdictKey, type VerdictRange } from '../../data/verdictQueries';
import { minorToDecimal } from '../../format/currencies';
import { DecimalAmount } from '../../format/DecimalAmount';
import { isolate } from '../../../lib/utils';
import { moneyDateFloor, todayInZone } from '../../format/dates';
import { formatPeriod, formatReportDay, formatSigned, formatWhole } from '../../format/reportFormat';
import { useMe, useWritableFor } from '../../session/me';
import { useIsLocalMode } from '../../session/mode';
import { FirstRun } from './ReportsPage';
import { PageHeader } from './shared';

/**
 * The Glance (MUT-448): account-level Reports at `/reports`. One verdict across the person's profiles (MUT-447),
 * shown as the server sends it: what you kept, one row per profile, what you're still owed. Composition only; every
 * figure arrives shaped from data/verdict.ts. One centred column at every width until Explore (MUT-451) gives desktop
 * its second column (DD7). Reading order (DD2): title → controls → label → figure → one sub-line → "Leaves out" →
 * rows → owed → footnote → hint.
 */

const K = 'hosted.reports';
const G = `${K}.glance`;
/** The server reports a year beyond the money-date floor (the per-profile page's rule). */
const DAYS_BEFORE_FLOOR = 366;
/** DD5: skeleton rows, at most this many. */
const MAX_SKELETON_ROWS = 5;
/** A placeholder no translation contains, to put an amount's <bdi> inside a sentence. */
const SLOT = '\u0000';

export interface GlancePageProps {
  search: GlanceSearch;
  setSearch: (next: GlanceSearch) => void;
  /** The profile the shell keeps (eng D8); null when the person has none. */
  shell: HostedProfile | null;
}

export function GlancePage({ search, setSearch, shell }: GlancePageProps) {
  const me = useMe();
  const { t, language } = useLanguage();
  const local = useIsLocalMode();
  const queryClient = useQueryClient();
  const writable = useWritableFor(shell ?? { billing: undefined });
  const locked = allLocked(me.profiles, me);

  const period: Period = search.period ?? DEFAULT_PERIOD;
  // D4: this month as the server counts it until the person picks a day; "today" is the server's asOf once known
  const knownToday = queryClient.getQueryData<Verdict>(verdictKey('current'))?.asOf ?? todayInZone(shell?.timezone ?? 'UTC');
  const range: VerdictRange = useMemo(
    () => (!search.at && period === 'month' ? 'current' : periodRange(period, search.at ?? knownToday, language)),
    [search.at, period, knownToday, language],
  );
  const { query, dimmed } = useVerdict(range, !locked);
  const verdict = query.data;
  const readable = useMemo(() => new Set(me.profiles.filter(canReadReports).map((p) => p.id)), [me.profiles]);
  const glance = useMemo(() => (verdict ? glanceOf(verdict, { period, readable }) : null), [verdict, period, readable]);
  useGlanceViewed(period, Boolean(verdict), local);

  const outside = useMemo(() => outsideProfiles(me.profiles, verdict ?? null, me), [me, verdict]);

  const header = <PageHeader title={t(`${K}.title`)} />;
  const lapsed = query.error instanceof ApiError && query.error.code === 'SUBSCRIPTION_LAPSED';
  if (locked || lapsed || (verdict && verdictAllLocked(verdict))) {
    const profile = shell ?? me.profiles[0];
    return profile ? <LockedScreen profile={profile} /> : header;
  }
  // Review: the verdict counts none of this person's profiles (staff only, ADR-204 D2): their Reports, one tap away
  if (query.error instanceof ApiError && query.error.status === 404) {
    return (
      <>
        {header}
        <div className="hp-glance">
          <p className="hp-glance-hint hp-report-note">{t(`${G}.outside.note`)}</p>
          <OutsideList profiles={outside} period={DEFAULT_PERIOD} />
        </div>
      </>
    );
  }

  const today = verdict?.asOf ?? knownToday;
  const at = search.at ?? verdict?.from ?? knownToday;
  const set = (next: Partial<GlanceSearch>) => setSearch({ ...search, ...next });
  // Review: the controls stay on every state after the first answer, so no period is a dead end (stepping replaces history)
  const controls = (
    <ReportControls
      period={period}
      onPeriod={(p) => set({ period: p, at: undefined })}
      yearLockedUntil={null}
      canPrevious={hasPrevious(period, at, null, true, language, addDays(moneyDateFloor(today), -DAYS_BEFORE_FLOOR))}
      canNext={hasNext(period, at, today, language)}
      onStep={(direction) => set({ at: stepPeriod(period, at, direction, language) })}
      allProfiles={null}
      onAllProfiles={() => undefined}
    />
  );
  if (!verdict) {
    if (query.isError) {
      return (
        <>
          {header}
          {controls}
          <QueryView queries={[query]} data={undefined}>
            {() => null}
          </QueryView>
        </>
      );
    }
    return <GlanceSkeleton header={header} rows={Math.min(Math.max(me.profiles.length, 1), MAX_SKELETON_ROWS)} label={t(`${K}.loading`)} />;
  }
  // DD4, review: First Run only where a person lands, never on a period they stepped back to
  if (!search.at && period === DEFAULT_PERIOD && isFirstRun(verdict)) {
    return (
      <>
        {shell ? (
          <FirstRun header={header} profile={shell} writable={writable} />
        ) : (
          <>
            {header}
            <Empty title={t(`${K}.firstRun.title`)} body={t(`${K}.firstRun.body`)} />
          </>
        )}
        <div className="hp-glance">
          <OutsideList profiles={outside} period={period} at={verdict.from} />
        </div>
      </>
    );
  }

  const shown: Range = { from: verdict.from, to: verdict.to };
  return (
    <>
      {header}
      {controls}
      {query.isError && (
        <p className="hp-glance-refresh hp-report-note" aria-live="polite">
          {t(`${G}.refreshFailed`)}{' '}
          <button type="button" className="hp-link-button press" onClick={() => void query.refetch()}>
            {t(`${K}.combined.retry`)}
          </button>
        </p>
      )}
      <div className={`hp-glance ${dimmed ? 'hp-report-busy' : ''}`} aria-busy={dimmed || undefined}>
        <Ledger glance={glance!} period={period} shown={shown} today={today} />
        <OutsideList profiles={outside} period={period} at={shown.from} />
      </div>
    </>
  );
}

/** Review: profiles the person can open that no total counts (firms they staff): a plain row each, into its Reports. */
function OutsideList({ profiles, period, at }: { profiles: readonly HostedProfile[]; period: Period; at?: string }) {
  const { t } = useLanguage();
  if (profiles.length === 0) return null;
  return (
    <ul className="hp-glance-list hp-glance-outside" aria-label={t(`${G}.outside.label`)}>
      {profiles.map((p) => (
        <li key={p.id}>
          <Link to={`/p/${p.id}/reports`} search={at ? { period, at } : {}} className="hp-glance-row press" aria-label={t(`${G}.outside.linkName`, { name: p.name })}>
            <span className="hp-glance-name">
              <bdi>{p.name}</bdi>
              <span className="hp-glance-kind">{t(`${G}.outside.label`)}</span>
            </span>
            <span className="hp-glance-chevron" aria-hidden="true">
              ›
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function GlanceSkeleton({ header, rows, label }: { header: ReactNode; rows: number; label: string }) {
  return (
    <>
      {header}
      <div className="hp-report-skeleton hp-glance" aria-busy="true" aria-label={label}>
        <span className="hp-report-skeleton-hero" />
        {Array.from({ length: rows }, (_, i) => (
          <span key={i} className="hp-report-skeleton-row hp-glance-skeleton-row" />
        ))}
        <span className="hp-report-skeleton-row hp-glance-skeleton-row" />
      </div>
    </>
  );
}

/** A sentence with one amount in it, the amount in its own <bdi> (ADR-101). */
function Sentence({ text, amount }: { text: string; amount: string }) {
  const [before, after] = text.split(SLOT);
  return (
    <>
      {before}
      <bdi>{amount}</bdi>
      {after}
    </>
  );
}

function useAmountText() {
  const { language } = useLanguage();
  return (amount: Amount, signed = false) => `${amount.approximate ? '≈ ' : ''}${(signed ? formatSigned : formatWhole)(amount.minor, amount.currency, language)}`;
}

function Ledger({ glance, period, shown, today }: { glance: Glance; period: Period; shown: Range; today: string }) {
  const { t, language } = useLanguage();
  const tp = useTp();
  const reducedMotion = usePrefersReducedMotion();
  const text = useAmountText();
  const { hero, usual, rows, owed, footnote } = glance;
  const approxLabel = hero.label === 'kept' ? (hero.breakdown ? 'keptApprox' : 'kept') : hero.breakdown ? 'businessNetApprox' : 'businessNet';
  const running = shown.from <= today && today <= shown.to;
  const caption = running ? t(`${K}.hero.soFar`, { period: formatPeriod(period, shown, language) }) : formatPeriod(period, shown, language);
  const anyApprox = Boolean(hero.breakdown) || Boolean(owed.breakdown && owed.figure?.approximate) || rows.some((r) => r.primary.some((a) => a.approximate));
  const notes = [
    footnote.sharedInFull ? t(`${G}.footnote.shared`) : null,
    anyApprox && footnote.rateDate ? t(`${K}.hero.rateFooter`, { date: formatReportDay(footnote.rateDate, language) }) : null,
    footnote.omitted.length > 0 ? t(`${G}.footnote.omitted`, { currencies: footnote.omitted.join(', ') }) : null,
  ].filter((n): n is string => n !== null);

  const figure = hero.figure ? <CountUp minor={hero.figure.minor} currency={hero.figure.currency} reducedMotion={reducedMotion} /> : null;
  return (
    <>
      <section className="hp-glance-hero" aria-label={t(`${G}.label.${approxLabel}`)}>
        <span className="hp-report-label">
          {t(`${G}.label.${approxLabel}`)}
          {hero.inCurrencyOnly && <> · {t(`${G}.inOnly`, { currency: hero.inCurrencyOnly })}</>}
        </span>
        {hero.breakdown ? (
          <BreakdownButton className={`hp-glance-figure ${hero.negative ? 'is-negative' : ''}`} panel={<AmountsPanel amounts={hero.breakdown} rateDate={footnote.rateDate} />}>
            ≈ {figure}
          </BreakdownButton>
        ) : (
          <span className={`hp-glance-figure ${hero.negative ? 'is-negative' : ''}`}>{figure}</span>
        )}
        {usual ? (
          <p className={`hp-glance-usual is-${usual.direction}`}>
            {usual.direction !== 'about' && <span aria-hidden="true">{usual.direction === 'above' ? '▲ ' : '▼ '}</span>}
            {usual.direction === 'about' ? t(`${G}.usual.about`) : <Sentence text={t(`${G}.usual.${usual.direction}`, { amount: SLOT })} amount={text(usual.delta)} />}
          </p>
        ) : (
          <p className="hp-report-caption">{hero.negative ? t(`${K}.hero.keptNegative`) : caption}</p>
        )}
      </section>
      {glance.leavesOut.length > 0 && <p className="hp-glance-leaves hp-report-note">{t(`${G}.leavesOut`, { names: glance.leavesOut.map(isolate).join(language === 'ar' ? '، ' : ', ') })}</p>}
      <ul className="hp-glance-list" aria-label={t(`${G}.profilesLabel`)}>
        {rows.map((row) => (
          <li key={row.profileId}>
            <Row row={row} period={period} at={shown.from} />
          </li>
        ))}
      </ul>
      <div className={`hp-glance-owed ${owed.none ? 'is-none' : ''}`}>
        <span className="hp-glance-owed-label">
          {owed.none ? t(`${G}.owed.none`) : t(`${G}.owed.label`)}
          {owed.overdueCount > 0 && (
            <span className="hp-glance-overdue">
              <span className="hp-glance-dot" aria-hidden="true" />
              {tp(`${G}.owed.overdue`, owed.overdueCount, { count: owed.overdueCount })}
            </span>
          )}
        </span>
        {owed.figure &&
          (owed.breakdown && owed.figure.approximate ? (
            <BreakdownButton className="hp-glance-amount" panel={<AmountsPanel amounts={owed.breakdown} rateDate={footnote.rateDate} />}>
              <bdi>{text(owed.figure)}</bdi>
            </BreakdownButton>
          ) : (
            <span className="hp-glance-amount">
              {(owed.breakdown ?? [owed.figure]).map((a, i) => (
                <Fragment key={a.currency}>
                  {i > 0 && ' · '}
                  <bdi>{text(a)}</bdi>
                </Fragment>
              ))}
            </span>
          ))}
      </div>
      {notes.length > 0 && <p className="hp-glance-footnote hp-report-note">{notes.join(' · ')}</p>}
      <p className="hp-glance-hint hp-report-note">{t(`${G}.hint`)}</p>
    </>
  );
}

/** DD9: name (+ shared pill) · kind · primary figure at the inline end · an optional muted line · chevron. */
function Row({ row, period, at }: { row: GlanceRow; period: Period; at: string }) {
  const { t } = useLanguage();
  const text = useAmountText();
  const signed = row.kind !== 'spent';
  const kind = row.unavailable ? t(`${G}.row.${row.unavailable}`) : t(`${G}.row.${row.kind}`);
  const primary = row.primary.map((a) => text(a, signed)).join(' · ');
  const body = (
    <>
      <span className="hp-glance-name">
        <bdi>{row.name}</bdi>
        {row.shared && <span className="hp-glance-shared">{t(`${G}.row.shared`)}</span>}
        <span className="hp-glance-kind">{kind}</span>
      </span>
      {!row.unavailable && (
        <span className="hp-glance-figures">
          {row.empty ? (
            <span className="hp-glance-nothing">{t(`${G}.row.nothing`)}</span>
          ) : (
            <span className={`hp-glance-amount ${signed && (row.primary[0]?.minor ?? 0) < 0 ? 'is-negative' : ''}`}>
              {row.primary.map((a) => (
                <bdi key={a.currency}>{text(a, signed)}</bdi>
              ))}
            </span>
          )}
          {row.extra.map(({ kind: extraKind, amount }) =>
            extraKind === 'cameIn' ? (
              <span key={`in-${amount.currency}`} className="hp-glance-extra">
                <Sentence text={t(`${G}.row.cameIn`, { amount: SLOT })} amount={text(amount)} />
              </span>
            ) : (
              <span key={`more-${amount.currency}`} className="hp-glance-extra">
                <bdi>{text(amount, signed)}</bdi>
              </span>
            ),
          )}
        </span>
      )}
    </>
  );
  if (!row.link) return <div className="hp-glance-row">{body}</div>;
  const name = t(row.shared ? `${G}.row.linkNameShared` : `${G}.row.linkName`, { name: row.name, kind, amount: row.empty ? t(`${G}.row.nothing`) : primary });
  return (
    <Link to={`/p/${row.profileId}/reports`} search={{ period, at }} className="hp-glance-row press" aria-label={name}>
      {body}
      <span className="hp-glance-chevron" aria-hidden="true">
        ›
      </span>
    </Link>
  );
}

/** The exact amount per currency behind a ≈ figure, and the ECB day (DD8). */
function AmountsPanel({ amounts, rateDate }: { amounts: Amount[]; rateDate: string | null }) {
  const { t, language } = useLanguage();
  return (
    <>
      <table className="hp-report-breakdown-table">
        <tbody>
          {amounts.map((a) => (
            <tr key={a.currency}>
              <th scope="row">{a.currency}</th>
              <td>
                <DecimalAmount value={minorToDecimal(a.minor, a.currency)} currency={a.currency} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rateDate && <p className="hp-popover-foot">{t(`${K}.hero.rateFooter`, { date: formatReportDay(rateDate, language) })}</p>}
    </>
  );
}
