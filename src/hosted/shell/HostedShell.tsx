import { useEffect, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useT } from '../../lib/i18n/core';
import { syncPortalUsage } from '../analytics/portalAnalytics';
import { setReporterUser } from '../observability/errorReporting';
import type { HostedProfile } from '../api/client';
import { Wordmark } from '../components/Brand';
import { UsagePrompt } from '../components/UsagePrompt';
import { billingGateOf } from '../data/trialPrompt';
import { useMe } from '../session/me';
import { useIsLocalMode } from '../session/mode';
import { AccountDrawers } from './AccountDrawers';
import { ProfileDrawers } from './ProfileDrawers';
import { TrialWelcomeOpener } from './TrialWelcomeOpener';
import { YouLinks } from './YouLinks';

/**
 * `HostedShell` (hosted-portal.md §7.1): wordmark, the open profile's link to
 * the You page, the five read sections plus Expenses (MUT-44 — the portal's
 * only write), the avatar's link to the You page (MUT-425: both were menus),
 * and the page. There is still no "+ Add" menu: the one create action
 * in the portal is the expense drawer, opened from the Expenses list itself.
 * One DOM for every width; CSS turns the sidebar into a top bar on a phone,
 * so nothing is duplicated for assistive tech. Signed in or out, the sections
 * are the same (MUT-287, epic MUT-284 decision 4).
 */

/** The sidebar's lockup: the Arabic name beside it at 16px (design D3). */
const SIDEBAR_MARK_SIZE = 32;

const SECTIONS = [
  { path: '', key: 'overview', exact: true },
  // MUT-175 (X2): a nav item until MUT-426 moves Reports to the shell's corner icon
  { path: '/reports', key: 'reports', exact: false },
  { path: '/clients', key: 'clients', exact: false },
  { path: '/receivables', key: 'receivables', exact: false },
  { path: '/payments', key: 'payments', exact: false },
  { path: '/documents', key: 'documents', exact: false },
  { path: '/expenses', key: 'expenses', exact: false },
  { path: '/conversions', key: 'conversions', exact: false },
] as const;

export function HostedShell({ profile, children }: { profile: HostedProfile | null; children: ReactNode }) {
  const t = useT();
  const me = useMe();
  const userId = me.user.id;
  const local = useIsLocalMode();
  // MUT-155: another account's choice is reset; a stored "on" starts counting this visit. Never signed out (brief §10).
  useEffect(() => {
    if (!local) void syncPortalUsage(userId);
  }, [userId, local]);
  // MUT-149: crash reports carry the internal user id, nothing else about the person (AC3, eng D5)
  useEffect(() => {
    if (!local) setReporterUser(userId);
  }, [userId, local]);

  return (
    <div className="hp-shell">
      <aside className="hp-side">
        <Wordmark className="hp-side-wordmark" markSize={SIDEBAR_MARK_SIZE} />
        {/* MUT-425: the open profile's name opens You › Profiles (was the profile switcher) */}
        <YouLinks profile={profile} position="top" />
        {/* MUT-361: a LOCKED profile has one page (ProfileLayout's LockedScreen), so no sections to move between. */}
        {profile && billingGateOf(me, profile) !== 'locked' && (
          <nav className="hp-nav" aria-label={t('hosted.shell.sections')}>
            {SECTIONS.map((section) => (
              <Link
                key={section.key}
                to={`/p/${profile.id}${section.path}`}
                activeOptions={{ exact: section.exact }}
                activeProps={{ className: 'hp-nav-on', 'aria-current': 'page' }}
              >
                {t(`hosted.shell.nav.${section.key}`)}
              </Link>
            ))}
          </nav>
        )}
        <div className="hp-spacer" />
        {/* MUT-425: the avatar opens You › Account (was the account menu) */}
        <YouLinks profile={profile} position="bottom" />
      </aside>
      <main className="hp-page">
        {!local && <UsagePrompt />}
        {children}
      </main>
      {/* MUT-183: New profile / Manage profiles, opened by URL from You › Profiles or the empty state. */}
      <ProfileDrawers active={profile} />
      {/* MUT-237: Change password and the other account drawers, opened by URL from You › Account. */}
      <AccountDrawers />
      {/* MUT-418: the first-run trial step for a first sign-in that didn't come through /setup. */}
      {profile && <TrialWelcomeOpener />}
    </div>
  );
}
