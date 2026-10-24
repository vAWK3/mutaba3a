import { Fragment, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { Navigate, Outlet, useNavigate, useRouter, useSearch } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../lib/i18n/core';
import { Button } from '../../components/ui/Button';
import { ApiError } from '../api/client';
import { useAdoptAccountLocale } from '../i18n/HostedLanguageProvider';
import { BootUnreachable, CheckingSession, LocalUnavailable, ReloadToContinue } from '../pages/auth/BootScreens';
import { TermsUpdatePage } from '../pages/auth/TermsUpdatePage';
import { AccountClosingPage } from '../pages/auth/AccountClosingPage';
import { HostedShell } from '../shell/HostedShell';
import { useProfileDrawers } from '../shell/ProfileDrawers';
import { MeProvider, ProfileProvider, meQuery, useMe } from './me';
import { useLostAccess } from './lostAccess';
import { useIsLocalMode } from './mode';
import { ProfileBanner } from '../components/ProfileBanner';
import { LapseBanner, LockedScreen } from '../components/LapseGate';
import { billingGateOf } from '../data/trialPrompt';
import { pickShellOverlay } from '../data/filters';
import { useSignOut } from './useSignOut';

/**
 * Everything behind sign-in (mut-43-auth-states.md S1, S2, S11, S12). Once the
 * person is known, a failed refetch of `/v1/me` keeps them in place: identity is
 * not a figure, and each view guards its own figures.
 */
export function AuthGate() {
  const me = useQuery(meQuery);
  const navigate = useNavigate();
  const adoptAccountLocale = useAdoptAccountLocale();
  // Signed out there is no account to take a language from: a choice here, else Arabic (MUT-286 AC1)
  const local = useIsLocalMode();
  const locale = local ? undefined : me.data?.user.locale;

  // Before paint, so the signed-in view never shows a frame in the wrong language (MUT-209)
  useLayoutEffect(() => {
    if (locale) adoptAccountLocale(locale);
  }, [locale, adoptAccountLocale]);

  // MUT-333: a closing account sees only the closing page (the server refuses everything else); before the terms,
  // since a person leaving needn't accept new ones to keep or leave.
  if (me.data?.user.closure) return <AccountClosingPage me={me.data} />;
  // MUT-324: someone behind on the terms reads and accepts them before anything else; null (signed out) never asks
  if (me.data?.terms?.accepted === false) return <TermsUpdatePage version={me.data.terms.version} />;
  if (me.data) {
    return (
      <MeProvider me={me.data}>
        <Outlet />
      </MeProvider>
    );
  }
  if (me.isPending) return <CheckingSession />;
  if (me.error instanceof ApiError && me.error.status === 401) return <RedirectToSignIn />;
  if (me.error instanceof ApiError && (me.error.code === 'LOCAL_FORMAT_TOO_NEW' || me.error.code === 'LOCAL_SAVE_FAILED')) {
    return <ReloadToContinue stop={me.error.code} />;
  }
  if (me.error instanceof ApiError && me.error.code === 'LOCAL_UNAVAILABLE') {
    return <LocalUnavailable onRetry={() => void me.refetch()} onSignIn={() => void navigate({ to: '/sign-in' })} />;
  }
  return <BootUnreachable onRetry={() => void me.refetch()} retrying={me.isFetching} />;
}

/**
 * Nobody is signed in: go to sign-in, remembering where they were headed. The
 * location is read once, at mount; while the navigation is pending this
 * component still renders with the *new* location, and reading it then would
 * make `next` point at sign-in itself.
 */
function RedirectToSignIn() {
  const router = useRouter();
  const navigate = useNavigate();
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    const next = router.state.location.href;
    void navigate({ to: '/sign-in', search: next === '/' ? {} : { next }, replace: true });
  }, [navigate, router]);
  return null;
}

/** The first hosted profile at `to`, or S11 when the account has none. */
function FirstProfileRedirect({ to }: { to: string }) {
  const { profiles } = useMe();
  // MUT-418 (D14): the shell's drawer keys ride along, so `/?billing=true&step=subscribe` (a mail's link, the lapse
  // gate) opens Billing on the profile it lands on.
  const overlay = pickShellOverlay(useSearch({ strict: false }) as Record<string, unknown>);
  if (profiles.length === 0) return <NoProfiles />;
  return <Navigate to={`/p/${profiles[0].id}${to}`} search={overlay as never} replace />;
}

/** `/`: the first hosted profile, or S11 when the account has none. */
export function HomeRedirect() {
  return <FirstProfileRedirect to="" />;
}

