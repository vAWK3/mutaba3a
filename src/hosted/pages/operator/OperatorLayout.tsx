import type { ReactNode, RefObject } from 'react';
import { Link } from '@tanstack/react-router';
import { useT } from '../../../lib/i18n/core';
import { AlertIcon } from '../../components/Icons';
import { SectionTabs } from '../../components/SectionTabs';
import { useOperatorAccount, useOperatorFirmRequests, useOperatorSignups } from '../../data/operatorQueries';
import { OperatorStepUpProvider } from '../../operator/OperatorStepUp';
import { useMe } from '../../session/me';

/**
 * MUT-460 (ADR-213, design 6A): the operator console's frame, under `/operator`, in the shell with no profile (the You
 * island is the way out). A title and one tab per part, each with what waits in it. MUT-461 adds Accounts; MUT-462 Firms (with how many requests wait).
 *
 * MUT-527: a fourth tab, Your settings (your passkeys, the step-up, your own features). And when you have no passkey,
 * every page says once, at the top, that operator changes need one and where to add it, rather than each action failing.
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
    { to: '/operator/you', label: t('hosted.operator.tabs.you') },
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
        <NoPasskeyBanner />
        {children}
      </div>
    </OperatorStepUpProvider>
  );
}

/** Read from your own account view (shared with Your settings); says nothing until it is known, or if it can't be read. */
function NoPasskeyBanner() {
  const t = useT();
  const own = useOperatorAccount(useMe().user.id);
  if (own.data?.account.passkeyCount !== 0) return null;
  return (
    <div className="hp-banner hp-banner-warning hp-operator-no-passkey" role="status">
      <AlertIcon />
      <span>
        {t('hosted.operator.noPasskey.banner')}{' '}
        <Link to="/you/account" search={{ passkeys: true }}>
          {t('hosted.operator.noPasskey.link')}
        </Link>
      </span>
    </div>
  );
}
