import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLanguage, useT } from '../../../lib/i18n/core';
import { useTp } from '../../../lib/i18n/plural';
import { Button } from '../../../components/ui/Button';
import { Select } from '../../../components/ui/Input';
import { api, ApiError, retryMinutes, type SetupLinkCheck, type SetupLinkRefusal } from '../../api/client';
import { AlertIcon } from '../../components/Icons';
import { TimezoneChoice } from '../../components/TimezoneChoice';
import { DEFAULT_HOSTED_CURRENCY, HOSTED_CURRENCIES, type HostedCurrency } from '../../format/currencies';
import { browserTimezone } from '../../format/timezones';
import { firstRunPath } from '../../session/firstRun';
import { useSelfServiceDoors } from '../../session/selfServiceDoors';
import { useAdoptAccountLocale } from '../../i18n/HostedLanguageProvider';
import { ME_KEY, ME_TIMEOUT_MS } from '../../session/me';
import { setMode } from '../../session/mode';
import { TERMS_CLIENT_RELEASE, termsHref } from '../../terms';
import { AuthLayout } from './AuthLayout';
import { CheckingSession } from './BootScreens';
import { UnderReviewNotice } from './UnderReviewNotice';
import { NEW_PASSWORD_POLICY, answerWasLost, passwordProblem, redeemFailure, tokenFromHash, type PasswordProblem } from './setupLink';

/**
 * `/setup#<token>` (MUT-236, mut-236-setup-page.md): the page a setup link opens
 * (ADR-088): the operator's SETUP and RESET links, and since MUT-366/368 the
 * mailed SIGNUP and recovery links. It reads the token from the fragment and
 * removes it from the address bar at once, checks the link before showing
 * anything, sets the password, then signs in through the one sign-in route.
 * A SIGNUP link also takes the new account's name, currency and time zone; an
 * account the operator must review first shows the under-review screen instead
 * of signing in (MUT-367). A link that can't be used says so, and offers a new
 * one where the server can mail it.
 */

const SETUP_CHECK_KEY = ['setup-link-check'] as const;
const POLICY_VARS = { min: NEW_PASSWORD_POLICY.minLength, max: NEW_PASSWORD_POLICY.maxLength };
/** The server's displayName bound (SetupLinkRedeemRequest, MUT-366). */
const NAME_MAX_LENGTH = 200;

type Refusal = SetupLinkRefusal | 'missing';
type Purpose = Extract<SetupLinkCheck, { state: 'valid' }>['purpose'];
/** Where the page ends when it doesn't land on Home. `purpose`: what a dead link was for, when known (MUT-368 D2). */
type Outcome = { kind: 'refused'; state: Refusal; purpose?: Purpose } | { kind: 'usedAfterRetry' } | { kind: 'saved' } | { kind: 'underReview' };

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
  if (!link) {
    const dead = check.data.state === 'valid' ? null : check.data;
    return <SetupNotice outcome={{ kind: 'refused', state: dead?.state ?? 'invalid', ...(dead?.purpose ? { purpose: dead.purpose } : {}) }} />;
  }
  return <SetupForm token={token} email={link.email} purpose={link.purpose} termsVersion={link.termsVersion} onOutcome={setOutcome} />;
}

function SetupLayout({ children }: { children: ReactNode }) {
  return <AuthLayout>{children}</AuthLayout>;
}

function SignInLink() {
  const t = useT();
  return (
    <Link to="/sign-in" className="btn btn-primary btn-md hp-block">
      {t('hosted.setup.toSignIn')}
    </Link>
  );
}

/** Where a new link for a dead one comes from (MUT-368 D2): signup for a SIGNUP link, recovery for the others. */
function newLinkRoute(purpose: Purpose | undefined, doors: { signup: boolean; recovery: boolean }): '/signup' | '/recover' | null {
  if (purpose === 'SIGNUP') return doors.signup ? '/signup' : null;
  if (purpose === 'SETUP' || purpose === 'RESET') return doors.recovery ? '/recover' : null;
  return null;
}

