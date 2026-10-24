import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLanguage, useT } from '../../../lib/i18n/core';
import { api, type Me } from '../../api/client';
import { LanguageSwitch, Wordmark } from '../../components/Brand';
import { AlertIcon } from '../../components/Icons';
import { useToast } from '../../components/Toast';
import { closingDayLabel, personalTimeZoneOf } from '../../data/closeAccount';
import { ME_KEY } from '../../session/me';
import { useSignOut } from '../../session/useSignOut';

/**
 * MUT-333 (ADR-188, D3): stands in front of the portal while the account is closing, in place of everything else
 * (the server answers 403 ACCOUNT_CLOSING to all but Me, Keep my account and sign-out). It names the deletion day
 * and offers Keep my account and Sign out. A full page, not a drawer: it is a state of the account, like the terms
 * update (TermsUpdatePage), not something created or edited.
 */
export function AccountClosingPage({ me }: { me: Me }) {
  const t = useT();
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const showToast = useToast();
  const { signOut, signingOut } = useSignOut();
  const [keeping, setKeeping] = useState(false);
  const [failed, setFailed] = useState(false);
  const closure = me.user.closure;
  if (!closure) return null;
  const day = closingDayLabel(closure.deleteAfter, language, personalTimeZoneOf(me));

  async function keep() {
    if (keeping) return;
    setKeeping(true);
    setFailed(false);
    try {
      const { billingNeedsAttention } = await api.keepAccount();
      showToast(t(billingNeedsAttention ? 'hosted.closeAccount.keptBilling' : 'hosted.closeAccount.kept'), { tone: 'info' });
      await queryClient.invalidateQueries({ queryKey: ME_KEY });
    } catch {
      setFailed(true);
      setKeeping(false);
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
          <h1>{t('hosted.closeAccount.closingTitle')}</h1>
          <p className="hp-setup-lead">{t('hosted.closeAccount.closingBody', { date: day })}</p>
          <p>{t('hosted.closeAccount.closingNothingYet')}</p>
          {failed && (
            <div className="hp-banner hp-banner-error" role="alert">
              <AlertIcon />
              <span>{t('hosted.auth.unreachable')}</span>
            </div>
          )}
          <button type="button" className="btn btn-primary btn-md hp-block" disabled={keeping || signingOut} aria-busy={keeping} onClick={() => void keep()}>
            {keeping && <span className="btn-spinner hp-inline-spinner" aria-hidden="true" />}
            <span>{t(keeping ? 'hosted.closeAccount.keeping' : 'hosted.closeAccount.keep')}</span>
          </button>
          <button type="button" className="btn btn-secondary btn-md hp-block" disabled={keeping || signingOut} onClick={() => void signOut()}>
            {t('hosted.auth.signOut')}
          </button>
        </div>
      </main>
    </div>
  );
}
