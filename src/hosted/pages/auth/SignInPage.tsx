import { useId, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLanguage, useT } from '../../../lib/i18n/core';
import { useTp } from '../../../lib/i18n/plural';
import { api, ApiError, retryMinutes } from '../../api/client';
import { ME_KEY, meQuery } from '../../session/me';
import { useAdoptAccountLocale } from '../../i18n/HostedLanguageProvider';
import { safeNext } from '../../session/safeNext';
import { setMode, useMode } from '../../session/mode';
import { termsHref } from '../../terms';
import { useSelfServiceDoors } from '../../session/selfServiceDoors';
import { AuthLayout } from './AuthLayout';
import { CheckingSession } from './BootScreens';
import { EMAIL_SHAPE } from './selfService';
import { UnderReviewNotice } from './UnderReviewNotice';
import { AlertIcon, InfoIcon, PasskeyIcon } from '../../components/Icons';
import { PasskeyCeremonyError, usePasskeySignIn } from '../../passkeys/usePasskeySignIn';
import type { Me } from '../../api/client';

/**
 * `/sign-in` (hosted-portal.md §7.6, mut-43-auth-states.md S3–S10). Email and
 * password. Every refusal the server can give for bad credentials reads the same.
 * Since MUT-368 it offers the self-service doors the server opens
 * (GET /v1/self-service): "Forgot your password?" and "Create an account". The right
 * password on an account waiting for review shows the under-review screen.
 * No invite or third-party door exists anywhere.
 *
 * Since MUT-286 the page is also the session-expired choice (brief §2.6):
 * sign in again, or continue on this device without an account. Never a
 * silent switch.
 */

export type ArrivalReason = 'expired' | 'signed_out';

interface SignInPageProps {
  next?: string;
  reason?: ArrivalReason;
}

type FieldError = 'emailRequired' | 'emailInvalid' | 'passwordRequired';
type Banner = { kind: 'invalid' } | { kind: 'passkeyInvalid' } | { kind: 'rateLimited'; minutes: number } | { kind: 'unreachable' };

/**
 * The landing's public /hosted page, the one outward link on this page
 * (MUT-188). A build-time value read at render time through a typeof guard
 * (ADR-076): the test runner defines none, so the line renders only where a
 * build set it, and a test can stub the global before rendering.
 */
function hostedOfferHref(): string {
  return typeof __HOSTED_OFFER_URL__ !== 'undefined' ? __HOSTED_OFFER_URL__ : '';
}
function bannerFor(error: unknown, via: 'password' | 'passkey' = 'password'): Banner | 'underReview' {
  // MUT-367: only the right password on a pending account gets this, so it reveals nothing to anyone else.
  if (error instanceof ApiError && error.code === 'ACCOUNT_UNDER_REVIEW') return 'underReview';
  // MUT-115 (DR4): a refused passkey (or a platform error) points back to the password.
  if (error instanceof PasskeyCeremonyError) return { kind: 'passkeyInvalid' };
  if (error instanceof ApiError && error.status === 401) return { kind: via === 'passkey' ? 'passkeyInvalid' : 'invalid' };
  if (error instanceof ApiError && error.status === 429) return { kind: 'rateLimited', minutes: retryMinutes(error) };
  return { kind: 'unreachable' };
}

export function SignInPage({ next, reason }: SignInPageProps) {
  // "Already signed in?" is a question for the server only: signed out, /v1/me is the local person (MUT-286).
  const remote = useMode() === 'remote';
  const session = useQuery({ ...meQuery, enabled: remote });
  // After a sign-out the next person on this machine starts at `/`, not where the last one was.
  const target = reason === 'signed_out' ? undefined : next;
  if (!remote) return <SignInForm next={target} reason={reason} />;
  if (session.isPending) return <CheckingSession />;
  if (session.data) return <Navigate to={safeNext(target)} replace />;
  return <SignInForm next={target} reason={reason} />;
}

