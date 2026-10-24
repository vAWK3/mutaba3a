import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '../../../components/ui/Button';
import { SegmentedTabs } from '../../../components/filters/SegmentedTabs';
import { getLocale, useLanguage } from '../../../lib/i18n/core';
import { useTp } from '../../../lib/i18n/plural';
import { useMediaQuery, usePrefersReducedMotion } from '../../../lib/motion/mediaQuery';
import type { Currency, Expense, ExpenseGroup, ExpenseGroupSummary } from '../../api/client';
import { Empty, QueryView, Skeleton } from '../../components/QueryView';
import { useToast } from '../../components/Toast';
import { AddToGroupDrawer } from '../../components/groups/AddToGroupDrawer';
import { CategoryBars } from '../../components/groups/CategoryBars';
import { DayBars } from '../../components/groups/DayBars';
import { GroupDrawer } from '../../components/groups/GroupDrawer';
import { GroupMembers, type RowMotion } from '../../components/groups/GroupMembers';
import { usePopover } from '../../shell/usePopover';
import {
  INVERSE_VERB,
  barMode,
  motionKey,
  categoryRows,
  convertTotal,
  dayCount,
  defaultCurrency,
  filterMembers,
  groupByDay,
  groupStatus,
  otherCurrencyDays,
  perDay,
  reachedYear,
  toBars,
  verbFor,
  type Bar,
  type MemberDay,
  type RowList,
  type Verb,
} from '../../data/expenseGroups';
import { forgetGroup, groupLoads, groupsKey, useExpenseGroup, useFxRates, useGroupMarks, useGroupRows, useGroupSummary } from '../../data/expenseGroupQueries';
import { useExpenseCategories } from '../../data/expenseQueries';
import type { GroupDetailSearch } from '../../data/filters';
import { DecimalAmount } from '../../format/DecimalAmount';
import { formatDay, todayInZone } from '../../format/dates';
import { useProfile, useWriteGate } from '../../session/me';
import { PageHeader } from './shared';
import { useGroupRange } from './ExpenseGroupsList';

/**
 * One expense group (MUT-268 2A–23A): what the trip cost in every currency,
 * ≈ in the profile's currency at today's rate, then, for the selected
 * currency, per day, the day chart and the categories; the members by day
 * with Leave out / Remove, and Left out with Bring back. Every change shows at
 * once and the server's figures replace it silently (eng R1).
 */

/** Below this width the page takes its phone layout (21A). */
const NARROW_QUERY = '(max-width: 759px)';
/** Fractional digits shown for a "1 JOD = 5.23 ILS" rate. */
const RATE_DIGITS = 4;
/** Axis labels: about this many under a chart. */
const AXIS_LABELS = 8;
/** How long a day header keeps the jump highlight (row-flash). */
const FLASH_MS = 1200;

export interface ExpenseGroupDetailProps {
  groupId: string;
  search: GroupDetailSearch;
  setSearch: (next: GroupDetailSearch) => void;
}

