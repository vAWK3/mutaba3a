import { useId, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '../../components/ui/Button';
import { getLocale, useLanguage, useT } from '../../lib/i18n/core';
import { api, ApiError } from '../api/client';
import { closeAccountImpactOf } from '../data/closeAccount';
import { ME_KEY, useMe } from '../session/me';
import { AlertIcon } from './Icons';
import { Drawer } from './Drawer';

/**
 * MUT-333 (ADR-188, D2, D13): Close my account, from You › Account (drawer-first, `?closeAccount=true`). It says
 * what goes and what stays for each of the person's profiles, offers Download my records first, shows the address
 * being closed, and asks for the password again. A wrong password is a banner (the change-password rule). Once
 * closed, `/v1/me` carries the closing and AuthGate shows the closing page in place of the portal.
 */

const FORM_ID = 'hosted-close-account-form';
type Banner = { kind: 'wrongPassword' | 'stripeDown' | 'billingMissing' | 'unreachable' } | { kind: 'blocked'; profiles: string[] };

export function CloseAccountDrawer({ onClose, onDownload }: { onClose: () => void; onDownload: () => void }) {
  const t = useT();
  const { language } = useLanguage();
  const me = useMe();
  // Names and addresses are isolated (FSI…PDI), so a Latin name keeps its order inside an Arabic sentence.
  const isolate = (text: string) => `\u2068${text}\u2069`;
  const list = (names: string[]) => new Intl.ListFormat(getLocale(language), { type: 'conjunction' }).format(names.map(isolate));
  const queryClient = useQueryClient();
  const ids = useId();
  const passwordRef = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState('');
  const [shown, setShown] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [pending, setPending] = useState(false);
  const impact = closeAccountImpactOf(me);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending || password === '') {
      passwordRef.current?.focus();
      return;
    }
    setBanner(null);
    setPending(true);
    try {
      await api.closeAccount({ password });
      // The closing page takes over from here (AuthGate reads `user.closure`).
      await queryClient.invalidateQueries({ queryKey: ME_KEY });
    } catch (error) {
      setPending(false);
      if (error instanceof ApiError && error.code === 'CURRENT_PASSWORD_WRONG') {
        setBanner({ kind: 'wrongPassword' });
        passwordRef.current?.focus();
      } else if (error instanceof ApiError && error.code === 'ACCOUNT_CLOSE_BLOCKED') {
        const named = (error.details as { profiles?: Array<{ name?: unknown }> } | null)?.profiles ?? [];
        setBanner({ kind: 'blocked', profiles: named.map((p) => String(p.name ?? '')) });
      } else if (error instanceof ApiError && error.code === 'STRIPE_UNAVAILABLE') {
        setBanner({ kind: 'stripeDown' });
      } else if (error instanceof ApiError && error.code === 'BILLING_NOT_CONFIGURED') {
        setBanner({ kind: 'billingMissing' });
      } else {
        setBanner({ kind: 'unreachable' });
      }
    }
  }

  // The address is LTR inside a sentence that may be RTL, so the sentence is split at its {email} (TermsUpdatePage).
  const [beforeEmail, afterEmail = ''] = t('hosted.closeAccount.closingAs').split('{email}');
  const bannerId = `${ids}-banner`;
  const hintId = `${ids}-hint`;

  return (
    <Drawer
      title={t('hosted.closeAccount.title')}
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        <div className="drawer-footer-right">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form={FORM_ID} variant="danger" aria-disabled={pending || undefined}>
            {pending ? t('hosted.closeAccount.submitting') : t('hosted.closeAccount.submit')}
          </Button>
        </div>
      }
    >
      <form id={FORM_ID} noValidate onSubmit={onSubmit} className="hp-close-account">
        {banner && (
          <div className="hp-banner hp-banner-error" role="alert" id={bannerId}>
            <AlertIcon />
            <span>
              {banner.kind === 'blocked'
                ? t('hosted.closeAccount.blocked', { profiles: list(banner.profiles) })
                : t(banner.kind === 'unreachable' ? 'hosted.auth.unreachable' : `hosted.closeAccount.${banner.kind}`)}
            </span>
          </div>
        )}
        <p className="hp-setup-lead">{t('hosted.closeAccount.lead')}</p>

        <section aria-labelledby={`${ids}-deleted`}>
          <h3 className="hp-section-title" id={`${ids}-deleted`}>
            {t('hosted.closeAccount.deletesHeading')}
          </h3>
          <ul className="hp-close-list">
            {impact.deletes.length > 0 && <li>{t('hosted.closeAccount.deletesProfiles', { names: list(impact.deletes) })}</li>}
            <li>{t('hosted.closeAccount.deletesSessions')}</li>
            <li>{t('hosted.closeAccount.deletesSubscription')}</li>
          </ul>
        </section>

        {(impact.passesOn.length > 0 || impact.leaves.length > 0) && (
          <section aria-labelledby={`${ids}-kept`}>
            <h3 className="hp-section-title" id={`${ids}-kept`}>
              {t('hosted.closeAccount.staysHeading')}
            </h3>
            <ul className="hp-close-list">
              {impact.passesOn.map(({ profile, people }) => (
                <li key={profile}>{t('hosted.closeAccount.passesOn', { profile: isolate(profile), people: list(people) })}</li>
              ))}
              {impact.leaves.map((profile) => (
                <li key={profile}>{t('hosted.closeAccount.leaves', { profile: isolate(profile) })}</li>
              ))}
            </ul>
          </section>
        )}

        <div className="hp-close-download">
          <p>{t('hosted.closeAccount.downloadLead')}</p>
          <Button type="button" variant="secondary" onClick={onDownload}>
            {t('hosted.closeAccount.download')}
          </Button>
        </div>

        <p className="form-hint">{t('hosted.closeAccount.grace')}</p>

        <div className="form-group">
          <p className="hp-close-who">
            {beforeEmail}
            <bdi dir="ltr">{me.user.email}</bdi>
            {afterEmail}
          </p>
          <label className="form-label" htmlFor={`${ids}-password`}>
            {t('hosted.closeAccount.password')}
          </label>
          <div className="hp-password">
            <input
              ref={passwordRef}
              id={`${ids}-password`}
              className="input"
              type={shown ? 'text' : 'password'}
              autoComplete="current-password"
              dir="ltr"
              readOnly={pending}
              value={password}
              aria-describedby={[hintId, banner ? bannerId : null].filter(Boolean).join(' ')}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button type="button" className="hp-password-toggle press" aria-pressed={shown} aria-controls={`${ids}-password`} onClick={() => setShown((s) => !s)}>
              {t(shown ? 'hosted.auth.hide' : 'hosted.auth.show')}
            </button>
          </div>
          <p className="form-hint" id={hintId}>
            {t('hosted.closeAccount.passwordHint')}
          </p>
        </div>
      </form>
    </Drawer>
  );
}
