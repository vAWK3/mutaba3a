import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLanguage } from '../../../lib/i18n/core';
import { useTp } from '../../../lib/i18n/plural';
import { Button } from '../../../components/ui/Button';
import { BrandLoader } from '../../../components/brand/BrandLoader';
import { api, type AccountantInviteCheck } from '../../api/client';
import { countPublicPage } from '../../analytics/portalAnalytics';
import { AlertIcon, LockIcon } from '../../components/Icons';
import { TwoPanelLayout } from '../../components/TwoPanelLayout';
import { TurnstileWidget } from '../../components/turnstile/TurnstileWidget';
import { useTurnstile } from '../../components/turnstile/useTurnstile';
import { browserTimezone } from '../../format/timezones';
import { useAdoptAccountLocale } from '../../i18n/HostedLanguageProvider';
import { ME_KEY, meQuery } from '../../session/me';
import { setMode, useMode } from '../../session/mode';
import { useSignOut } from '../../session/useSignOut';
import { TERMS_CLIENT_RELEASE, termsHref } from '../../terms';
import { CLIENT_BOOKS_KEY } from '../../data/clientBooksQueries';
import { NEW_PASSWORD_POLICY, passwordProblem, tokenFromHash } from '../auth/setupLink';
import {
  acceptOutcome,
  forgetInviteForTab,
  inviteEnds,
  inviteForTab,
  inviteView,
  rememberInviteForTab,
  signupFailure,
  type InviteOutcome,
  type InviteView,
} from './inviteState';

/**
 * `/accountant-invite#<token>` (MUT-562 over MUT-559's routes, layout B): where an accountant invite's email lands.
 * Public, and works signed in too. The token is read from the fragment and stripped at once (`replace`, as /setup),
 * then kept for this tab so it survives the sign-in round trip. Signed out: Sign in to accept, or Create an account
 * (signup, then POST /v1/sessions, 13231). Signed in: Accept. Either way the person lands on the new client (AC4).
 *
 * TODO(MUT-561): the context panel's `shared-books` scene and the four scope bullets (AccessScopeList) once MUT-561's
 * Scene and AccessScopeList merge; until then the panel is the one-line explanation.
 * TODO(blocked-by MUT-565): a 402 ACCOUNTANT_PLAN_REQUIRED on accept (a 4th client) shows the Accountant plan card in
 * place of Accept, the invite staying open (SL6); see `acceptOutcome`.
 */
const INVITE_PATH = '/accountant-invite';
const NAME_MAX_LENGTH = 200;

export function AcceptInvitePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const incoming = tokenFromHash(location.hash);
  const [token, setToken] = useState(() => incoming ?? inviteForTab());
  if (incoming && incoming !== token) setToken(incoming);

  useEffect(() => {
    if (!location.hash) return;
    if (incoming) rememberInviteForTab(incoming);
    void navigate({ to: INVITE_PATH, replace: true });
  }, [location.hash, incoming, navigate]);

  if (!token) return <Frame context={null}><GoneCard /></Frame>;
  return <Invite key={token} token={token} />;
}