/**
 * `/capture`: the desktop-browser fallback for the iOS/Android universal
 * link when the app isn't installed (MUT-111). AuthGate already gives this
 * the same sign-in-then-return dance as every other authed route; there is
 * no profile id in the URL, so it lands on the first profile's expenses page.
 */
export function CaptureRedirect() {
  return <FirstProfileRedirect to="/expenses" />;
}

/**
 * S11, MUT-183: no profile yet. Since MUT-182 a person can create their own,
 * so the empty state offers New profile (the shell's drawer) beside Sign out
 * instead of sending them to whoever set up the account.
 */
function NoProfiles() {
  const t = useT();
  const { signOut, signingOut } = useSignOut();
  return (
    <HostedShell profile={null}>
      <NoProfilesBody>
        <Button variant="secondary" onClick={() => void signOut()} disabled={signingOut}>
          {t('hosted.auth.signOut')}
        </Button>
      </NoProfilesBody>
    </HostedShell>
  );
}

/**
 * `/p/$profileId`: the active profile, or S12 when it isn't (or is no longer) one of the person's. MUT-373 (DR3): when
 * the profile that was open here drops out of `/v1/me` — a co-owner removed — the person lands on their personal
 * profile with a banner that names it, instead of S12.
 */
export function ProfileLayout({ profileId }: { profileId: string }) {
  const me = useMe();
  const { profiles } = me;
  const profile = profiles.find((candidate) => candidate.id === profileId);
  const open = useLostAccess((s) => s.open);
  const remember = useLostAccess((s) => s.remember);
  useEffect(() => {
    if (profile) remember(profile.id, profile.name);
  }, [profile, remember]);
  if (!profile) {
    const personal = profiles.find((candidate) => candidate.isPersonalDefault);
    if (open?.id === profileId && personal) return <LostAccessRedirect name={open.name} to={personal.id} />;
    return (
      <HostedShell profile={null}>
        <ProfileUnavailable />
      </HostedShell>
    );
  }
  // MUT-361: a LOCKED profile is one full page (Subscribe, Download my records); a read-only or failing one keeps its
  // pages under a banner that says why.
  const locked = billingGateOf(me, profile) === 'locked';
  return (
    <ProfileProvider profile={profile}>
      <HostedShell profile={profile}>
        <LostAccessBanner />
        {/* Keyed so a switch remounts the views: no state or figure carries across profiles. */}
        <Fragment key={profile.id}>
          {locked ? (
            <LockedScreen profile={profile} />
          ) : (
            <>
              <LapseBanner profile={profile} />
              <Outlet />
            </>
          )}
        </Fragment>
      </HostedShell>
    </ProfileProvider>
  );
}

function LostAccessRedirect({ name, to }: { name: string; to: string }) {
  const lose = useLostAccess((s) => s.lose);
  useEffect(() => lose(name), [lose, name]);
  return <Navigate to={`/p/${to}` as never} replace />;
}

/** DR3: persistent until dismissed — losing access to your business's books is not a passing toast. */
function LostAccessBanner() {
  const t = useT();
  const lost = useLostAccess((s) => s.lost);
  const dismiss = useLostAccess((s) => s.dismiss);
  if (!lost) return null;
  return (
    <div className="hp-lost-access">
      <ProfileBanner banner={{ tone: 'info', key: 'hosted.auth.lostAccess', vars: { profile: lost.name } }}>
        {' '}
        <button type="button" className="hp-link-button" onClick={dismiss}>
          {t('common.close')}
        </button>
      </ProfileBanner>
    </div>
  );
}

function ProfileUnavailable() {
  const t = useT();
  const navigate = useNavigate();
  const { profiles } = useMe();
  const first = profiles[0];
  if (!first) return <NoProfilesBody />;
  return (
    <div className="hp-empty">
      <h2>{t('hosted.auth.unavailable.title')}</h2>
      <p>{t('hosted.auth.unavailable.body')}</p>
      <Button onClick={() => void navigate({ to: `/p/${first.id}` })}>{t('hosted.auth.unavailable.goTo', { name: first.name })}</Button>
    </div>
  );
}

function NoProfilesBody({ children }: { children?: ReactNode }) {
  const t = useT();
  const { openNew } = useProfileDrawers();
  return (
    <div className="hp-empty">
      <h2>{t('hosted.auth.noProfiles.title')}</h2>
      <p>{t('hosted.auth.noProfiles.body')}</p>
      <div className="hp-empty-actions">
        <Button onClick={openNew}>{t('hosted.shell.switcher.newProfile')}</Button>
        {children}
      </div>
    </div>
  );
}
