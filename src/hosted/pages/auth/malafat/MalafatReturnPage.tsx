import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useT } from '../../../../lib/i18n/core';
import { Select } from '../../../../components/ui/Input';
import { api, ApiError, type MalafatSignInState, type Me } from '../../../api/client';
import { AlertIcon } from '../../../components/Icons';
import { MalafatMark } from '../../../components/MalafatMark';
import { TimezoneChoice } from '../../../components/TimezoneChoice';
import { DEFAULT_HOSTED_CURRENCY, HOSTED_CURRENCIES, type HostedCurrency } from '../../../format/currencies';
import { browserTimezone } from '../../../format/timezones';
import { useAdoptAccountLocale } from '../../../i18n/HostedLanguageProvider';
import { assertPasskey, passkeySupport } from '../../../passkeys/webauthn';
import { firstRunPath } from '../../../session/firstRun';
import { ME_KEY } from '../../../session/me';
import { setMode } from '../../../session/mode';
import { AuthLayout } from '../AuthLayout';
import { CheckingSession } from '../BootScreens';
import { malafatReturnOf, type MalafatReturnError } from './malafatSignIn';

type Failure = MalafatReturnError | 'identityElsewhere' | 'emailTaken' | 'unreachable';
type Step = { kind: 'exchanging' } | { kind: 'failed'; failure: Failure } | { kind: 'link'; state: MalafatSignInState } | { kind: 'consent'; state: MalafatSignInState };

/** What a refusal at any step reads as. A used or expired code or ticket is the same "start again". */
function failureOf(error: unknown): Failure {
  if (error instanceof ApiError && error.status === 404) return 'state_invalid';
  if (error instanceof ApiError && error.status === 409) {
    const reason = (error.details as { reason?: string } | undefined)?.reason;
    if (reason === 'IDENTITY_LINKED_ELSEWHERE') return 'identityElsewhere';
    if (reason === 'EMAIL_TAKEN') return 'emailTaken';
  }
  return 'unreachable';
}

/**
 * `/malafat/return` (MUT-596, MUT-595): where Malafat sends the person back, with `#result=` or `#error=`. The fragment
 * is read once and stripped. The result code is exchanged once (it burns on the first try): a linked person is signed
 * in; otherwise they prove the MTB3A account that has their email (link), then consent, or consent straight away for a
 * new account. Nothing is saved before consent.
 */
