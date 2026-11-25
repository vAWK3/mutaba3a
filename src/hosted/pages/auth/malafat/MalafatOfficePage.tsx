import { useId, useRef, useState, type FormEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { useT } from '../../../../lib/i18n/core';
import { api, ApiError } from '../../../api/client';
import { AlertIcon } from '../../../components/Icons';
import { MalafatMark } from '../../../components/MalafatMark';
import { AuthLayout } from '../AuthLayout';
import { leaveForMalafat, MALAFAT_HOST_SUFFIX, malafatStartUrl, officeSlugOf, rememberedOffice, rememberOffice } from './malafatSignIn';

type Problem = 'officeRequired' | 'officeNotFound' | 'unreachable';

/**
 * `/malafat` (MUT-596): "Your Malafat office", the first step of Sign in with Malafat. The person types their office's
 * address once; this device remembers it. The address is checked (GET /v1/auth/malafat/office) before the browser
 * leaves, so a typo is caught here, not on Malafat's own 404.
 */
export function MalafatOfficePage() {
  const t = useT();
  const ids = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [office, setOffice] = useState(rememberedOffice);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [checking, setChecking] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (checking) return;
    const slug = officeSlugOf(office);
    if (!slug) {
      setProblem(office.trim() ? 'officeNotFound' : 'officeRequired');
      inputRef.current?.focus();
      return;
    }
    setProblem(null);
    setChecking(true);
    try {
      await api.malafatOffice(slug);
      rememberOffice(slug);
      leaveForMalafat.go(malafatStartUrl(slug));
    } catch (error) {
      setChecking(false);
      setProblem(error instanceof ApiError && error.status === 404 ? 'officeNotFound' : 'unreachable');
      inputRef.current?.focus();
    }
  }

  const errorId = `${ids}-error`;
  return (
    <AuthLayout>
      <form className="hp-card hp-signin-card" noValidate onSubmit={onSubmit}>
        <h1 className="hp-title-with-mark">
          <MalafatMark size={24} />
          <span>{t('hosted.malafatSignIn.officeTitle')}</span>
        </h1>
        <p>{t('hosted.malafatSignIn.officeLead')}</p>
        {problem === 'unreachable' && (
          <div className="hp-banner hp-banner-error" role="alert">
            <AlertIcon />
            <span>{t('hosted.malafatSignIn.error.unreachable')}</span>
          </div>
        )}
        <div className="hp-field">
          <label htmlFor={`${ids}-office`}>{t('hosted.malafatSignIn.officeLabel')}</label>
          <div className={`input hp-office-field ${problem && problem !== 'unreachable' ? 'input-error' : ''}`}>
            <input
              ref={inputRef}
              id={`${ids}-office`}
              className="hp-office-input"
              type="text"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              dir="ltr"
              autoFocus
              readOnly={checking}
              value={office}
              aria-invalid={problem !== null && problem !== 'unreachable'}
              aria-describedby={problem && problem !== 'unreachable' ? errorId : `${ids}-hint`}
              onChange={(e) => setOffice(e.target.value)}
            />
            <span className="hp-office-suffix">{MALAFAT_HOST_SUFFIX}</span>
          </div>
          {problem && problem !== 'unreachable' ? (
            <p className="hp-field-error" id={errorId}>
              {t(`hosted.malafatSignIn.${problem}`)}
            </p>
          ) : (
            <p className="hp-help" id={`${ids}-hint`}>
              {t('hosted.malafatSignIn.officeRemembered')}
            </p>
          )}
        </div>
        <button type="submit" className="btn btn-primary btn-md hp-block" disabled={checking} aria-busy={checking}>
          {checking && <span className="btn-spinner hp-inline-spinner" aria-hidden="true" />}
          <span>{t('hosted.malafatSignIn.continue')}</span>
        </button>
      </form>
      <p className="hp-help">
        <Link to="/sign-in">{t('hosted.malafatSignIn.back')}</Link>
      </p>
    </AuthLayout>
  );
}