export function ExpenseGroupDetail({ groupId, search, setSearch }: ExpenseGroupDetailProps) {
  const profile = useProfile();
  const { writable } = useWriteGate();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const showToast = useToast();
  const group = useExpenseGroup(profile.id, groupId);
  const summary = useGroupSummary(profile.id, groupId);
  const members = useGroupRows(profile.id, groupId, 'member');
  const today = todayInZone(profile.timezone);
  const groupsPath = `/p/${profile.id}/expenses/groups`;

  const deleted = (
    <Empty
      title={t('hosted.groups.detail.states.deletedTitle')}
      body={t('hosted.groups.detail.states.deletedBody')}
      action={
        <Link to={groupsPath} className="btn btn-secondary btn-sm">
          {t('hosted.groups.detail.states.backToGroups')}
        </Link>
      }
    />
  );

  const data = group.data && summary.data && members.data ? { group: group.data, summary: summary.data, members: members.data } : undefined;

  return (
    <>
      <nav className="hp-crumb" aria-label={t('hosted.groups.crumbLabel')}>
        <Link to={`/p/${profile.id}/expenses`} activeOptions={{ exact: true }}>
          {t('hosted.groups.tabExpenses')}
        </Link>
        <span aria-hidden="true"> › </span>
        <Link to={groupsPath} activeOptions={{ exact: true }}>
          {t('hosted.groups.tabGroups')}
        </Link>
      </nav>
      <QueryView queries={[group, summary, members]} data={data} notFound={deleted} loading={<DetailSkeleton />}>
        {(loaded) => <GroupBody {...loaded} today={today} search={search} setSearch={setSearch} />}
      </QueryView>
      {group.data && search.editGroup && writable && (
        <GroupDrawer
          profileId={profile.id}
          today={today}
          group={group.data}
          onClose={() => setSearch({ ...search, editGroup: undefined })}
          onSaved={(saved) => {
            showToast(t('hosted.groups.saved', { name: saved.name }), { tone: 'info' });
            setSearch({ ...search, editGroup: undefined });
          }}
          onDeleted={(gone) => {
            // Leave first, then forget: the page never refetches a deleted group into "This group was deleted" (eng R8)
            // …and off the cached list first, so it never shows there for a moment (review 9)
            queryClient.setQueriesData<{ items: ExpenseGroup[] }>({ queryKey: groupsKey(profile.id, 'list') }, (old) => old && { ...old, items: old.items.filter((g) => g.id !== gone.id) });
            void navigate({ to: groupsPath }).then(() => forgetGroup(queryClient, profile.id, gone.id));
            showToast(t('hosted.groups.deleted', { name: gone.name }), { tone: 'info' });
          }}
        />
      )}
    </>
  );
}

function DetailSkeleton() {
  return <Skeleton strip rows={4} />;
}

interface GroupBodyProps {
  group: ExpenseGroup;
  summary: ExpenseGroupSummary;
  members: Expense[];
  today: string;
  search: GroupDetailSearch;
  setSearch: (next: GroupDetailSearch) => void;
}