export function MalafatReturnPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const adoptAccountLocale = useAdoptAccountLocale();
  const [incoming] = useState(() => malafatReturnOf(location.hash || window.location.hash));
  const [step, setStep] = useState<Step>(() => ('error' in incoming ? { kind: 'failed', failure: incoming.error } : { kind: 'exchanging' }));
  const exchanged = useRef(false);

  // The code leaves the address bar at once, and no history entry keeps it.
  useEffect(() => {
    void navigate({ to: '/malafat/return', replace: true });
  }, [navigate]);

  function signedIn(me: Me) {
    setMode('remote');
    // Whoever was signed in on this browser before (or the local person, MUT-286) is not this person.
    queryClient.removeQueries();
    queryClient.setQueryData(ME_KEY, me);
    adoptAccountLocale(me.user.locale);
    void navigate({ ...firstRunPath(me), replace: true } as never);
  }

  function next(state: MalafatSignInState) {
    if (state.state === 'signed_in' && state.me) return signedIn(state.me);
    setStep(state.state === 'needs_link' ? { kind: 'link', state } : { kind: 'consent', state });
  }

  useEffect(() => {
    if (!('result' in incoming) || exchanged.current) return;
    exchanged.current = true;
    api.malafatExchange(incoming.result).then(next, (error: unknown) => setStep({ kind: 'failed', failure: failureOf(error) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one exchange per return; the code is single use
  }, [incoming]);

  if (step.kind === 'exchanging') return <CheckingSession />;
  if (step.kind === 'failed') return <MalafatFailed failure={step.failure} />;
  if (step.kind === 'link') return <MalafatLink state={step.state} onLinked={next} onFailed={(failure) => setStep({ kind: 'failed', failure })} />;
  return <MalafatConsent state={step.state} onDone={next} onFailed={(failure) => setStep({ kind: 'failed', failure })} />;
}

function MalafatFailed({ failure }: { failure: Failure }) {
  const t = useT();
  return (
    <AuthLayout>
      <section className="hp-card hp-signin-card">
        <h1 className="hp-title-with-mark">
          <MalafatMark size={24} />
          <span>{t('hosted.malafatSignIn.button')}</span>
        </h1>
        <div className="hp-banner hp-banner-error" role="alert">
          <AlertIcon />
          <span>{t(`hosted.malafatSignIn.error.${failure}`)}</span>
        </div>
        <Link to="/sign-in" className="btn btn-secondary btn-md hp-block">
          {t('hosted.malafatSignIn.startAgain')}
        </Link>
      </section>
    </AuthLayout>
  );
}

interface StepProps {
  state: MalafatSignInState;
  onFailed: (failure: Failure) => void;
}

/** D4: the MTB3A account that has this email, proven with its own password or passkey. Never linked by email alone. */
function MalafatLink({ state, onLinked, onFailed }: StepProps & { onLinked: (state: MalafatSignInState) => void }) {
  const t = useT();
  const ids = useId();
  const passwordRef = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [pending, setPending] = useState(false);
  const ticket = state.ticket ?? '';

  async function prove(body: Parameters<typeof api.malafatLink>[0]) {
    setPending(true);
    setInvalid(false);
    try {
      onLinked(await api.malafatLink(body));
    } catch (error) {
      setPending(false);
      if (error instanceof ApiError && error.status === 401) {
        setInvalid(true);
        setPassword('');
        passwordRef.current?.focus();
        return;
      }
      onFailed(failureOf(error));
    }
  }

  async function withPasskey() {
    setPending(true);
    try {
      const challenge = await api.passkeyChallenge();
      const outcome = await assertPasskey(challenge.publicKey as PublicKeyCredentialRequestOptionsJSON);
      if (outcome.kind !== 'ok') return void setPending(false);
      await prove({ ticket, passkey: { challengeId: challenge.challengeId, response: outcome.response as unknown as Record<string, unknown> } });
    } catch (error) {
      setPending(false);
      onFailed(failureOf(error));
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (!password) return passwordRef.current?.focus();
    void prove({ ticket, password });
  }

  return (
    <AuthLayout>
      <form className="hp-card hp-signin-card" noValidate onSubmit={onSubmit}>
        <h1>{t('hosted.malafatSignIn.link.title')}</h1>
        <p>{t('hosted.malafatSignIn.link.lead', { email: state.email ?? '' })}</p>
        <div className="hp-field">
          <label htmlFor={`${ids}-password`}>{t('hosted.malafatSignIn.link.password')}</label>
          <input
            ref={passwordRef}
            id={`${ids}-password`}
            className={`input hp-ltr-input ${invalid ? 'input-error' : ''}`}
            type="password"
            autoComplete="current-password"
            dir="ltr"
            autoFocus
            readOnly={pending}
            value={password}
            aria-invalid={invalid}
            aria-describedby={invalid ? `${ids}-invalid` : undefined}
            onChange={(e) => setPassword(e.target.value)}
          />
          {invalid && (
            <p className="hp-field-error" id={`${ids}-invalid`}>
              {t('hosted.malafatSignIn.link.invalid')}
            </p>
          )}
        </div>
        <button type="submit" className="btn btn-primary btn-md hp-block" disabled={pending} aria-busy={pending}>
          {pending && <span className="btn-spinner hp-inline-spinner" aria-hidden="true" />}
          <span>{t('hosted.malafatSignIn.link.submit')}</span>
        </button>
        {passkeySupport() && (
          <>
            <div className="hp-divider" role="separator">
              <span>{t('hosted.auth.passkey.or')}</span>
            </div>
            <button type="button" className="btn btn-secondary btn-md hp-block" disabled={pending} onClick={() => void withPasskey()}>
              {t('hosted.malafatSignIn.link.passkey')}
            </button>
          </>
        )}
        <p className="hp-help">{t('hosted.malafatSignIn.link.notByEmail')}</p>
      </form>
    </AuthLayout>
  );
}

/** D8: the one consent, at the first link. A new account also names its currency and time zone (D5). */
function MalafatConsent({ state, onDone, onFailed }: StepProps & { onDone: (state: MalafatSignInState) => void }) {
  const t = useT();
  const ids = useId();
  const navigate = useNavigate();
  const zone = browserTimezone();
  const [currency, setCurrency] = useState<HostedCurrency>(DEFAULT_HOSTED_CURRENCY);
  const [timezone, setTimezone] = useState(zone);
  const [zoneOpen, setZoneOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const creates = state.creates === true;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    try {
      onDone(await api.malafatConsent({ ticket: state.ticket ?? '', ...(creates ? { defaultCurrency: currency, timezone } : {}) }));
    } catch (error) {
      setPending(false);
      onFailed(failureOf(error));
    }
  }

  return (
    <AuthLayout>
      <form className="hp-card hp-signin-card hp-consent" noValidate onSubmit={(e) => void onSubmit(e)}>
        <h1>{t('hosted.malafatSignIn.consent.title')}</h1>
        <p>{t(creates ? 'hosted.malafatSignIn.consent.createLead' : 'hosted.malafatSignIn.consent.linkLead', { email: state.email ?? '' })}</p>
        <p className="hp-consent-name">
          <bdi dir="auto">{state.office?.name ?? ''}</bdi>
        </p>
        <ul className="hp-consent-scopes">
          <li>{t('hosted.malafatSignIn.consent.firmBooks')}</li>
          <li>{t('hosted.malafatSignIn.consent.ownProfile')}</li>
        </ul>
        {creates && (
          <>
            <div className="hp-field">
              <label htmlFor={`${ids}-currency`}>{t('hosted.malafatSignIn.consent.currency')}</label>
              <Select id={`${ids}-currency`} name="currency" disabled={pending} value={currency} onChange={(e) => setCurrency(e.target.value as HostedCurrency)}>
                {HOSTED_CURRENCIES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </Select>
            </div>
            <div className="hp-field">
              <TimezoneChoice id={`${ids}-timezone`} browserZone={zone} value={timezone} onChange={setTimezone} open={zoneOpen} onOpen={() => setZoneOpen(true)} />
            </div>
          </>
        )}
        <div className="hp-consent-actions">
          <button type="button" className="btn btn-secondary btn-md" disabled={pending} onClick={() => void navigate({ to: '/sign-in', replace: true })}>
            {t('hosted.malafatSignIn.consent.cancel')}
          </button>
          <button type="submit" className="btn btn-primary btn-md" disabled={pending} aria-busy={pending}>
            {pending && <span className="btn-spinner hp-inline-spinner" aria-hidden="true" />}
            <span>{t(creates ? 'hosted.malafatSignIn.consent.create' : 'hosted.malafatSignIn.consent.connect')}</span>
          </button>
        </div>
        <p className="hp-help">{t('hosted.malafatSignIn.consent.nothingYet')}</p>
      </form>
    </AuthLayout>
  );
}
