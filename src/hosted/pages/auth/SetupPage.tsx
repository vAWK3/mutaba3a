import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../../lib/i18n/core';
import { useTp } from '../../../lib/i18n/plural';
import { Button } from '../../../components/ui/Button';
import { api, ApiError, retryMinutes, type SetupLinkRefusal } from '../../api/client';
import { LanguageSwitch, Wordmark } from '../../components/Brand';
import { AlertIcon } from '../../components/Icons';
import { useAdoptAccountLocale } from '../../i18n/HostedLanguageProvider';
import { ME_KEY, ME_TIMEOUT_MS } from '../../session/me';
import { CheckingSession } from './BootScreens';
import { NEW_PASSWORD_POLICY, answerWasLost, passwordProblem, redeemFailure, tokenFromHash, type PasswordProblem } from './setupLink';

/**
 * `/setup#<token>` (MUT-236, mut-236-setup-page.md): the page an operator-issued
 * setup link opens (ADR-088). It reads the token from the fragment and removes
 * it from the address bar at once, checks the link before showing anything,
 * sets the password, then signs in through the one sign-in route. No signup,
 * invite or "forgot" door: a link that can't be used says so and stops.
 */

const SETUP_CHECK_KEY = ['setup-link-check'] as const;
const POLICY_VARS = { min: NEW_PASSWORD_POLICY.minLength, max: NEW_PASSWORD_POLICY.maxLength };

type Refusal = SetupLinkRefusal | 'missing';
/** Where the page ends when it doesn't land on Home. */
type Outcome = { kind: 'refused'; state: Refusal } | { kind: 'usedAfterRetry' } | { kind: 'saved' };

/** Every setup request gives up when sign-in's session check does (MUT-207 DR6), so a lost answer surfaces as one. */
const requestTimeout = () => AbortSignal.timeout(ME_TIMEOUT_MS);

export function SetupPage() {
  const location = useLocation();
  const navigate = useNavigate();
  // Kept in state: the strip below empties the hash, and the token must outlive it.
  const incoming = tokenFromHash(location.hash);
  const [token, setToken] = useState(incoming);
  // A newer link pasted into this tab changes only the fragment, so the page doesn't reload: adopt it.
  if (incoming && incoming !== token) setToken(incoming);

  useEffect(() => {
    // `replace` is history.replaceState: the token stays in no history entry (MUT-235 review A5).
    if (location.hash) void navigate({ to: '/setup', replace: true });
  }, [location.hash, navigate]);

  if (!token) return <SetupNotice outcome={{ kind: 'refused', state: 'missing' }} />;
  return <SetupLink key={token} token={token} />;
}

