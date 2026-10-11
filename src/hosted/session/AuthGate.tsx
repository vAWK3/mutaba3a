import { Fragment, useEffect, useRef } from 'react';
import { Navigate, Outlet, useNavigate, useRouter } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../lib/i18n/core';
import { Button } from '../../components/ui/Button';
import { ApiError } from '../api/client';
import { useAdoptAccountLocale } from '../i18n/HostedLanguageProvider';
import { BootUnreachable, CheckingSession } from '../pages/auth/BootScreens';
import { HostedShell } from '../shell/HostedShell';
import { MeProvider, ProfileProvider, meQuery, useMe } from './me';
import { useSignOut } from './useSignOut';

/**
 * Everything behind sign-in (mut-43-auth-states.md S1, S2, S11, S12). Once the
 * person is known, a failed refetch of `/v1/me` keeps them in place: identity is
 * not a figure, and each view guards its own figures.
 */
export function AuthGate() {
  const me = useQuery(meQuery);
  const adoptAccountLocale = useAdoptAccountLocale();
  const locale = me.data?.user.locale;

  useEffect(() => {
    if (locale) adoptAccountLocale(locale);
  }, [locale, adoptAccountLocale]);

  if (me.data) {
    return (
      <MeProvider me={me.data}>
        <Outlet />
      </MeProvider>
    );
  }
  if (me.isPending) return <CheckingSession />;
  if (me.error instanceof ApiError && me.error.status === 401) return <RedirectToSignIn />;
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
    void navigate({ to: '/sign-in', search: { next: router.state.location.href }, replace: true });
  }, [navigate, router]);
  return null;
}

/** `/`: the first hosted profile, or S11 when the account has none. */
export function HomeRedirect() {
  const { profiles } = useMe();
  if (profiles.length === 0) return <NoProfiles />;
  return <Navigate to={`/p/${profiles[0].id}`} replace />;
}

function NoProfiles() {
  const t = useT();
  const { signOut, signingOut } = useSignOut();
  return (
    <HostedShell profile={null}>
      <div className="hp-empty">
        <h2>{t('hosted.auth.noProfiles.title')}</h2>
        <p>{t('hosted.auth.noProfiles.body')}</p>
        <Button variant="secondary" onClick={() => void signOut()} disabled={signingOut}>
          {t('hosted.auth.signOut')}
        </Button>
      </div>
    </HostedShell>
  );
}

/** `/p/$profileId`: the active profile, or S12 when it isn't (or is no longer) one of the person's. */
export function ProfileLayout({ profileId }: { profileId: string }) {
  const { profiles } = useMe();
  const profile = profiles.find((candidate) => candidate.id === profileId);
  if (!profile) {
    return (
      <HostedShell profile={null}>
        <ProfileUnavailable />
      </HostedShell>
    );
  }
  return (
    <ProfileProvider profile={profile}>
      <HostedShell profile={profile}>
        {/* Keyed so a switch remounts the views: no state or figure carries across profiles. */}
        <Fragment key={profile.id}>
          <Outlet />
        </Fragment>
      </HostedShell>
    </ProfileProvider>
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

function NoProfilesBody() {
  const t = useT();
  return (
    <div className="hp-empty">
      <h2>{t('hosted.auth.noProfiles.title')}</h2>
      <p>{t('hosted.auth.noProfiles.body')}</p>
    </div>
  );
}