function SignInForm({ next, reason }: SignInPageProps) {
  const t = useT();
  const { language } = useLanguage();
  const tp = useTp();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const adoptAccountLocale = useAdoptAccountLocale();
  const ids = useId();
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ email?: FieldError; password?: FieldError }>({});
  const [banner, setBanner] = useState<Banner | null>(null);
  const [underReview, setUnderReview] = useState(false);
  const doors = useSelfServiceDoors();

  /** One success path for the password and the passkey (MUT-115 §11.11): remote mode, the account's language, `next`. */
  function onSignedIn(me: Me) {
    setMode('remote');
    // Nothing cached on this device (the local person, their figures) belongs to the account.
    queryClient.removeQueries();
    queryClient.setQueryData(ME_KEY, me);
    // The account's language before the first signed-in frame (MUT-209)
    adoptAccountLocale(me.user.locale);
    void navigate({ to: safeNext(next), replace: true });
  }

  function showRefusal(error: unknown, via: 'password' | 'passkey') {
    const refusal = bannerFor(error, via);
    if (refusal === 'underReview') {
      setPassword('');
      setUnderReview(true);
      return;
    }
    setBanner(refusal);
    if (refusal.kind === 'invalid') {
      setPassword('');
      passwordRef.current?.focus();
    }
  }

  const passkey = usePasskeySignIn({ onSignedIn, onError: (error) => showRefusal(error, 'passkey') });

  const signIn = useMutation({
    mutationFn: api.signIn,
    onSuccess: onSignedIn,
    onError: (error) => {
      showRefusal(error, 'password');
      passkey.resume();
    },
  });

  function validate(): boolean {
    const errors: { email?: FieldError; password?: FieldError } = {};
    const trimmed = email.trim();
    if (!trimmed) errors.email = 'emailRequired';
    else if (!EMAIL_SHAPE.test(trimmed)) errors.email = 'emailInvalid';
    if (!password) errors.password = 'passwordRequired';
    setFieldErrors(errors);
    if (errors.email) emailRef.current?.focus();
    else if (errors.password) passwordRef.current?.focus();
    return !errors.email && !errors.password;
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (signIn.isPending || passkey.pending || !validate()) return;
    setBanner(null);
    passkey.pause();
    signIn.mutate({ email: email.trim(), password });
  }

  function continueOnThisDevice() {
    setMode('local');
    queryClient.clear();
    void navigate({ to: '/', replace: true });
  }

  /** Leaving the under-review screen: nobody is signed in, so an empty form is a fresh start (D16). */
  function leaveReview() {
    setUnderReview(false);
    setEmail('');
    setBanner(null);
  }

  if (underReview) return <UnderReviewNotice onLeave={leaveReview} />;

  const pending = signIn.isPending || passkey.pending;
  // MUT-460 (design 2A): an operator arriving from the digest signs in with the passkey first; it also opens their step-up.
  const passkeyFirst = passkey.supported && isOperatorPath(safeNext(next));
  const passkeyButton = passkey.supported && (
    <button
      type="button"
      className={`btn ${passkeyFirst ? 'btn-primary' : 'btn-secondary'} btn-md hp-block`}
      disabled={pending}
      aria-busy={passkey.pending}
      onClick={() => {
        setBanner(null);
        void passkey.start();
      }}
    >
      {passkey.pending ? <span className="btn-spinner hp-inline-spinner" aria-hidden="true" /> : <PasskeyIcon />}
      <span>{t('hosted.auth.passkey.button')}</span>
    </button>
  );
  const passkeyDivider = (
    <div className="hp-divider" role="separator">
      <span>{t('hosted.auth.passkey.or')}</span>
    </div>
  );
  const offerUrl = hostedOfferHref();
  const termsLink = termsHref(language);
  const bannerId = `${ids}-banner`;
  const describedBy = (field: string, error?: FieldError) =>
    [error ? `${ids}-${field}-error` : null, banner ? bannerId : null].filter(Boolean).join(' ') || undefined;

  return (
    <AuthLayout>
      <form className="hp-card hp-signin-card" noValidate onSubmit={onSubmit}>
        <h1>{t('hosted.auth.title')}</h1>

        {reason && !banner && (
          <div className="hp-banner hp-banner-info" role="note">
            <InfoIcon />
            <span>{t(reason === 'expired' ? 'hosted.auth.expired' : 'hosted.auth.signedOut')}</span>
          </div>
        )}

        {banner && (
          <div className="hp-banner hp-banner-error" role="alert" id={bannerId}>
            <AlertIcon />
            <span>
              {banner.kind === 'invalid' && t('hosted.auth.invalid')}
              {banner.kind === 'passkeyInvalid' && t('hosted.auth.passkey.invalid')}
              {banner.kind === 'rateLimited' && tp('hosted.auth.rateLimited', banner.minutes)}
              {banner.kind === 'unreachable' && t('hosted.auth.unreachable')}
            </span>
          </div>
        )}

        {passkeyFirst && (
          <>
            {passkeyButton}
            {passkeyDivider}
          </>
        )}

        <div className="hp-field">
          <label htmlFor={`${ids}-email`}>{t('hosted.auth.email')}</label>
          <input
            ref={emailRef}
            id={`${ids}-email`}
            className={`input hp-ltr-input ${fieldErrors.email ? 'input-error' : ''}`}
            type="email"
            inputMode="email"
            autoComplete={passkey.supported ? 'username webauthn' : 'username'}
            autoCapitalize="none"
            spellCheck={false}
            dir="ltr"
            autoFocus
            readOnly={pending}
            value={email}
            aria-invalid={Boolean(fieldErrors.email)}
            aria-describedby={describedBy('email', fieldErrors.email)}
            onChange={(e) => setEmail(e.target.value)}
          />
          {fieldErrors.email && (
            <p className="hp-field-error" id={`${ids}-email-error`}>
              {t(`hosted.auth.${fieldErrors.email}`)}
            </p>
          )}
        </div>

        <div className="hp-field">
          <label htmlFor={`${ids}-password`}>{t('hosted.auth.password')}</label>
          <div className="hp-password">
            <input
              ref={passwordRef}
              id={`${ids}-password`}
              className={`input hp-ltr-input ${fieldErrors.password ? 'input-error' : ''}`}
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              dir="ltr"
              readOnly={pending}
              value={password}
              aria-invalid={Boolean(fieldErrors.password)}
              aria-describedby={describedBy('password', fieldErrors.password)}
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
          {fieldErrors.password && (
            <p className="hp-field-error" id={`${ids}-password-error`}>
              {t(`hosted.auth.${fieldErrors.password}`)}
            </p>
          )}
        </div>

        <button type="submit" className={`btn ${passkeyFirst ? 'btn-secondary' : 'btn-primary'} btn-md hp-block`} disabled={pending} aria-busy={signIn.isPending}>
          {signIn.isPending && <span className="btn-spinner hp-inline-spinner" aria-hidden="true" />}
          <span>{t(signIn.isPending ? 'hosted.auth.submitting' : 'hosted.auth.submit')}</span>
        </button>

        {/* MUT-115 (DR1): only where passkeys work on this host; the password stays the primary path, except for /operator */}
        {passkey.supported && !passkeyFirst && (
          <>
            {passkeyDivider}
            {passkeyButton}
          </>
        )}
      </form>
      {/* D14: the door shows once the server can really mail a link; until then, who to ask */}
      {doors.recovery ? (
        <p className="hp-help">
          <Link to="/recover">{t('hosted.auth.forgot')}</Link>
        </p>
      ) : (
        <p className="hp-help">{t('hosted.auth.help')}</p>
      )}
      {doors.signup ? (
        <p className="hp-help">
          {t('hosted.auth.create.lead')} <Link to="/signup">{t('hosted.auth.create.link')}</Link>
        </p>
      ) : (
        offerUrl && (
          <p className="hp-help">
            {t('hosted.auth.request.lead')} <a href={offerUrl}>{t('hosted.auth.request.link')}</a>
          </p>
        )
      )}
      {termsLink && (
        <p className="hp-help">
          <a href={termsLink} target="_blank" rel="noopener">
            {t('hosted.terms.link')}
          </a>
        </p>
      )}
      <p className="hp-help">
        {t('hosted.local.continueLead')}{' '}
        <button type="button" className="hp-link-button press" onClick={continueOnThisDevice}>
          {t('hosted.local.continue')}
        </button>
      </p>
    </AuthLayout>
  );
}

/** MUT-460 (2A): the operator console's paths. */
function isOperatorPath(path: string): boolean {
  return path === '/operator' || path.startsWith('/operator/') || path.startsWith('/operator?');
}
