import { useEffect, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useT } from '../../lib/i18n/core';
import { syncPortalUsage } from '../analytics/portalAnalytics';
import { setReporterUser } from '../observability/errorReporting';
import type { HostedProfile } from '../api/client';
import { Wordmark } from '../components/Brand';
import { UsagePrompt } from '../components/UsagePrompt';
import { useMe } from '../session/me';
import { useIsLocalMode } from '../session/mode';
import { AccountDrawers } from './AccountDrawers';
import { ProfileDrawers } from './ProfileDrawers';
import { ProfileSwitcher } from './ProfileSwitcher';
import { UserMenu } from './UserMenu';

/**
 * `HostedShell` (hosted-portal.md §7.1): wordmark, profile switcher, the five
 * read sections plus Expenses (MUT-44 — the portal's only write), the account
 * menu, and the page. There is still no "+ Add" menu: the one create action
 * in the portal is the expense drawer, opened from the Expenses list itself.
 * One DOM for every width; CSS turns the sidebar into a top bar on a phone,
 * so nothing is duplicated for assistive tech. Signed in or out, the sections
 * are the same (MUT-287, epic MUT-284 decision 4).
 */

const SECTIONS = [
  { path: '', key: 'overview', exact: true },
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
        <Wordmark className="hp-side-wordmark" />
        {me.profiles.length > 0 && <ProfileSwitcher active={profile} />}
        {profile && (
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
        <UserMenu profile={profile} />
      </aside>
      <main className="hp-page">
        {!local && <UsagePrompt />}
        {children}
      </main>
      {/* MUT-183: New profile / Manage profiles, opened by URL from the switcher or the empty state. */}
      <ProfileDrawers active={profile} />
      {/* MUT-237: Change password, opened by URL from the account menu. */}
      <AccountDrawers />
    </div>
  );
}
