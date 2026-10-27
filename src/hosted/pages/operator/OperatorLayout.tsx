import type { ReactNode, RefObject } from 'react';
import { useT } from '../../../lib/i18n/core';
import { SectionTabs } from '../../components/SectionTabs';
import { useOperatorFirmRequests, useOperatorSignups } from '../../data/operatorQueries';
import { OperatorStepUpProvider } from '../../operator/OperatorStepUp';

/**
 * MUT-460 (ADR-213, design 6A): the operator console's frame, under `/operator`, in the shell with no profile (the You
 * island is the way out). A title and one tab per part, each with what waits in it. MUT-461 adds Accounts; MUT-462 Firms (with how many requests wait).
 */
export function OperatorLayout({ headingRef, children }: { headingRef: RefObject<HTMLHeadingElement | null>; children: ReactNode }) {
  const t = useT();
  const signups = useOperatorSignups();
  const firms = useOperatorFirmRequests();
  const waiting = signups.data?.data.length;
  const requests = firms.data?.data.length;
  const tabs = [
    { to: '/operator/signups', label: waiting ? t('hosted.operator.tabs.signupsCount', { count: waiting }) : t('hosted.operator.tabs.signups') },
    { to: '/operator/accounts', label: t('hosted.operator.tabs.accounts') },
    { to: '/operator/firms', label: requests ? t('hosted.operator.tabs.firmsCount', { count: requests }) : t('hosted.operator.tabs.firms') },
  ];
  return (
    <OperatorStepUpProvider>
      <div className="hp-operator">
        <header className="hp-page-header">
          <h1 ref={headingRef} tabIndex={-1}>
            {t('hosted.operator.title')}
          </h1>
        </header>
        <SectionTabs label={t('hosted.operator.title')} tabs={tabs} />
        {children}
      </div>
    </OperatorStepUpProvider>
  );
}
