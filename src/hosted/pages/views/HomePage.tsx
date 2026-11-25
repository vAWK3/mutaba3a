import { useRef } from 'react';
import { useLanguage } from '../../../lib/i18n/core';
import { IncomeDrawerHost } from '../../components/IncomeDrawerHost';
import { LandingNotices } from '../../components/LandingNotices';
import { splitIncomeDrawer, type HomeSearch } from '../../data/filters';
import { incomeAffordancesFor } from '../../data/incomeAffordances';
import { useProfile, useWriteGate } from '../../session/me';
import { HomeInOut } from '../home/HomeInOut';
import { HomeTodo } from '../home/HomeTodo';
import { HomeViewSwitch } from '../home/HomeViewSwitch';
import { PageHeader } from './shared';

/**
 * Home (MUT-657, ADR-192 addendum): the bare `/p/:id`, the pill's first item and where opening the portal or switching
 * profile lands. Two views: Receipts & to-dos (what is waiting, never a total) and In & out (`?view=in-out`, this
 * month's money). The view lives only in the address, so coming back to home opens Receipts & to-dos. Add income opens
 * the income drawer over home (`?newIncome=`), as it does over Owed and Paid.
 */
export interface HomePageProps {
  search: HomeSearch;
  setSearch: (next: HomeSearch) => void;
}

export function HomePage({ search, setSearch }: HomePageProps) {
  const profile = useProfile();
  const { t } = useLanguage();
  const heading = useRef<HTMLHeadingElement>(null);
  const { writable } = useWriteGate();
  const { kinds } = incomeAffordancesFor(profile, writable);
  const { filters, drawer } = splitIncomeDrawer(search);
  // Home's income is most often money that came in; Owed where that is the only kind this profile records
  const onAddIncome = kinds.length > 0 ? () => setSearch({ ...filters, newIncome: kinds.includes('received') ? 'received' : kinds[0] }) : undefined;

  return (
    <>
      <PageHeader title={t('hosted.destinations.home')} headingRef={heading}>
        <HomeViewSwitch view={filters.view ?? 'todo'} onChange={(view) => setSearch({ ...filters, view: view === 'in-out' ? 'in-out' : undefined })} />
      </PageHeader>
      <LandingNotices heading={heading} />
      {filters.view === 'in-out' ? <HomeInOut profile={profile} /> : <HomeTodo profile={profile} onAddIncome={onAddIncome} />}
      <IncomeDrawerHost profile={profile} drawer={drawer} onClose={() => setSearch(filters)} onOpen={(next) => setSearch({ ...filters, ...next })} />
    </>
  );
}
