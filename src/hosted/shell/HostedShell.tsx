import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useT } from '../../lib/i18n/core';
import type { HostedProfile } from '../api/client';
import { Wordmark } from '../components/Brand';
import { useMe } from '../session/me';
import { ProfileSwitcher } from './ProfileSwitcher';
import { UserMenu } from './UserMenu';

/**
 * `HostedShell` (hosted-portal.md §7.1): wordmark, profile switcher, the five
 * read sections, the account menu, and the page. No "+ Add": the portal creates
 * nothing in MUT-43. One DOM for every width; CSS turns the sidebar into a top
 * bar on a phone, so nothing is duplicated for assistive tech.
 */

const SECTIONS = [
  { path: '', key: 'overview', exact: true },
  { path: '/clients', key: 'clients', exact: false },
  { path: '/receivables', key: 'receivables', exact: false },
  { path: '/payments', key: 'payments', exact: false },
  { path: '/documents', key: 'documents', exact: false },
] as const;

export function HostedShell({ profile, children }: { profile: HostedProfile | null; children: ReactNode }) {
  const t = useT();
  const me = useMe();

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
        <UserMenu />
      </aside>
      <main className="hp-page">{children}</main>
    </div>
  );
}
