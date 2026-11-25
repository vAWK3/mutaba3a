import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { useT } from '../../../lib/i18n/core';
import { api, ApiError } from '../../api/client';
import { AlertIcon } from '../../components/Icons';
import { AuthLayout } from '../auth/AuthLayout';
import { tokenFromHash } from '../auth/setupLink';

type Stage = 'ask' | 'off' | 'on' | 'broken';
type Mail = 'monthlySummary' | 'offerMail';

/**
 * `/mail-off#<token>` (MUT-535, D8): where the monthly summary's "Turn it off" link lands. Public, signed in or not:
 * the token names the person. It asks for a press first, so a link scanner opening the mail changes nothing; then it
 * offers to turn the mail back on. The token is read from the fragment and kept in memory only; the URL loses it at
 * once (`replace`, as /setup does). A link that no longer works (the server's 404) points at You › Account.
 * ADR-278: `?mail=offers` is the come-back offer's unsubscribe: the same page, its own words and its own switch.
 */
export function MailOffPage() {
  const t = useT();
  const location = useLocation();
  const navigate = useNavigate();
  const [token] = useState(() => tokenFromHash(location.hash));
  const [mail] = useState<Mail>(() => ((location.search as Record<string, unknown> | undefined)?.mail === 'offers' ? 'offerMail' : 'monthlySummary'));
  const copy = (key: string) => t(`hosted.${mail}.${key}`);
  const [stage, setStage] = useState<Stage>(token ? 'ask' : 'broken');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (location.hash) void navigate({ to: '/mail-off', hash: '', replace: true });
  }, [location.hash, navigate]);

  async function choose(on: boolean) {
    if (!token || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const answer = mail === 'offerMail' ? await api.offerMailPreference(token, on) : await api.mailPreference(token, on);
      setStage(answer.on ? 'on' : 'off');
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setStage('broken');
      else setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const button = (on: boolean, label: string, primary: boolean) => (
    <button type="button" className={`btn ${primary ? 'btn-primary' : 'btn-secondary'} btn-md hp-block`} disabled={busy} aria-busy={busy} onClick={() => void choose(on)}>
      {busy && <span className="btn-spinner hp-inline-spinner" aria-hidden="true" />}
      <span>{label}</span>
    </button>
  );

  return (
    <AuthLayout>
      <section className="hp-card hp-signin-card" aria-live="polite">
        {stage === 'ask' && (
          <>
            <h1>{copy('offAsk')}</h1>
            <p className="hp-setup-lead">{copy('rowSub')}</p>
            {button(false, copy('offButton'), true)}
          </>
        )}
        {stage === 'off' && (
          <>
            <h1>{copy('offDone')}</h1>
            {button(true, copy('onButton'), false)}
          </>
        )}
        {stage === 'on' && (
          <>
            <h1>{copy('onDone')}</h1>
            {button(false, copy('offButton'), false)}
          </>
        )}
        {stage === 'broken' && <p className="hp-setup-lead">{copy('linkBroken')}</p>}
        {failed && (
          <div className="hp-banner hp-banner-error" role="alert">
            <AlertIcon />
            <span>{t('hosted.auth.unreachable')}</span>
          </div>
        )}
      </section>
    </AuthLayout>
  );
}