function SetupLink({ token }: { token: string }) {
  const t = useT();
  const adoptAccountLocale = useAdoptAccountLocale();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const check = useQuery({
    queryKey: [...SETUP_CHECK_KEY, token],
    queryFn: ({ signal }) => api.checkSetupLink(token, AbortSignal.any([signal, requestTimeout()])),
    // Asked once per page (eng review A1): after a redeem the same link answers "used".
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const link = check.data?.state === 'valid' ? check.data : null;

  // Before the form's first paint, so it never shows a frame in the wrong language (MUT-209)
  useLayoutEffect(() => {
    if (link) adoptAccountLocale(link.locale);
  }, [link, adoptAccountLocale]);

  if (outcome) return <SetupNotice outcome={outcome} />;
  if (check.isPending) return <CheckingSession label={t('hosted.setup.checking')} />;
  if (check.error) return <CheckFailed error={check.error} onRetry={() => void check.refetch()} retrying={check.isFetching} />;
  if (!link) return <SetupNotice outcome={{ kind: 'refused', state: check.data.state === 'valid' ? 'invalid' : check.data.state }} />;
  return <SetupForm token={token} email={link.email} purpose={link.purpose} onOutcome={setOutcome} />;
}

function SetupLayout({ children }: { children: ReactNode }) {
  return (
    <div className="hp-signin">
      <div className="hp-signin-top">
        <LanguageSwitch />
      </div>
      <main className="hp-signin-body">
        <Wordmark />
        {children}
      </main>
    </div>
  );
}

function SignInLink() {
  const t = useT();
  return (
    <Link to="/sign-in" className="btn btn-primary btn-md hp-block">
      {t('hosted.setup.toSignIn')}
    </Link>
  );
}

function SetupNotice({ outcome }: { outcome: Outcome }) {
  const t = useT();
  const key = outcome.kind === 'refused' ? `hosted.setup.refused.${outcome.state}` : `hosted.setup.${outcome.kind}`;
  const offersSignIn = outcome.kind !== 'refused' || outcome.state === 'used';
  return (
    <SetupLayout>
      <section className="hp-card hp-signin-card">
        <h1>{t(`${key}.title`)}</h1>
        <p className="hp-setup-lead">{t(`${key}.body`)}</p>
        {offersSignIn && <SignInLink />}
      </section>
    </SetupLayout>
  );
}

/** The check got no usable answer: a malformed token reads as a link that doesn't work; a limit or an outage offers Try again. */
function CheckFailed({ error, onRetry, retrying }: { error: Error; onRetry: () => void; retrying: boolean }) {
  const t = useT();
  const tp = useTp();
  if (error instanceof ApiError && error.status === 422) return <SetupNotice outcome={{ kind: 'refused', state: 'invalid' }} />;
  const limited = error instanceof ApiError && error.status === 429;
  return (
    <SetupLayout>
      <section className="hp-card hp-signin-card" role="alert">
        <h1>{t(limited ? 'hosted.setup.waitTitle' : 'hosted.auth.boot.title')}</h1>
        <p className="hp-setup-lead">{limited ? tp('hosted.auth.rateLimited', retryMinutes(error)) : t('hosted.auth.unreachable')}</p>
        <Button variant="secondary" onClick={onRetry} disabled={retrying}>
          {t('hosted.auth.boot.retry')}
        </Button>
      </section>
    </SetupLayout>
  );
}

type FieldError = PasswordProblem | 'rule';
type Banner = { kind: 'rateLimited'; minutes: number } | { kind: 'unreachable' };
type Phase = 'idle' | 'saving' | 'signingIn';

interface SetupFormProps {
  token: string;
  email: string;
  purpose: 'SETUP' | 'RESET';
  onOutcome: (outcome: Outcome) => void;
}

function SetupForm({ token, email, purpose, onOutcome }: SetupFormProps) {
  const t = useT();
  const tp = useTp();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const adoptAccountLocale = useAdoptAccountLocale();
  const ids = useId();
  const passwordRef = useRef<HTMLInputElement>(null);
  /** An earlier save on this page ended without an answer, so it may have set the password (TD-149). */
  const answerLost = useRef(false);

  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldError, setFieldError] = useState<FieldError | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');

  function refuseInline(error: FieldError) {
    setFieldError(error);
    passwordRef.current?.focus();
  }

  /** The one way to a session (ADR-088): POST /v1/sessions with the password just set. */
  async function signIn(account: string, otherwise: Outcome) {
    setPhase('signingIn');
    try {
      const me = await api.signIn({ email: account, password });
      // Whoever was signed in on this browser before is not this person.
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== SETUP_CHECK_KEY[0] });
      queryClient.setQueryData(ME_KEY, me);
      adoptAccountLocale(me.user.locale);
      void navigate({ to: '/', replace: true });
    } catch {
      onOutcome(otherwise);
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (phase !== 'idle') return;
    const problem = passwordProblem(password);
    if (problem) return refuseInline(problem);
    setFieldError(null);
    setBanner(null);
    setPhase('saving');
    try {
      const { email: account } = await api.redeemSetupLink({ token, password }, requestTimeout());
      await signIn(account, { kind: 'saved' });
    } catch (error) {
      const failure = redeemFailure(error, answerLost.current);
      if (answerWasLost(error)) answerLost.current = true;
      if (failure.kind === 'trySignIn') return void (await signIn(email, { kind: 'usedAfterRetry' }));
      setPhase('idle');
      if (failure.kind === 'refused') onOutcome({ kind: 'refused', state: failure.state });
      else if (failure.kind === 'policy') refuseInline('rule');
      else setBanner(failure);
    }
  }

  const pending = phase !== 'idle';
  const bannerId = `${ids}-banner`;
  const ruleId = `${ids}-rule`;
  const errorId = `${ids}-error`;
  const variant = purpose === 'RESET' ? 'reset' : 'setup';

  return (
    <SetupLayout>
      <form className="hp-card hp-signin-card" noValidate onSubmit={onSubmit}>
        <h1>{t(`hosted.setup.title.${variant}`)}</h1>
        <p className="hp-setup-lead">{t(`hosted.setup.lead.${variant}`)}</p>

        {banner && (
          <div className="hp-banner hp-banner-error" role="alert" id={bannerId}>
            <AlertIcon />
            <span>{banner.kind === 'rateLimited' ? tp('hosted.auth.rateLimited', banner.minutes) : t('hosted.auth.unreachable')}</span>
          </div>
        )}

        <div className="hp-field">
          <label htmlFor={`${ids}-account`}>{t('hosted.setup.account')}</label>
          {/* Visible and read-only, it is also the username password managers save with the new password (D2). */}
          <input
            id={`${ids}-account`}
            className="input hp-ltr-input"
            type="email"
            name="username"
            autoComplete="username"
            dir="ltr"
            readOnly
            value={email}
          />
        </div>

        <div className="hp-field">
          <label htmlFor={`${ids}-password`}>{t('hosted.setup.password')}</label>
          <div className="hp-password">
            <input
              ref={passwordRef}
              id={`${ids}-password`}
              className={`input hp-ltr-input ${fieldError ? 'input-error' : ''}`}
              type={showPassword ? 'text' : 'password'}
              name="new-password"
              autoComplete="new-password"
              dir="ltr"
              autoFocus
              readOnly={pending}
              value={password}
              aria-invalid={Boolean(fieldError)}
              aria-describedby={[ruleId, fieldError ? errorId : null, banner ? bannerId : null].filter(Boolean).join(' ')}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              className="hp-password-toggle press"
              aria-pressed={showPassword}
              aria-controls={`${ids}-password`}
              onClick={() => setShowPassword((shown) => !shown)}
            >
              {t(showPassword ? 'hosted.auth.hide' : 'hosted.auth.show')}
            </button>
          </div>
          <p className="hp-field-hint" id={ruleId}>
            {t('hosted.setup.rule', POLICY_VARS)}
          </p>
          {fieldError && (
            <p className="hp-field-error" id={errorId}>
              {t(`hosted.setup.${fieldError}`, POLICY_VARS)}
            </p>
          )}
        </div>

        <button type="submit" className="btn btn-primary btn-md hp-block" disabled={pending} aria-busy={pending}>
          {pending && <span className="btn-spinner hp-inline-spinner" aria-hidden="true" />}
          <span>{t(phase === 'saving' ? 'hosted.setup.saving' : phase === 'signingIn' ? 'hosted.setup.signingIn' : 'hosted.setup.submit')}</span>
        </button>
      </form>
    </SetupLayout>
  );
}