function Invite({ token }: { token: string }) {
  const mode = useMode();
  const remoteMaybe = mode === 'remote' || mode === 'probe';
  const me = useQuery({ ...meQuery, enabled: remoteMaybe });
  const check = useQuery({
    queryKey: ['accountantInvite', 'check', token],
    queryFn: ({ signal }) => api.checkAccountantInvite(token, signal),
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const [signingUp, setSigningUp] = useState(false);
  const [outcome, setOutcome] = useState<InviteOutcome>(null);

  const signedIn = !remoteMaybe ? false : me.isPending ? null : Boolean(me.data);
  const view = inviteView({
    check: check.isPending ? { status: 'pending' } : check.isError ? { status: 'error', error: check.error } : { status: 'success', data: check.data },
    signedIn,
    signingUp,
    outcome,
  });
  const invite = check.data ?? null;

  return (
    <Frame context={invite && view.kind !== 'gone' ? <InviteContext invite={invite} mismatch={view.kind === 'mismatch'} /> : null}>
      <Body view={view} token={token} invite={invite} email={me.data?.user.email ?? null} hasClients={(me.data?.clients?.length ?? 0) > 0} onSignup={setSigningUp} onOutcome={setOutcome} onRetry={() => void check.refetch()} />
    </Frame>
  );
}

function Frame({ context, children }: { context: ReactNode; children: ReactNode }) {
  const { t } = useLanguage();
  return <TwoPanelLayout context={context ?? <p className="hp-two-panel-lead">{t('hosted.accountantInvite.mismatch.context')}</p>}>{children}</TwoPanelLayout>;
}

function InviteContext({ invite, mismatch }: { invite: AccountantInviteCheck; mismatch: boolean }) {
  const { t } = useLanguage();
  if (mismatch) return <p className="hp-two-panel-lead">{t('hosted.accountantInvite.mismatch.context')}</p>;
  return <p className="hp-two-panel-lead">{invite.ownerName ? t('hosted.accountantInvite.about', { owner: invite.ownerName }) : t('hosted.accountantInvite.aboutNoOwner')}</p>;
}

interface BodyProps {
  view: InviteView;
  token: string;
  invite: AccountantInviteCheck | null;
  email: string | null;
  hasClients: boolean;
  onSignup: (on: boolean) => void;
  onOutcome: (outcome: InviteOutcome) => void;
  onRetry: () => void;
}

function Body({ view, token, invite, email, hasClients, onSignup, onOutcome, onRetry }: BodyProps) {
  const { t } = useLanguage();
  const tp = useTp();
  switch (view.kind) {
    case 'checking':
      return (
        <div className="loading loading--section" role="status" aria-label={t('hosted.accountantInvite.checking')}>
          <BrandLoader size={40} />
        </div>
      );
    case 'unreachable':
      return (
        <section role="alert" className="hp-two-panel-form">
          <p className="hp-banner hp-banner-error">
            <AlertIcon />
            <span>{view.minutes ? tp('hosted.auth.rateLimited', view.minutes) : t('hosted.accountantInvite.failed')}</span>
          </p>
          <Button variant="secondary" onClick={onRetry}>
            {t('hosted.shareLink.retryButton')}
          </Button>
        </section>
      );
    case 'gone':
      return <GoneCard />;
    case 'invite':
      return <SignedOutInvite invite={invite!} onSignup={() => onSignup(true)} />;
    case 'signup':
      return <SignupForm token={token} invite={invite!} onBack={() => onSignup(false)} onOutcome={onOutcome} />;
    case 'accept':
      return <AcceptCard token={token} invite={invite!} email={email ?? ''} onOutcome={onOutcome} />;
    case 'mismatch':
      return <MismatchCard maskedEmail={view.maskedEmail} email={email ?? ''} />;
    case 'already':
      return (
        <section className="hp-two-panel-form">
          <h1>{t('hosted.accountantInvite.already.title')}</h1>
          <Link to={hasClients ? '/client-books' : '/'} className="btn btn-primary btn-md hp-block">
            {t('hosted.accountantInvite.already.open')}
          </Link>
        </section>
      );
    case 'exists':
      return (
        <section className="hp-two-panel-form">
          <h1>{t('hosted.accountantInvite.exists.title')}</h1>
          <p className="hp-setup-lead">{t('hosted.accountantInvite.exists.body')}</p>
          <SignInToAccept />
        </section>
      );
    case 'signInToContinue':
      return (
        <section className="hp-two-panel-form">
          <h1>{t('hosted.accountantInvite.signInToContinue.title')}</h1>
          <p className="hp-setup-lead">{t('hosted.accountantInvite.signInToContinue.body', { profile: invite?.profileName ?? '' })}</p>
          <SignInToAccept />
        </section>
      );
  }
}

function InviteHeading({ invite }: { invite: AccountantInviteCheck }) {
  const { t, language } = useLanguage();
  return (
    <>
      <h1>{invite.ownerName ? t('hosted.accountantInvite.invited', { owner: invite.ownerName, profile: invite.profileName }) : t('hosted.accountantInvite.invitedNoOwner', { profile: invite.profileName })}</h1>
      <p className="hp-setup-lead">{t('hosted.accountantInvite.forAddress', { email: invite.maskedEmail, date: inviteEnds(invite.expiresAt, language) })}</p>
    </>
  );
}

/** The sign-in round trip comes back here; the token waits in this tab's storage. */
function SignInToAccept({ secondary = false }: { secondary?: boolean }) {
  const { t } = useLanguage();
  return (
    <Link to="/sign-in" search={{ next: INVITE_PATH }} className={`btn ${secondary ? 'btn-secondary' : 'btn-primary'} btn-md hp-block`}>
      {t('hosted.accountantInvite.signIn')}
    </Link>
  );
}

function SignedOutInvite({ invite, onSignup }: { invite: AccountantInviteCheck; onSignup: () => void }) {
  const { t } = useLanguage();
  return (
    <section className="hp-two-panel-form">
      <InviteHeading invite={invite} />
      <div className="hp-two-panel-actions">
        <SignInToAccept />
        <Button variant="secondary" className="hp-block" onClick={onSignup}>
          {t('hosted.accountantInvite.create')}
        </Button>
      </div>
    </section>
  );
}

function GoneCard() {
  const { t } = useLanguage();
  return (
    <section className="hp-two-panel-ended" role="status" data-state="gone">
      {/* TODO(MUT-561): the `link-closed` scene once MUT-561's Scene renderer merges. */}
      <h1>{t('hosted.accountantInvite.gone.title')}</h1>
      <p className="hp-setup-lead">{t('hosted.accountantInvite.gone.body')}</p>
    </section>
  );
}

function MismatchCard({ maskedEmail, email }: { maskedEmail: string; email: string }) {
  const { t } = useLanguage();
  const { signOut, signingOut } = useSignOut({ next: INVITE_PATH });
  return (
    <section className="hp-two-panel-form" data-state="mismatch">
      <h1>{t('hosted.accountantInvite.mismatch.title')}</h1>
      <p className="hp-setup-lead">{t('hosted.accountantInvite.mismatch.body', { invited: `⁨${maskedEmail}⁩`, email: `⁨${email}⁩` })}</p>
      <p className="hp-field-hint">{t('hosted.accountantInvite.mismatch.domainHint')}</p>
      <div className="hp-two-panel-actions">
        <Button variant="primary" className="hp-block" onClick={() => void signOut()} disabled={signingOut}>
          {t('hosted.accountantInvite.mismatch.signOut')}
        </Button>
        <Link to="/" className="btn btn-secondary btn-md hp-block">
          {t('hosted.accountantInvite.mismatch.back')}
        </Link>
      </div>
    </section>
  );
}

/** Where an accepted invite lands: the new client's book (AC4). */
function useLandOnClient() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return (profileId: string, via: 'signed_in' | 'signup') => {
    forgetInviteForTab();
    countPublicPage({ event: 'accountant_accepted', properties: { via } });
    void queryClient.invalidateQueries({ queryKey: ME_KEY });
    void queryClient.invalidateQueries({ queryKey: CLIENT_BOOKS_KEY });
    void navigate({ to: '/client-books/$profileId', params: { profileId }, replace: true });
  };
}

function AcceptCard({ token, invite, email, onOutcome }: { token: string; invite: AccountantInviteCheck; email: string; onOutcome: (outcome: InviteOutcome) => void }) {
  const { t } = useLanguage();
  const land = useLandOnClient();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function accept() {
    setBusy(true);
    setFailed(false);
    try {
      const client = await api.acceptAccountantInvite(token);
      land(client.profileId, 'signed_in');
    } catch (error) {
      setBusy(false);
      // TODO(blocked-by MUT-565): 402 ACCOUNTANT_PLAN_REQUIRED → the Accountant plan card in place of Accept.
      const outcome = acceptOutcome(error);
      if (outcome) onOutcome(outcome);
      else setFailed(true);
    }
  }

  return (
    <section className="hp-two-panel-form">
      <h1>{invite.ownerName ? t('hosted.accountantInvite.accept.title', { owner: invite.ownerName }) : t('hosted.accountantInvite.accept.titleNoOwner')}</h1>
      <p className="hp-setup-lead">{t('hosted.accountantInvite.accept.body', { profile: invite.profileName, email: `⁨${email}⁩` })}</p>
      {failed && (
        <p className="hp-banner hp-banner-error" role="alert">
          <AlertIcon />
          <span>{t('hosted.accountantInvite.failed')}</span>
        </p>
      )}
      <div className="hp-two-panel-actions">
        <Button variant="primary" className="hp-block" onClick={() => void accept()} disabled={busy} aria-busy={busy}>
          {t(busy ? 'hosted.accountantInvite.accept.accepting' : 'hosted.accountantInvite.accept.accept')}
        </Button>
        <Link to="/" className="btn btn-secondary btn-md hp-block">
          {t('hosted.accountantInvite.accept.notNow')}
        </Link>
      </div>
    </section>
  );
}

type Banner = { kind: 'checkFailed' } | { kind: 'rateLimited'; minutes: number } | { kind: 'unreachable' };
type Phase = 'idle' | 'waiting' | 'creating' | 'signingIn';
const POLICY_VARS = { min: NEW_PASSWORD_POLICY.minLength, max: NEW_PASSWORD_POLICY.maxLength };

/**
 * Create an account from the invite: the address is the invite's (shown masked; the server uses it), a name, a
 * password, the terms, the bot check. The check answers no terms version, so the first try names none; a 409
 * TERMS_VERSION_STALE answers the current one, and the form sends again once with it (the tick was for the current
 * terms, the unversioned link). Then POST /v1/sessions and the client book.
 */
function SignupForm({ token, invite, onBack, onOutcome }: { token: string; invite: AccountantInviteCheck; onBack: () => void; onOutcome: (outcome: InviteOutcome) => void }) {
  const { t, language } = useLanguage();
  const tp = useTp();
  const ids = useId();
  const queryClient = useQueryClient();
  const adoptAccountLocale = useAdoptAccountLocale();
  const land = useLandOnClient();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [problem, setProblem] = useState<'password' | 'terms' | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const termsVersion = useRef<string | undefined>(undefined);
  // What the form shows: the versioned terms link once the server named one, and why the box was cleared
  const [shownTerms, setShownTerms] = useState<{ version?: string; changed: boolean }>({ changed: false });
  const retriedTerms = useRef(false);
  const waiting = useRef(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  const { containerRef, token: checkToken, status, reset, retry } = useTurnstile({
    action: 'signup',
    language,
    onToken: (fresh) => {
      if (!waiting.current) return;
      waiting.current = false;
      void create(fresh);
    },
  });

  async function signIn(email: string, profileId: string) {
    setPhase('signingIn');
    try {
      const me = await api.signIn({ email, password });
      setMode('remote');
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'accountantInvite' });
      queryClient.setQueryData(ME_KEY, me);
      adoptAccountLocale(me.user.locale);
      land(profileId, 'signup');
    } catch {
      // The account exists now: never a second signup
      forgetInviteForTab();
      onOutcome({ kind: 'signInToContinue' });
    }
  }

  async function create(turnstileToken: string) {
    setPhase('creating');
    try {
      const displayName = name.trim();
      const created = await api.signupFromAccountantInvite({
        token,
        password,
        turnstileToken,
        termsLocale: language === 'ar' ? 'ar' : 'en',
        clientRelease: TERMS_CLIENT_RELEASE,
        timezone: browserTimezone(),
        ...(termsVersion.current ? { acceptedTermsVersion: termsVersion.current } : {}),
        ...(displayName ? { displayName } : {}),
      });
      await signIn(created.email, created.client.profileId);
      return;
    } catch (error) {
      const failure = signupFailure(error);
      reset();
      if (failure.kind === 'termsStale' && failure.current && !retriedTerms.current) {
        // Once: the person ticked the current terms; send again naming them, with the next check's token
        retriedTerms.current = true;
        termsVersion.current = failure.current;
        setShownTerms({ version: failure.current, changed: false });
        waiting.current = true;
        setPhase('waiting');
        return;
      }
      setPhase('idle');
      if (failure.kind === 'outcome') return onOutcome(failure.outcome);
      if (failure.kind === 'termsStale') {
        termsVersion.current = failure.current ?? undefined;
        setShownTerms({ version: failure.current ?? undefined, changed: true });
        setAgreed(false);
        setProblem('terms');
        return;
      }
      if (failure.kind === 'password') {
        setProblem('password');
        passwordRef.current?.focus();
        return;
      }
      setBanner(failure.kind === 'rateLimited' ? failure : failure.kind === 'checkFailed' ? { kind: 'checkFailed' } : { kind: 'unreachable' });
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (phase !== 'idle') return;
    if (passwordProblem(password)) {
      setProblem('password');
      passwordRef.current?.focus();
      return;
    }
    if (!agreed) return setProblem('terms');
    setProblem(null);
    setBanner(null);
    if (checkToken) return void create(checkToken);
    if (status === 'failed') return setBanner({ kind: 'checkFailed' });
    waiting.current = true;
    setPhase('waiting');
  }

  const busy = phase !== 'idle' && !(phase === 'waiting' && status === 'failed');
  const termsLink = termsHref(language, shownTerms.version);
  return (
    <form className="hp-two-panel-form" noValidate onSubmit={onSubmit}>
      <p className="hp-two-panel-eyebrow">
        {invite.ownerName ? t('hosted.accountantInvite.invited', { owner: invite.ownerName, profile: invite.profileName }) : t('hosted.accountantInvite.invitedNoOwner', { profile: invite.profileName })}
      </p>
      <h1>{t('hosted.accountantInvite.signup.title')}</h1>
      {banner && (
        <p className="hp-banner hp-banner-error" role="alert">
          <AlertIcon />
          <span>
            {banner.kind === 'rateLimited' ? tp('hosted.auth.rateLimited', banner.minutes) : banner.kind === 'checkFailed' ? t('hosted.accountantInvite.signup.checkFailed') : t('hosted.accountantInvite.failed')}
          </span>
        </p>
      )}
      <div className="hp-field">
        <label htmlFor={`${ids}-email`}>{t('hosted.accountantInvite.signup.email')}</label>
        <div className="hp-locked-field">
          <LockIcon />
          <input id={`${ids}-email`} className="input hp-ltr-input" dir="ltr" readOnly value={invite.maskedEmail} aria-describedby={`${ids}-email-hint`} />
        </div>
        <p className="hp-field-hint" id={`${ids}-email-hint`}>
          {t('hosted.accountantInvite.signup.emailFixed')}
        </p>
      </div>
      <div className="hp-field">
        <label htmlFor={`${ids}-name`}>{t('hosted.accountantInvite.signup.name')}</label>
        <input id={`${ids}-name`} className="input" dir="auto" autoComplete="name" maxLength={NAME_MAX_LENGTH} readOnly={busy} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="hp-field">
        <label htmlFor={`${ids}-password`}>{t('hosted.accountantInvite.signup.password')}</label>
        <input
          ref={passwordRef}
          id={`${ids}-password`}
          className={`input hp-ltr-input ${problem === 'password' ? 'input-error' : ''}`}
          type="password"
          autoComplete="new-password"
          dir="ltr"
          readOnly={busy}
          value={password}
          aria-invalid={problem === 'password'}
          aria-describedby={`${ids}-rule`}
          onChange={(e) => setPassword(e.target.value)}
        />
        <p className={problem === 'password' ? 'hp-field-error' : 'hp-field-hint'} id={`${ids}-rule`}>
          {t('hosted.setup.rule', POLICY_VARS)}
        </p>
      </div>
      <div className="hp-field">
        <label className="hp-check-row">
          <input type="checkbox" checked={agreed} disabled={busy} aria-invalid={problem === 'terms'} onChange={(e) => setAgreed(e.target.checked)} />
          <span>
            {t('hosted.setup.terms.agree')}{' '}
            {termsLink ? (
              <a href={termsLink} target="_blank" rel="noopener">
                {t('hosted.setup.terms.link')}
              </a>
            ) : (
              t('hosted.setup.terms.link')
            )}
          </span>
        </label>
        {problem === 'terms' && <p className="hp-field-error">{t(shownTerms.changed ? 'hosted.accountantInvite.signup.termsChanged' : 'hosted.setup.terms.required')}</p>}
      </div>
      <TurnstileWidget containerRef={containerRef} status={status} onRetry={retry} id={`${ids}-check`} />
      <p className="hp-two-panel-note">{t('hosted.accountantInvite.signup.freeNote')}</p>
      <Button type="submit" variant="primary" className="hp-block" disabled={busy} aria-busy={busy}>
        {t(phase === 'creating' || phase === 'waiting' ? 'hosted.accountantInvite.signup.creating' : phase === 'signingIn' ? 'hosted.accountantInvite.signup.signingIn' : 'hosted.accountantInvite.signup.submit')}
      </Button>
      <Button type="button" variant="ghost" onClick={onBack} disabled={busy}>
        {t('hosted.accountantInvite.signup.back')}
      </Button>
    </form>
  );
}