function GroupBody({ group, summary: served, members: servedMembers, today, search, setSearch }: GroupBodyProps) {
  const profile = useProfile();
  // MUT-361: a read-only profile shows the group, with nothing to add, edit, leave out or put back.
  const { writable } = useWriteGate();
  const { t, language } = useLanguage();
  const tp = useTp();
  const showToast = useToast();
  const queryClient = useQueryClient();
  const range = useGroupRange();
  const narrow = useMediaQuery(NARROW_QUERY);
  const reducedMotion = usePrefersReducedMotion();
  const excludedQuery = useGroupRows(profile.id, group.id, 'excluded');
  const categories = useExpenseCategories(profile.id);
  const marks = useGroupMarks(profile.id, group.id);
  const motion = useRef<RowMotion>({ leaving: new Set(), returning: new Set() });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [selectedBar, setSelectedBar] = useState<string | undefined>(undefined);

  // Which loads already carry each mark (eng R1)
  const loads = groupLoads(queryClient, profile.id, group.id);
  const summary = marks.summary(served, loads.summary);
  const rows = marks.rows(servedMembers, excludedQuery.data ?? [], loads);
  // The default tab is chosen once, from what the page first loaded (5A): pruning must not flip the chart mid-task
  const [firstChoice] = useState(() => defaultCurrency(served.currencies, profile.defaultCurrency));
  const currency = defaultCurrency(summary.currencies, profile.defaultCurrency, search.currency ?? firstChoice);
  const block = summary.currencies.find((c) => c.currency === currency);
  const names = useMemo(() => new Map((categories.data ?? []).map((c) => [c.id, c.name])), [categories.data]);
  const categoryName = (row: Expense) => (row.categoryId ? names.get(row.categoryId) ?? '—' : t('hosted.groups.detail.uncategorized'));
  const status = groupStatus(group, today);
  const days = dayCount(group, today);

  // ---- Actions (the action → request table lives in data/expenseGroups.ts) ----

  const toastKey: Record<Verb, string> = { leaveOut: 'leaveOut', remove: 'remove', bringBack: 'bringBack', add: 'add' };
  const titleOf = (row: Expense) => row.title || t('hosted.groups.detail.untitled');
  const otherList = (list: RowList, verb: Verb): RowList => (verb === 'leaveOut' ? 'excluded' : verb === 'bringBack' ? 'member' : list);

  async function act(verb: Verb, row: Expense, list: RowList) {
    const from = motionKey(list, row.id);
    // An added row isn't on screen yet: it neither leaves nor comes back
    if (verb !== 'add') {
      motion.current.leaving.add(from);
      // A refused save puts the row back the way it left (craft 2)
      motion.current.returning.add(from);
    }
    // Where it lands (Left out, or the members on Undo / Bring back / Add), it slides in from the inline end
    if (verb !== 'remove') motion.current.returning.add(motionKey(verb === 'leaveOut' ? 'excluded' : 'member', row.id));
    const ok = await marks.act(verb, row);
    if (ok) {
      motion.current.returning.delete(from);
      showToast(t(`hosted.groups.detail.toast.${toastKey[verb]}`, { title: titleOf(row), group: group.name }), {
        tone: 'info',
        action: { label: t('hosted.groups.detail.toast.undo'), onAction: () => void act(INVERSE_VERB[verb], row, otherList(list, verb)) },
      });
    } else {
      showToast(t('hosted.groups.detail.toast.failed', { title: titleOf(row) }), { action: { label: t('hosted.groups.detail.toast.retry'), onAction: () => void act(verb, row, list) } });
    }
  }

  async function leaveOutAll(targets: Expense[], label: string) {
    targets.forEach((row) => motion.current.leaving.add(motionKey('member', row.id)));
    const verbOf = (row: Expense) => verbFor('member', row.occurredOn, group);
    const inside = targets.filter((r) => verbOf(r) === 'leaveOut');
    const outside = targets.filter((r) => verbOf(r) === 'remove');
    // Cleared now, not after the saves: anything the person changes meanwhile (tab, a drawer) must survive
    setSearch({ ...search, category: undefined });
    const results = [await marks.actMany('leaveOut', inside), await marks.actMany('remove', outside)];
    const done = results.flatMap((r) => r.done);
    const failed = results.flatMap((r) => r.failed);
    if (failed.length > 0) {
      showToast(t('hosted.groups.detail.toast.partialLeftOut', { done: done.length, total: targets.length }), {
        action: { label: t('hosted.groups.detail.toast.retry'), onAction: () => void leaveOutAll(failed, label) },
      });
      return;
    }
    showToast(t('hosted.groups.detail.toast.leftOutMany', { count: done.length, category: label }), {
      tone: 'info',
      action: {
        label: t('hosted.groups.detail.toast.undo'),
        onAction: () => void undoMany(done),
      },
    });
  }

  /** Undo of a bulk leave-out: the two batches one after the other (one refetch each), and a toast if any fails. */
  async function undoMany(rows: Expense[]) {
    rows.forEach((row) => motion.current.returning.add(motionKey('member', row.id)));
    const back = await marks.actMany('bringBack', rows.filter((r) => verbFor('member', r.occurredOn, group) === 'leaveOut'));
    const kept = await marks.actMany('add', rows.filter((r) => verbFor('member', r.occurredOn, group) === 'remove'));
    const failed = [...back.failed, ...kept.failed];
    if (failed.length > 0) showToast(t('hosted.groups.detail.toast.failed', { title: titleOf(failed[0]!) }), { action: { label: t('hosted.groups.detail.toast.retry'), onAction: () => void undoMany(failed) } });
  }

  async function addRows(targets: Expense[]) {
    const result = await marks.actMany('add', targets);
    if (result.failed.length === 0) {
      setSearch({ ...search, addToGroup: undefined });
      showToast(t('hosted.groups.picker.added', { count: result.done.length, name: group.name }), { tone: 'info' });
    }
    return result;
  }

  function jumpTo(bar: Bar) {
    setSelectedBar(bar.key);
    const go = () => {
      const header = Array.from(document.querySelectorAll<HTMLElement>('.hp-dayhead')).find((el) => {
        const date = el.id.slice(-10);
        return date >= bar.from && date <= bar.to;
      });
      if (!header) return;
      header.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
      header.classList.add('row-flash');
      window.setTimeout(() => header.classList.remove('row-flash'), FLASH_MS);
      header.focus({ preventScroll: true });
    };
    if (search.category) {
      setSearch({ ...search, category: undefined });
      requestAnimationFrame(go);
    } else go();
  }

  // ---- Figures ----

  const converted = useConverted(summary, profile.defaultCurrency);
  const mode = barMode(summary, narrow);
  const bars = block ? toBars(block, mode, language) : [];
  const others = currency ? otherCurrencyDays(summary, currency) : new Map();
  const perDayValue = block ? perDay(block, group, today) : null;
  const categoriesShown = block ? categoryRows(block, names, t('hosted.groups.detail.uncategorized')) : [];
  const selectedCategory = categoriesShown.find((c) => c.key === search.category);
  const filtered = filterMembers(rows.members, selectedCategory ? search.category : undefined, currency);
  const memberDays: MemberDay[] = groupByDay(filtered, summary);
  const memberIds = new Set(rows.members.map((r) => r.id));

  const dayFormat = new Intl.DateTimeFormat(getLocale(language), { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const axisFormat = new Intl.DateTimeFormat(getLocale(language), { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const asDate = (day: string) => new Date(`${day}T00:00:00Z`);
  /** "before the trip", "after the trip", or "upcoming" for a future-dated member of a group still under way. */
  const positionLabel = (position: MemberDay['position'], date: string): string | null => {
    if (position === 'before') return t('hosted.groups.detail.before');
    if (position === 'in') return null;
    return group.endOn === null && date <= group.windowEnd ? t('hosted.groups.detail.upcoming') : t('hosted.groups.detail.after');
  };
  const separator = language === 'ar' ? '، ' : ', ';
  const describe = (bar: Bar) => {
    const when = mode === 'weekly' ? t('hosted.groups.range', { from: axisFormat.format(asDate(bar.from)), to: axisFormat.format(asDate(bar.to)) }) : dayFormat.format(asDate(bar.from));
    const amount = bar.minor === 0 ? t('hosted.groups.detail.noSpend', { currency: currency ?? '' }) : `${currency} ${bar.total}`;
    const other = mode === 'daily' ? others.get(bar.from) : undefined;
    return [
      when,
      amount,
      bar.count > 0 ? tp('hosted.groups.expenses', bar.count) : null,
      positionLabel(bar.position, bar.from),
      other ? t('hosted.groups.detail.otherCurrency', { currencies: other.join(separator) }) : null,
    ]
      .filter(Boolean)
      .join(separator);
  };
  const step = Math.max(1, Math.ceil(bars.length / AXIS_LABELS));
  const firstAfter = bars.find((b) => b.position === 'after')?.from ?? group.windowEnd;

  // ---- States ----

  const actions = writable ? <HeaderActions onAdd={() => setSearch({ ...search, addToGroup: true })} onEdit={() => setSearch({ ...search, editGroup: true })} /> : null;
  const addOutside = writable ? (
    <Button variant="secondary" size="sm" onClick={() => setSearch({ ...search, addToGroup: true })}>
      {t('hosted.groups.detail.addOutside')}
    </Button>
  ) : undefined;
  const nothing = rows.members.length === 0;
  let emptyState: ReactNode = null;
  if (nothing && rows.excluded.length > 0) emptyState = <Empty title={t('hosted.groups.detail.states.allOutTitle')} body={t('hosted.groups.detail.states.allOutBody')} />;
  else if (nothing && status === 'upcoming')
    emptyState = <Empty title={t('hosted.groups.detail.states.upcomingTitle', { name: group.name, date: formatDay(group.startOn, language) })} body={t('hosted.groups.detail.states.upcomingBody')} action={addOutside} />;
  else if (nothing) emptyState = <Empty title={t('hosted.groups.detail.states.emptyTitle')} body={t('hosted.groups.detail.states.emptyBody')} action={addOutside} />;

  const verbLabel = (verb: Verb) => t(`hosted.groups.detail.${verb === 'add' ? 'bringBack' : verb}`);

  return (
    <>
      <PageHeader title={group.name} headingRef={headingRef}>
        {actions}
      </PageHeader>
      <p className="hp-group-meta-line">
        {[range(group, today), days === null ? null : tp('hosted.groups.days', days), t(`hosted.groups.status.${status}`)].filter(Boolean).join(' · ')}
      </p>
      {reachedYear(group, today) && <p className="hp-group-note">{t('hosted.groups.reachedYear')}</p>}

      {summary.currencies.length > 0 && (
        <>
          <div className="hp-headline" role="group" aria-label={t('hosted.groups.detail.totalLabel')}>
            {summary.currencies.map((c) => (
              <span key={c.currency} className="hp-headline-item">
                <DecimalAmount value={c.total} currency={c.currency} className="hp-headline-amount" />
                <span className="hp-headline-count">{tp('hosted.groups.expenses', c.count)}</span>
              </span>
            ))}
          </div>
          {converted}
          <div className="hp-strip-row hp-group-controls">
            {summary.currencies.length > 1 && currency && (
              <div role="group" aria-label={t('hosted.groups.detail.currencyTabs')}>
                <SegmentedTabs<Currency>
                  options={summary.currencies.map((c) => ({ value: c.currency, label: c.currency }))}
                  value={currency}
                  onChange={(next) => setSearch({ ...search, currency: next, category: undefined })}
                />
              </div>
            )}
            {perDayValue && currency && (
              <p className="hp-perday">
                {t('hosted.groups.detail.perDay')} <DecimalAmount value={perDayValue} currency={currency} />{' '}
                <span className="hp-hint-icon" role="img" aria-label={t('hosted.groups.detail.perDayHint')} title={t('hosted.groups.detail.perDayHint')}>
                  ⓘ
                </span>
              </p>
            )}
          </div>
          {block && currency && (
            <div className="hp-group-sections">
              <section className="hp-group-section" aria-labelledby={`group-${group.id}-days`}>
                <h2 id={`group-${group.id}-days`} className="hp-section-title">
                  {t(mode === 'weekly' ? 'hosted.groups.detail.weekByWeek' : 'hosted.groups.detail.dayByDay')}
                </h2>
                <DayBars
                  bars={bars}
                  label={t(mode === 'weekly' ? 'hosted.groups.detail.chartLabelWeekly' : 'hosted.groups.detail.chartLabel', { currency })}
                  describe={describe}
                  axisLabel={(bar, index) => (index % step === 0 || index === bars.length - 1 ? axisFormat.format(asDate(bar.from)) : null)}
                  gapLabel={(position) => positionLabel(position, position === 'after' ? firstAfter : group.startOn) ?? ''}
                  hasOther={(bar) => mode === 'daily' && bar.position === 'in' && bar.minor === 0 && others.has(bar.from)}
                  selected={selectedBar}
                  onJump={jumpTo}
                  reducedMotion={reducedMotion}
                />
              </section>
              <section className="hp-group-section" aria-labelledby={`group-${group.id}-cats`}>
                <h2 id={`group-${group.id}-cats`} className="hp-section-title">
                  {t('hosted.groups.detail.byCategory')}
                </h2>
                <CategoryBars rows={categoriesShown} currency={currency} selected={selectedCategory?.key} onSelect={(category) => setSearch({ ...search, category })} reducedMotion={reducedMotion} />
              </section>
            </div>
          )}
        </>
      )}

      {emptyState}
      <GroupMembers
        group={group}
        days={memberDays}
        excluded={rows.excluded}
        narrow={narrow}
        categoryName={categoryName}
        dayLabel={positionLabel}
        verbLabel={verbLabel}
        onAct={(verb, row, list) => void act(verb, row, list)}
        motion={motion}
        fallbackFocus={headingRef}
        readOnly={!writable}
        excludedOpen={nothing}
        excludedError={
          excludedQuery.isError ? (
            <p className="form-error">
              {t('hosted.groups.detail.states.sectionError')}{' '}
              <button type="button" className="hp-link-button press" onClick={() => void excludedQuery.refetch()}>
                {t('hosted.states.unreachable.retry')}
              </button>
            </p>
          ) : undefined
        }
        filterBar={
          selectedCategory && (
            <div className="hp-member-filter">
              <button type="button" className="hp-filter-pill press" aria-label={t('hosted.groups.detail.clearCategory')} onClick={() => setSearch({ ...search, category: undefined })}>
                {selectedCategory.name} ×
              </button>
              <span>{tp('hosted.groups.expenses', filtered.length)}</span>
              {filtered.length > 0 && writable && (
                <Button variant="secondary" size="sm" onClick={() => void leaveOutAll(filtered, selectedCategory.name)}>
                  {t('hosted.groups.detail.leaveOutAll', { count: filtered.length, category: selectedCategory.name })}
                </Button>
              )}
            </div>
          )
        }
        labels={{
          members: t('hosted.groups.detail.membersTitle'),
          leftOut: t('hosted.groups.detail.leftOut', { count: rows.excluded.length }),
          kept: t('hosted.groups.detail.kept'),
          untitled: t('hosted.groups.detail.untitled'),
          columns: {
            title: t('hosted.groups.detail.columns.title'),
            category: t('hosted.groups.detail.columns.category'),
            amount: t('hosted.groups.detail.columns.amount'),
            action: t('hosted.groups.detail.columns.action'),
          },
        }}
      />
      {search.addToGroup && writable && (
        <AddToGroupDrawer profileId={profile.id} group={group} memberIds={memberIds} onClose={() => setSearch({ ...search, addToGroup: undefined })} onAdd={addRows} />
      )}
    </>
  );
}

/** Edit and Add from outside; on a phone they fold into a "⋯" menu (21A). */
function HeaderActions({ onAdd, onEdit }: { onAdd: () => void; onEdit: () => void }) {
  const { t } = useLanguage();
  const { open, close, toggle, buttonRef, panelRef } = usePopover();
  const choose = (action: () => void) => () => {
    close(false);
    action();
  };
  return (
    <div className="hp-group-actions">
      <div className="hp-group-actions-wide">
        <Button variant="secondary" size="sm" onClick={onAdd}>
          {t('hosted.groups.detail.addOutside')}
        </Button>
        <Button variant="secondary" size="sm" onClick={onEdit}>
          {t('hosted.groups.detail.edit')}
        </Button>
      </div>
      <div className="hp-group-actions-narrow">
        <button ref={buttonRef} type="button" className="btn btn-secondary btn-sm press" aria-haspopup="menu" aria-expanded={open} aria-label={t('hosted.groups.detail.moreActions')} onClick={toggle}>
          ⋯
        </button>
        {open && (
          <div ref={panelRef} className="hp-popover hp-grow-from-end hp-group-menu" role="menu" aria-label={t('hosted.groups.detail.moreActions')}>
            <button type="button" role="menuitem" className="hp-menu-item press" onClick={choose(onAdd)}>
              {t('hosted.groups.detail.addOutside')}
            </button>
            <button type="button" role="menuitem" className="hp-menu-item press" onClick={choose(onEdit)}>
              {t('hosted.groups.detail.edit')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** "≈ ILS 4,601.20 at today's ECB rate (17 Oct) · 1 JOD = 5.23 ILS (USD peg)" (2A, E9): only when it adds something. */
function useConverted(summary: ExpenseGroupSummary, base: Currency): ReactNode {
  const profile = useProfile();
  const { t, language } = useLanguage();
  const needed = summary.currencies.length > 1 || (summary.currencies.length === 1 && summary.currencies[0]!.currency !== base);
  const rates = useFxRates(profile.id, base, needed);
  if (!needed || !rates.data) return null;
  const total = convertTotal(summary, rates.data);
  if (!total) return null;
  const number = new Intl.NumberFormat(getLocale(language), { maximumFractionDigits: RATE_DIGITS });
  const rateLines = total.used.map(({ currency, rate, derived }) => {
    const line = t('hosted.groups.detail.rateLine', { from: currency, rate: number.format(1 / rate), to: total.currency });
    return derived ? `${line} (${t('hosted.groups.detail.peg')})` : line;
  });
  const when = total.stale ? t('hosted.groups.detail.convertedStale', { date: formatDay(total.rateDate, language) }) : t('hosted.groups.detail.convertedNote', { date: formatDay(total.rateDate, language) });
  return (
    <p className="hp-converted">
      ≈ <DecimalAmount value={total.total} currency={total.currency} className="hp-converted-amount" /> <small>{[when, ...rateLines].join(' · ')}</small>
    </p>
  );
}
