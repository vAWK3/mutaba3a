/* eslint-disable react-refresh/only-export-components */
import { useMemo } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { Button } from '../../../components/ui/Button';
import { useLanguage } from '../../../lib/i18n/core';
import { useTp } from '../../../lib/i18n/plural';
import type { ExpenseGroup } from '../../api/client';
import { Empty, QueryView, Skeleton } from '../../components/QueryView';
import { SectionTabs } from '../../components/SectionTabs';
import { useToast } from '../../components/Toast';
import { GroupDrawer } from '../../components/groups/GroupDrawer';
import { dayCount, groupStatus, needsEndDate, reachedYear, type GroupStatus } from '../../data/expenseGroups';
import { useExpenseGroups } from '../../data/expenseGroupQueries';
import type { GroupsPageSearch } from '../../data/filters';
import { DecimalAmount } from '../../format/DecimalAmount';
import { formatDay, todayInZone } from '../../format/dates';
import { useProfile, useWriteGate } from '../../session/me';
import { PageHeader } from './shared';

/**
 * Expenses › Groups (MUT-268 1A, 3A): every group of the profile, ongoing first,
 * then upcoming, then past; each row its dates, day count, member count and up
 * to two currency totals. New group opens by URL (`?newGroup=1`).
 */

const STATUS_ORDER: Record<GroupStatus, number> = { ongoing: 0, upcoming: 1, past: 2 };
const SHOWN_CURRENCIES = 2;
const LIST_SKELETON_ROWS = 3;

export function useExpensesTabs() {
  const profile = useProfile();
  const { t } = useLanguage();
  return {
    label: t('hosted.groups.sectionsLabel'),
    tabs: [
      { to: `/p/${profile.id}/expenses`, label: t('hosted.groups.tabExpenses'), exact: true },
      { to: `/p/${profile.id}/expenses/groups`, label: t('hosted.groups.tabGroups') },
    ],
  };
}

/** "3 Oct – today" for an open group under way, "5 – 7 Oct 2026" style otherwise (formatDay keeps the year). */
export function useGroupRange() {
  const { t, language } = useLanguage();
  return (group: ExpenseGroup, today: string) => {
    const end = group.endOn ?? (today >= group.startOn && today <= group.windowEnd ? null : group.windowEnd);
    return t('hosted.groups.range', { from: formatDay(group.startOn, language), to: end ? formatDay(end, language) : t('hosted.groups.today') });
  };
}

export interface ExpenseGroupsListProps {
  search: GroupsPageSearch;
  setSearch: (next: GroupsPageSearch) => void;
}

export function ExpenseGroupsList({ search, setSearch }: ExpenseGroupsListProps) {
  const profile = useProfile();
  const { writable } = useWriteGate();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const showToast = useToast();
  const groups = useExpenseGroups(profile.id);
  const tabs = useExpensesTabs();
  const today = todayInZone(profile.timezone);

  const ordered = useMemo(
    () => groups.data && [...groups.data].sort((a, b) => STATUS_ORDER[groupStatus(a, today)] - STATUS_ORDER[groupStatus(b, today)]),
    [groups.data, today],
  );

  const openNew = () => setSearch({ ...search, newGroup: true });
  // MUT-361: a read-only profile shows its groups, with nothing to start (a `?newGroup` link included).
  const newButton = writable ? (
    <Button variant="primary" size="sm" onClick={openNew}>
      {t('hosted.groups.new')}
    </Button>
  ) : null;

  return (
    <>
      <PageHeader title={t('hosted.destinations.spent')}>{newButton}</PageHeader>
      <SectionTabs {...tabs} />
      <QueryView
        queries={[groups]}
        data={ordered}
        loading={<Skeleton rows={LIST_SKELETON_ROWS} />}
        isEmpty={(rows) => rows.length === 0}
        empty={<Empty title={t('hosted.groups.empty.title')} body={t('hosted.groups.empty.body')} action={newButton} />}
      >
        {(rows) => (
          <ul className="hp-groups" aria-label={t('hosted.groups.listLabel')}>
            {rows.map((group) => (
              <GroupRow key={group.id} group={group} today={today} />
            ))}
          </ul>
        )}
      </QueryView>
      {search.newGroup && writable && (
        <GroupDrawer
          profileId={profile.id}
          today={today}
          onClose={() => setSearch({ ...search, newGroup: undefined })}
          onCreated={(group) => {
            showToast(t('hosted.groups.created', { name: group.name }), { tone: 'info' });
            void navigate({ to: `/p/${profile.id}/expenses/groups/${group.id}` });
          }}
        />
      )}
    </>
  );
}

function GroupRow({ group, today }: { group: ExpenseGroup; today: string }) {
  const profile = useProfile();
  const { t } = useLanguage();
  const tp = useTp();
  const range = useGroupRange();
  const status = groupStatus(group, today);
  const days = dayCount(group, today);
  const shown = group.currencies.slice(0, SHOWN_CURRENCIES);
  const hidden = group.currencies.length - shown.length;
  const to = `/p/${profile.id}/expenses/groups/${group.id}`;

  return (
    <li className="hp-group-row">
      <Link to={to} className="hp-group-link">
        <span className="hp-group-name">
          <span className="hp-group-title">{group.name}</span>
          <span className={`hp-group-chip hp-group-chip-${status}`}>{t(`hosted.groups.status.${status}`)}</span>
        </span>
        <span className="hp-group-totals">
          {shown.length === 0
            ? '—'
            : shown.map((c, i) => (
                <span key={c.currency}>
                  {i > 0 && ' · '}
                  <DecimalAmount value={c.total} currency={c.currency} />
                </span>
              ))}
          {hidden > 0 && <span> · {t('hosted.groups.moreCurrencies', { count: hidden })}</span>}
        </span>
        <span className="hp-group-meta">
          {[range(group, today), days === null ? null : tp('hosted.groups.days', days), group.memberCount === 0 ? t('hosted.groups.nothingYet') : tp('hosted.groups.expenses', group.memberCount)]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </Link>
      {reachedYear(group, today) && <p className="hp-group-note">{t('hosted.groups.reachedYear')}</p>}
      {needsEndDate(group, today) && (
        <Link to={to} search={{ editGroup: true }} className="hp-link hp-group-note">
          {t('hosted.groups.nudge')}
        </Link>
      )}
    </li>
  );
}

export function ExpenseGroupsPage(props: ExpenseGroupsListProps) {
  return <ExpenseGroupsList {...props} />;
}
