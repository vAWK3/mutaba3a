import { useId, useMemo, useState, type ReactNode } from 'react';
import { parseAmountToMinor } from '../../../lib/utils';
import { Link } from '@tanstack/react-router';
import { SegmentedTabs } from '../../../components/filters/SegmentedTabs';
import { useLanguage } from '../../../lib/i18n/core';
import type { Currency, HostedProfile } from '../../api/client';
import { Skeleton, Unreachable } from '../../components/QueryView';
import { useOrganizationSummary } from '../../data/queries';
import { useNameDirectories, useReportActivity } from '../../data/reportQueries';
import { periodRange } from '../../data/reports';
import { DecimalAmount, isZeroDecimal } from '../../format/DecimalAmount';
import { todayInZone } from '../../format/dates';
import { formatMonth } from '../../format/reportFormat';

/** The categories Money out names; the rest wait in Spent and Reports. */
const TOP_CATEGORIES = 3;

interface Figures {
  currency: Currency;
  received: string;
  spent: string;
  owed: string;
  overdue: string;
  byCategory: { categoryId: string | null; total: string }[];
}

const ZERO = '0.00';
const PERCENT = 100;

type ActivityCurrencies = { currency: Currency; received: string; spent: string; byCategory: Figures['byCategory'] }[];
type SummaryCurrencies = { currency: Currency; outstanding: string; overdue: string }[];

/** Each currency with any figure this month or now: activity's received and spent beside the summary's owed and overdue. */
function figuresOf(activity: ActivityCurrencies, summary: SummaryCurrencies): Figures[] {
  const byCurrency = new Map<Currency, Figures>();
  const at = (currency: Currency) => byCurrency.get(currency) ?? byCurrency.set(currency, { currency, received: ZERO, spent: ZERO, owed: ZERO, overdue: ZERO, byCategory: [] }).get(currency)!;
  for (const c of activity) Object.assign(at(c.currency), { received: c.received, spent: c.spent, byCategory: c.byCategory });
  for (const b of summary) Object.assign(at(b.currency), { owed: b.outstanding, overdue: b.overdue });
  return [...byCurrency.values()].filter((f) => [f.received, f.spent, f.owed, f.overdue].some((v) => !isZeroDecimal(v)));
}

/**
 * Home's In & out (MUT-657, `?view=in-out`, the monthly summary mail's landing): this month's money in (received, with
 * owed and overdue as they stand now) and money out (spent, its biggest categories), one currency at a time, with the
 * ways on to Owed, Spent and Reports. The currency is the page's own state: `?currency=` on the bare path belongs to
 * Owed's old address. Reads the org summary (shared with Owed) and this month's activity (shared with Reports).
 */
export function HomeInOut({ profile }: { profile: HostedProfile }) {
  const { t, language } = useLanguage();
  const today = todayInZone(profile.timezone);
  const range = useMemo(() => periodRange('month', today, language), [today, language]);
  const profiles = useMemo(() => [profile], [profile]);
  const [activity] = useReportActivity(profiles, range, 'day');
  const summary = useOrganizationSummary(profile.id);
  const names = useNameDirectories(profiles).byProfile.get(profile.id);
  const [picked, setPicked] = useState<Currency | null>(null);

  if (summary.isError || activity?.status === 'failed' || activity?.status === 'forbidden') {
    return <Unreachable onRetry={() => (summary.isError ? void summary.refetch() : activity?.retry())} />;
  }
  if (!summary.data || !activity?.data) return <Skeleton rows={3} />;

  const blocks = figuresOf(activity.data.currencies, summary.data.currencies);
  const block = blocks.find((b) => b.currency === picked) ?? blocks.find((b) => b.currency === profile.defaultCurrency) ?? blocks[0];
  const month = formatMonth(range.from.slice(0, 7), language, today);
  const shown: Figures = block ?? { currency: profile.defaultCurrency, received: ZERO, spent: ZERO, owed: ZERO, overdue: ZERO, byCategory: [] };
  // Minor units only to order and size the bars: amounts stay decimal strings everywhere they are shown
  const categories = shown.byCategory
    .map((c) => ({ ...c, minor: parseAmountToMinor(c.total, shown.currency) }))
    .sort((a, b) => b.minor - a.minor)
    .slice(0, TOP_CATEGORIES);
  const largest = Math.max(0, ...categories.map((c) => c.minor));

  return (
    <>
      {blocks.length > 1 && (
        <div className="hp-home-currency">
          <SegmentedTabs<Currency> options={blocks.map((b) => ({ value: b.currency, label: b.currency }))} value={shown.currency} onChange={setPicked} />
        </div>
      )}
      <div className="hp-home-io">
        <Column title={t('hosted.home.inOut.in')} figure={<DecimalAmount value={shown.received} currency={shown.currency} className="hp-home-io-in" />} caption={t('hosted.home.inOut.received', { month })}>
          <dl className="hp-home-io-kv">
            <div>
              <dt>{t('hosted.home.inOut.owedNow')}</dt>
              <dd>
                <DecimalAmount value={shown.owed} currency={shown.currency} />
              </dd>
            </div>
            <div>
              <dt>{t('hosted.home.inOut.overdueNow')}</dt>
              <dd className={isZeroDecimal(shown.overdue) ? undefined : 'hp-danger'}>
                <DecimalAmount value={shown.overdue} currency={shown.currency} />
              </dd>
            </div>
          </dl>
          <Link to={`/p/${profile.id}/owed`} className="hp-home-io-link">
            {t('hosted.home.inOut.toOwed')}
          </Link>
        </Column>
        <Column title={t('hosted.home.inOut.out')} figure={<DecimalAmount value={shown.spent} currency={shown.currency} />} caption={t('hosted.home.inOut.spent', { month })}>
          {categories.length > 0 && (
            <ul className="hp-home-io-bars">
              {categories.map((c) => (
                <li key={c.categoryId ?? 'none'}>
                  <span dir="auto">{c.categoryId ? (names?.categories.get(c.categoryId) ?? '—') : t('hosted.home.inOut.uncategorized')}</span>
                  <DecimalAmount value={c.total} currency={shown.currency} />
                  <span className="hp-home-io-track" aria-hidden="true">
                    <span style={{ inlineSize: `${largest > 0 ? (c.minor / largest) * PERCENT : 0}%` }} />
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link to={`/p/${profile.id}/expenses`} className="hp-home-io-link">
            {t('hosted.home.inOut.toSpent')}
          </Link>
        </Column>
      </div>
      <p className="hp-home-io-more">
        <Link to={`/p/${profile.id}/reports`} className="hp-home-io-link">
          {t('hosted.home.inOut.toReports')}
        </Link>
      </p>
    </>
  );
}

function Column({ title, figure, caption, children }: { title: string; figure: ReactNode; caption: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="hp-home-io-col" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      <p className="hp-home-io-figure">{figure}</p>
      <p className="hp-home-io-caption">{caption}</p>
      {children}
    </section>
  );
}
