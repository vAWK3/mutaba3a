import { useId, useRef, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../../lib/i18n/core';
import { useTp } from '../../../lib/i18n/plural';
import { api, ApiError } from '../../api/client';
import { LanguageSwitch, Wordmark } from '../../components/Brand';
import { ME_KEY, meQuery } from '../../session/me';
import { safeNext } from '../../session/safeNext';
import { CheckingSession } from './BootScreens';
import { AlertIcon, InfoIcon } from '../../components/Icons';

/**
 * `/sign-in` (hosted-portal.md §7.6, mut-43-auth-states.md S3–S10). Email and
 * password only: no signup, reset, invite or third-party door exists anywhere.
 * Every refusal the server can give for bad credentials reads the same.
 */

export type ArrivalReason = 'expired' | 'signed_out';

interface SignInPageProps {
  next?: string;
  reason?: ArrivalReason;
}

type FieldError = 'emailRequired' | 'emailInvalid' | 'passwordRequired';
type Banner = { kind: 'invalid' } | { kind: 'rateLimited'; minutes: number } | { kind: 'unreachable' };

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/**
 * The landing's public /hosted page, the one outward link on this page
 * (MUT-188). A build-time value read at render time through a typeof guard
 * (ADR-076): the test runner defines none, so the line renders only where a
 * build set it, and a test can stub the global before rendering.
 */
function hostedOfferUrl(): string {
  return typeof __HOSTED_OFFER_URL__ !== 'undefined' ? __HOSTED_OFFER_URL__ : '';
}
const SECONDS_PER_MINUTE = 60;

function minutesFrom(error: ApiError): number {
  return Math.max(1, Math.ceil((error.retryAfterSeconds ?? SECONDS_PER_MINUTE) / SECONDS_PER_MINUTE));
}

function bannerFor(error: unknown): Banner {
  if (error instanceof ApiError && error.status === 401) return { kind: 'invalid' };
  if (error instanceof ApiError && error.status === 429) return { kind: 'rateLimited', minutes: minutesFrom(error) };
  return { kind: 'unreachable' };
}

export function SignInPage({ next, reason }: SignInPageProps) {
  const session = useQuery(meQuery);
  // After a sign-out the next person on this machine starts at `/`, not where the last one was.
  const target = reason === 'signed_out' ? undefined : next;
  if (session.isPending) return <CheckingSession />;
  if (session.data) return <Navigate to={safeNext(target)} replace />;
  return <SignInForm next={target} reason={reason} />;
}

function SignInForm({ next, reason }: SignInPageProps) {
  const t = useT();
  const tp = useTp();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const ids = useId();
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ email?: FieldError; password?: FieldError }>({});
  const [banner, setBanner] = useState<Banner | null>(null);

  const signIn = useMutation({
    mutationFn: api.signIn,
    onSuccess: (me) => {
      queryClient.setQueryData(ME_KEY, me);
      void navigate({ to: safeNext(next), replace: true });
    },
    onError: (error) => {
      const next = bannerFor(error);
      setBanner(next);
      if (next.kind === 'invalid') {
        setPassword('');
        passwordRef.current?.focus();
      }
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
    if (signIn.isPending || !validate()) return;
    setBanner(null);
    signIn.mutate({ email: email.trim(), password });
  }

  const pending = signIn.isPending;
  const offerUrl = hostedOfferUrl();
  const bannerId = `${ids}-banner`;
  const describedBy = (field: string, error?: FieldError) =>
    [error ? `${ids}-${field}-error` : null, banner ? bannerId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className="hp-signin">
      <div className="hp-signin-top">
        <LanguageSwitch />
      </div>
      <main className="hp-signin-body">
        <Wordmark />
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
                {banner.kind === 'rateLimited' && tp('hosted.auth.rateLimited', banner.minutes)}
                {banner.kind === 'unreachable' && t('hosted.auth.unreachable')}
              </span>
            </div>
          )}

          <div className="hp-field">
            <label htmlFor={`${ids}-email`}>{t('hosted.auth.email')}</label>
            <input
              ref={emailRef}
              id={`${ids}-email`}
              className={`input hp-ltr-input ${fieldErrors.email ? 'input-error' : ''}`}
              type="email"
              inputMode="email"
              autoComplete="username"
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

          <button type="submit" className="btn btn-primary btn-md hp-block" disabled={pending} aria-busy={pending}>
            {pending && <span className="btn-spinner hp-inline-spinner" aria-hidden="true" />}
            <span>{t(pending ? 'hosted.auth.submitting' : 'hosted.auth.submit')}</span>
          </button>
        </form>
        <p className="hp-help">{t('hosted.auth.help')}</p>
        {offerUrl && (
          <p className="hp-help">
            {t('hosted.auth.request.lead')} <a href={offerUrl}>{t('hosted.auth.request.link')}</a>
          </p>
        )}
      </main>
    </div>
  );
}