function SetupNotice({ outcome }: { outcome: Outcome }) {
  const t = useT();
  const navigate = useNavigate();
  const doors = useSelfServiceDoors();
  if (outcome.kind === 'underReview') return <UnderReviewNotice onLeave={() => void navigate({ to: '/sign-in', replace: true })} />;
  const key = outcome.kind === 'refused' ? `hosted.setup.refused.${outcome.state}` : `hosted.setup.${outcome.kind}`;
  const offersSignIn = outcome.kind !== 'refused' || outcome.state === 'used';
  // A dead link the person can replace themselves says so, without "ask the person who set up your account".
  const sendNew = outcome.kind === 'refused' && outcome.state !== 'invalid' && outcome.state !== 'missing' ? newLinkRoute(outcome.purpose, doors) : null;
  return (
    <SetupLayout>
      <section className="hp-card hp-signin-card">
        <h1>{t(`${key}.title`)}</h1>
        <p className="hp-setup-lead">{t(sendNew ? `${key}.bodySelf` : `${key}.body`)}</p>
        {offersSignIn && <SignInLink />}
        {sendNew && (
          <Link to={sendNew} className={`btn ${offersSignIn ? 'btn-secondary' : 'btn-primary'} btn-md hp-block`}>
            {t('hosted.setup.sendNew')}
          </Link>
        )}
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
/** A new account's profile (MUT-366/368 D9): sent with a SIGNUP redeem only. */
interface NewAccount {
  name: string;
  currency: HostedCurrency;
  timezone: string;
}
type Banner = { kind: 'rateLimited'; minutes: number } | { kind: 'unreachable' };
type Phase = 'idle' | 'saving' | 'signingIn';

interface SetupFormProps {
  token: string;
  email: string;
  /** MUT-368: SIGNUP has its own copy and asks for the new account's name, currency and time zone. */
  purpose: Purpose;
  /** MUT-324: the terms version the check named; replaced by the current one if it changes while the page is open. */
  termsVersion: string;
  onOutcome: (outcome: Outcome) => void;
}

/** MUT-324: what the link's check says now, when a 409 didn't name the new terms version. */
type RecheckedTerms = { kind: 'version'; version: string } | { kind: 'refused'; state: SetupLinkRefusal } | { kind: 'unreachable' };

async function recheckTermsVersion(token: string): Promise<RecheckedTerms> {
  try {
    const link = await api.checkSetupLink(token, requestTimeout());
    return link.state === 'valid' ? { kind: 'version', version: link.termsVersion } : { kind: 'refused', state: link.state };
  } catch {
    return { kind: 'unreachable' };
  }
}

function SetupForm({ token, email, purpose, termsVersion: checkedTermsVersion, onOutcome }: SetupFormProps) {
  const t = useT();
  const tp = useTp();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const adoptAccountLocale = useAdoptAccountLocale();
  const ids = useId();
  const passwordRef = useRef<HTMLInputElement>(null);
  const termsRef = useRef<HTMLInputElement>(null);
  const { language } = useLanguage();
  /** An earlier save on this page ended without an answer, so it may have set the password (TD-149). */
  const answerLost = useRef(false);

  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldError, setFieldError] = useState<FieldError | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [termsVersion, setTermsVersion] = useState(checkedTermsVersion);
  const [agreed, setAgreed] = useState(false);
  const [termsProblem, setTermsProblem] = useState<'required' | 'changed' | null>(null);
  // A tick is for the text read in the page's language, the one recorded: a language switch clears it (review pass 2)
  const [tickedIn, setTickedIn] = useState(language);
  const signup = purpose === 'SIGNUP';
  // Read once: the zone the browser reports is the fact row and the default (MUT-183 Issue 10)
  const [zone] = useState(browserTimezone);
  const [account, setAccount] = useState<NewAccount>({ name: '', currency: DEFAULT_HOSTED_CURRENCY, timezone: zone });
  const [zoneOpen, setZoneOpen] = useState(false);
  const [zoneRefused, setZoneRefused] = useState(false);
  if (language !== tickedIn) {
    setTickedIn(language);
    setAgreed(false);
  }

  function refuseInline(error: FieldError) {
    setFieldError(error);
    passwordRef.current?.focus();
  }

  /** The one way to a session (ADR-088): POST /v1/sessions with the password just set. */
  async function signIn(address: string, otherwise: Outcome) {
    setPhase('signingIn');
    try {
      const me = await api.signIn({ email: address, password });
      setMode('remote');
      // Whoever was signed in on this browser before (or the local person, MUT-286) is not this person.
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== SETUP_CHECK_KEY[0] });
      queryClient.setQueryData(ME_KEY, me);
      adoptAccountLocale(me.user.locale);
      // A new account starts on its personal profile (D13; MUT-418's first-run step goes there)
      void navigate({ to: signup ? firstRunPath(me) : '/', replace: true });
    } catch (error) {
      // MUT-367: the password is right but the operator hasn't approved the account yet
      onOutcome(error instanceof ApiError && error.code === 'ACCOUNT_UNDER_REVIEW' ? { kind: 'underReview' } : otherwise);
    }
  }

  /** The SIGNUP redeem's new profile (D9); a blank name is left out, so the server uses the address's local part. */
  function newAccountFields() {
    if (!signup) return {};
    const displayName = account.name.trim();
    return { defaultCurrency: account.currency, timezone: account.timezone, ...(displayName ? { displayName } : {}) };
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (phase !== 'idle') return;
    const problem = passwordProblem(password);
    if (problem) return refuseInline(problem);
    setFieldError(null);
    if (!agreed) {
      setTermsProblem('required');
      termsRef.current?.focus();
      return;
    }
    setTermsProblem(null);
    setBanner(null);
    setPhase('saving');
    try {
      const termsLocale = language === 'ar' ? 'ar' : 'en';
      const redeemed = await api.redeemSetupLink(
        { token, password, acceptedTermsVersion: termsVersion, termsLocale, clientRelease: TERMS_CLIENT_RELEASE, ...newAccountFields() },
        requestTimeout(),
      );
      // MUT-367: an account waiting for review can't sign in yet; say so without trying
      if (redeemed.status === 'PENDING_REVIEW') return onOutcome({ kind: 'underReview' });
      await signIn(redeemed.email, { kind: 'saved' });
    } catch (error) {
      const failure = redeemFailure(error, answerLost.current);
      if (answerWasLost(error)) answerLost.current = true;
      if (failure.kind === 'trySignIn') return void (await signIn(email, { kind: 'usedAfterRetry' }));
      // A 409 that doesn't name the new version: ask the link, or the retry would resend the stale one
      const rechecked: RecheckedTerms | null =
        failure.kind !== 'termsChanged' ? null : failure.current ? { kind: 'version', version: failure.current } : await recheckTermsVersion(token);
      setPhase('idle');
      if (failure.kind === 'refused') onOutcome({ kind: 'refused', state: failure.state, purpose });
      else if (rechecked?.kind === 'refused') onOutcome({ kind: 'refused', state: rechecked.state });
      else if (failure.kind === 'policy') refuseInline('rule');
      else if (failure.kind === 'timezone') {
        setZoneOpen(true);
        setZoneRefused(true);
      }
      else if (failure.kind === 'termsChanged') {
        // MUT-324: what was ticked is no longer what would be recorded, so the person reads and ticks again.
        if (rechecked?.kind === 'version') setTermsVersion(rechecked.version);
        else setBanner({ kind: 'unreachable' });
        setAgreed(false);
        setTermsProblem('changed');
        termsRef.current?.focus();
      }
      else setBanner(failure);
    }
  }

  const pending = phase !== 'idle';
  const bannerId = `${ids}-banner`;
  const ruleId = `${ids}-rule`;
  const errorId = `${ids}-error`;
  const termsErrorId = `${ids}-terms-error`;
  const termsLink = termsHref(language, termsVersion);
  const variant = purpose === 'RESET' ? 'reset' : signup ? 'signup' : 'setup';

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

        {signup && (
          <div className="hp-field">
            <label htmlFor={`${ids}-name`}>{t('hosted.setup.name')}</label>
            <input
              id={`${ids}-name`}
              className="input"
              type="text"
              name="name"
              autoComplete="name"
              dir="auto"
              maxLength={NAME_MAX_LENGTH}
              readOnly={pending}
              value={account.name}
              aria-describedby={`${ids}-name-hint`}
              onChange={(e) => setAccount((current) => ({ ...current, name: e.target.value }))}
            />
            <p className="hp-field-hint" id={`${ids}-name-hint`}>
              {t('hosted.setup.nameHint')}
            </p>
          </div>
        )}

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

        {signup && (
          <>
            <div className="hp-field">
              <label htmlFor={`${ids}-currency`}>{t('hosted.setup.currency')}</label>
              <Select
                id={`${ids}-currency`}
                name="currency"
                hint={t('hosted.setup.currencyHint')}
                disabled={pending}
                value={account.currency}
                onChange={(e) => setAccount((current) => ({ ...current, currency: e.target.value as HostedCurrency }))}
              >
                {HOSTED_CURRENCIES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </Select>
            </div>
            <div className="hp-field">
              <TimezoneChoice
                id={`${ids}-timezone`}
                browserZone={zone}
                value={account.timezone}
                onChange={(timezone) => {
                  setZoneRefused(false);
                  setAccount((current) => ({ ...current, timezone }));
                }}
                open={zoneOpen}
                onOpen={() => setZoneOpen(true)}
                invalid={zoneRefused}
              />
              {zoneRefused && <p className="hp-field-error">{t('hosted.profiles.errors.timezoneInvalid')}</p>}
            </div>
          </>
        )}

        <div className="hp-field">
          <label className="hp-check-row">
            <input
              ref={termsRef}
              type="checkbox"
              checked={agreed}
              disabled={pending}
              aria-invalid={termsProblem !== null}
              aria-describedby={termsProblem ? termsErrorId : undefined}
              onChange={(e) => {
                setAgreed(e.target.checked);
                if (e.target.checked) setTermsProblem(null);
              }}
            />
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
          {termsProblem && (
            <p className="hp-field-error" id={termsErrorId}>
              {t(`hosted.setup.terms.${termsProblem}`)}
            </p>
          )}
        </div>

        <button type="submit" className="btn btn-primary btn-md hp-block" disabled={pending} aria-busy={pending}>
          {pending && <span className="btn-spinner hp-inline-spinner" aria-hidden="true" />}
          <span>{t(phase === 'saving' ? 'hosted.setup.saving' : phase === 'signingIn' ? 'hosted.setup.signingIn' : signup ? 'hosted.setup.submitSignup' : 'hosted.setup.submit')}</span>
        </button>
      </form>
    </SetupLayout>
  );
}
