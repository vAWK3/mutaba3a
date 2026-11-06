import { useEffect, type ReactNode } from 'react';
import { Link, useLocation } from '@tanstack/react-router';
import { useT } from '../../lib/i18n/core';
import { syncPortalUsage } from '../analytics/portalAnalytics';
import { setReporterUser } from '../observability/errorReporting';
import type { HostedProfile } from '../api/client';
import { ChartIcon } from '../components/Icons';
import { ClientBooksIcon } from '../../components/icons/generated';
import { UsagePrompt } from '../components/UsagePrompt';
import { billingGateOf } from '../data/trialPrompt';
import { showsClientBooks } from '../pages/client-books/clientBooksRules';
import { useMe } from '../session/me';
import { useIsLocalMode } from '../session/mode';
import { AccountDrawers } from './AccountDrawers';
import { DESTINATIONS, destinationOf, destinationPath } from './destinations';
import { ProfileDrawers } from './ProfileDrawers';
import { TrialWelcomeOpener } from './TrialWelcomeOpener';
import { YouIsland } from './YouIsland';
import { backOf, sectionOf } from './youRoutes';

/**
 * `HostedShell` (hosted-portal.md §7.1, MUT-426): no sidebar and no header bar. Three glass objects float over the
 * page: the Reports corner icon (MUT-424 eng D2), the pill with the four destinations (MUT-424, ADR-192: Owed, Paid,
 * Spent, Clients; everything else one level in) and the You island (the profile, and the way to the You page). DOM
 * order is their reading order on both layouts, so the keyboard meets Reports, the tabs, then the island. One DOM for
 * every width: CSS puts the pill at the top on a desktop and at the bottom on a phone. The page still scrolls the
 * document, and reserves the chrome's space, so nothing is hidden at rest. There is no "+ Add" menu: the one create
 * action in the portal is the expense drawer, opened from the Expenses list itself. Signed in or out, the sections are
 * the same (MUT-287, epic MUT-284 decision 4).
 */

/** MUT-448: the account-level Reports (the Glance). */
const GLANCE_PATH = '/reports';
/** MUT-562: the accountant's Client books desk, outside any profile. */
const CLIENT_BOOKS_PATH = '/client-books';

/**
 * `pill` (MUT-562): a page outside any profile can bring its own pill (the desk's "Client books | My books"); a
 * profile's four destinations show otherwise.
 */
export function HostedShell({ profile, children, pill }: { profile: HostedProfile | null; children: ReactNode; pill?: ReactNode }) {
  const t = useT();
  const me = useMe();
  const userId = me.user.id;
  const local = useIsLocalMode();
  const pathname = useLocation({ select: (location) => location.pathname });
  // MUT-448: the Reports icon opens the Glance with the page it was pressed on, and a second press returns there
  const backParam = useLocation({ select: (location) => (location.search as Record<string, unknown>).back });
  const onGlance = pathname === GLANCE_PATH;
  // MUT-424 (E6): one map lights the destination, so /receivables lights Owed without being nested under it
  const lit = destinationOf(pathname);
  // MUT-361: a LOCKED profile has one page (ProfileLayout's LockedScreen), so no sections to move between.
  const sections = profile !== null && billingGateOf(me, profile) !== 'locked';
  // MUT-562 (13246): the Client books corner while any client is listed (active, or ended and not yet removed)
  const onDesk = pathname === CLIENT_BOOKS_PATH || pathname.startsWith(`${CLIENT_BOOKS_PATH}/`);
  const clientBooks = !local && showsClientBooks(me.clients);
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
      {/* One landmark for the whole chrome, so Reports and the island sit in one too (axe region); the pill is its
          own "Sections" nav inside it */}
      <nav className="hp-chrome" aria-label={t('hosted.brand')}>
        <div className="hp-fade hp-fade-top" />
        <div className="hp-fade hp-fade-bottom" />
        {sections && (
          <Link
            to={onGlance ? (backOf(backParam) ?? `/p/${profile.id}`) : GLANCE_PATH}
            search={onGlance ? undefined : { back: pathname }}
            className="hp-reports hp-glass press"
            aria-label={t('hosted.reports.title')}
            aria-current={onGlance || sectionOf(pathname) === 'reports' ? 'page' : undefined}
          >
            <ChartIcon />
          </Link>
        )}
        {clientBooks && (
          <Link
            to={CLIENT_BOOKS_PATH}
            className={`hp-client-books-corner hp-glass press${sections ? '' : ' hp-corner-first'}`}
            aria-label={t('hosted.clientBooks.corner')}
            aria-current={onDesk ? 'page' : undefined}
          >
            {/* Decorative: the link's label says Client books (MUT-558's drawn icon) */}
            <span aria-hidden="true" className="hp-corner-icon">
              <ClientBooksIcon size={18} />
            </span>
          </Link>
        )}
        <div className="hp-chrome-bar">
          {pill}
          {!pill && sections && (
            <nav className="hp-pill hp-glass" aria-label={t('hosted.shell.sections')}>
              {DESTINATIONS.map((destination) => (
                <Link
                  key={destination.key}
                  to={destinationPath(profile.id, destination.key)}
                  // TanStack adds aria-current to any active link; exact keeps that to the destination's own page,
                  // where `lit` agrees, so Owed's bare /p/:id isn't lit on every page under it.
                  activeOptions={{ exact: true, includeSearch: false }}
                  className={lit === destination.key ? 'hp-tab-on' : undefined}
                  aria-current={lit === destination.key ? 'page' : undefined}
                >
                  {t(`hosted.destinations.${destination.key}`)}
                </Link>
              ))}
            </nav>
          )}
          {/* MUT-425: the You page holds everything the profile switcher and the account menu did */}
          <YouIsland profile={profile} />
        </div>
      </nav>
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
