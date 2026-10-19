import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLanguage, useT } from '../../../lib/i18n/core';
import { api, type Me } from '../../api/client';
import { LanguageSwitch, Wordmark } from '../../components/Brand';
import { AlertIcon } from '../../components/Icons';
import { ME_KEY } from '../../session/me';
import { useSignOut } from '../../session/useSignOut';
import { SUPPORT_EMAIL, termsHref } from '../../terms';

/**
 * MUT-324 (ADR-102, D1, D6): stands in front of the portal when the person's
 * latest acceptance is older than the current terms. They read the exact
 * version (a new tab), then agree, or leave: signing out, or writing to us to
 * take their records or close the account. Nobody is held away from their data.
 */
export function TermsUpdatePage({ me, version }: { me: Me; version: string }) {
  const t = useT();
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const { signOut, signingOut } = useSignOut();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const link = termsHref(language, version);

  async function agree() {
    if (saving) return;
    setSaving(true);
    setFailed(false);
    try {
      const terms = await api.acceptTerms({ version, locale: language === 'ar' ? 'ar' : 'en' });
      queryClient.setQueryData<Me>(ME_KEY, { ...me, terms });
    } catch {
      setFailed(true);
      setSaving(false);
    }
  }

  return (
    <div className="hp-signin">
      <div className="hp-signin-top">
        <LanguageSwitch />
      </div>
      <main className="hp-signin-body">
        <Wordmark />
        <div className="hp-card hp-signin-card">
          <h1>{t('hosted.terms.title')}</h1>
          <p className="hp-setup-lead">{t('hosted.terms.lead')}</p>
          {failed && (
            <div className="hp-banner hp-banner-error" role="alert">
              <AlertIcon />
              <span>{t('hosted.terms.failed')}</span>
            </div>
          )}
          {link && (
            <p>
              <a href={link} target="_blank" rel="noopener">
                {t('hosted.terms.read')}
              </a>
            </p>
          )}
          <button type="button" className="btn btn-primary btn-md hp-block" disabled={saving || signingOut} aria-busy={saving} onClick={() => void agree()}>
            {saving && <span className="btn-spinner hp-inline-spinner" aria-hidden="true" />}
            <span>{t(saving ? 'hosted.terms.agreeing' : 'hosted.terms.agree')}</span>
          </button>
          <button type="button" className="btn btn-secondary btn-md hp-block" disabled={saving || signingOut} onClick={() => void signOut()}>
            {t('hosted.auth.signOut')}
          </button>
          <p className="hp-field-hint">{t('hosted.terms.decline', { email: SUPPORT_EMAIL })}</p>
        </div>
      </main>
    </div>
  );
}
