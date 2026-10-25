import { useEffect, useRef, useState } from 'react';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Button } from '../../../components/ui/Button';
import { useT } from '../../../lib/i18n/core';
import { api, ApiError, type Schemas } from '../../api/client';
import { AlertIcon } from '../../components/Icons';
import { useIsLocalMode } from '../../session/mode';
import { AuthLayout } from '../auth/AuthLayout';
import { CheckingSession } from '../auth/BootScreens';
import { consentNavigation, type ConsentSearch } from './consentSearch';

/** The errors /oauth/authorize can send here instead of to an untrusted redirect (structure B, D1), and this page's own `expired`. */
const KNOWN_ERRORS = new Set(['invalid_client', 'invalid_redirect_uri', 'invalid_request', 'temporarily_unavailable', 'expired']);

/**
 * `/connect/approve` (MUT-434): an agent such as Claude asks to connect. Shows who is asking — its own name with
 * dir="auto", how much we trust where the code goes, and what read and write allow — then Allow or Deny. Without
 * agent_access it refuses plainly and offers "Back to Claude" (AC2). An answered or expired request says to start
 * again from the agent. Signed out on this device (local mode, MUT-286) there is no account to connect: sign in first,
 * and come back here with the request kept.
 */
export function ConsentPage({ search }: { search: ConsentSearch }) {
  const local = useIsLocalMode();
  if (local) return <SignInFirst />;
  if (search.error || !search.request) return <ConsentError code={search.error ?? 'invalid_request'} />;
  return <ConsentRequest requestId={search.request} />;
}

/** Local mode answers /v1/me itself, so AuthGate never sends anyone to sign in; this page does. */
function SignInFirst() {
  const router = useRouter();
  const navigate = useNavigate();
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    void navigate({ to: '/sign-in', search: { next: router.state.location.href }, replace: true });
  }, [navigate, router]);
  return null;
}

function ConsentError({ code }: { code: string }) {
  const t = useT();
  const key = KNOWN_ERRORS.has(code) ? code : 'unknown';
  return (
    <AuthLayout>
      <section className="card hp-signin-card hp-consent" aria-labelledby="consent-error-title">
        <h1 id="consent-error-title">{t('hosted.consent.error.title')}</h1>
        <p>{t(`hosted.consent.error.${key}`)}</p>
        <p className="hp-muted">{t('hosted.consent.startAgain')}</p>
      </section>
    </AuthLayout>
  );
}

function ConsentRequest({ requestId }: { requestId: string }) {
  const t = useT();
  const request = useQuery({ queryKey: ['oauth', 'request', requestId], queryFn: ({ signal }) => api.oauthRequest(requestId, signal), retry: false });
  const [busy, setBusy] = useState<'approve' | 'deny' | null>(null);
  const [failed, setFailed] = useState(false);

  if (request.isPending) return <CheckingSession />;
  if (request.isError) {
    const gone = request.error instanceof ApiError && request.error.status === 404;
    return gone ? <ConsentError code="expired" /> : <ConsentError code="unknown" />;
  }

  async function decide(decision: 'approve' | 'deny') {
    if (busy) return;
    setBusy(decision);
    setFailed(false);
    try {
      const { redirectTo } = await api.decideOauthRequest(requestId, decision);
      consentNavigation.assign(redirectTo);
    } catch (error) {
      setBusy(null);
      // Answered elsewhere, expired, or the flag just went: read it again and show what is true now (Q2).
      if (error instanceof ApiError && (error.status === 409 || error.status === 403)) void request.refetch();
      else setFailed(true);
    }
  }

  const data = request.data;
  if (!data.agentAccess) return <Refused data={data} busy={busy !== null} onBack={() => void decide('deny')} />;
  return (
    <AuthLayout>
      <section className="card hp-signin-card hp-consent" aria-labelledby="consent-title">
        <h1 id="consent-title">{t('hosted.consent.title')}</h1>
        <p className="hp-consent-client">
          <bdi className="hp-consent-name" dir="auto">
            {data.client.name}
          </bdi>{' '}
          {t('hosted.consent.wants')}
        </p>
        <TrustLine client={data.client} />
        <ul className="hp-consent-scopes">
          {data.scopes.map((scope) => (
            <li key={scope}>{t(`hosted.consent.scope.${scope}`)}</li>
          ))}
        </ul>
        <p className="hp-muted">{t('hosted.consent.revokeAnytime')}</p>
        {failed && (
          <div className="hp-banner hp-banner-error" role="alert">
            <AlertIcon />
            <span>{t('hosted.auth.unreachable')}</span>
          </div>
        )}
        <div className="hp-consent-actions">
          <Button type="button" variant="secondary" disabled={busy !== null} aria-busy={busy === 'deny'} onClick={() => void decide('deny')}>
            {t('hosted.consent.deny')}
          </Button>
          <Button type="button" disabled={busy !== null} aria-busy={busy === 'approve'} onClick={() => void decide('approve')}>
            {t('hosted.consent.allow')}
          </Button>
        </div>
      </section>
    </AuthLayout>
  );
}

function TrustLine({ client }: { client: Schemas['OAuthAuthorizationRequest']['client'] }) {
  const t = useT();
  if (client.trust === 'UNVERIFIED') {
    return (
      <div className="hp-banner hp-banner-warning" role="note">
        <AlertIcon />
        <span>
          {t('hosted.consent.trust.UNVERIFIED')}{' '}
          <bdi dir="ltr">{client.redirectHost}</bdi>
        </span>
      </div>
    );
  }
  return <p className="hp-muted">{t(`hosted.consent.trust.${client.trust}`)}</p>;
}

function Refused({ data, busy, onBack }: { data: Schemas['OAuthAuthorizationRequest']; busy: boolean; onBack: () => void }) {
  const t = useT();
  return (
    <AuthLayout>
      <section className="card hp-signin-card hp-consent" aria-labelledby="consent-refused-title">
        <h1 id="consent-refused-title">{t('hosted.consent.refused.title')}</h1>
        <p>{t('hosted.consent.refused.body')}</p>
        <div className="hp-consent-actions">
          <Button type="button" disabled={busy} aria-busy={busy} onClick={onBack}>
            {t('hosted.consent.refused.back', { name: data.client.name })}
          </Button>
        </div>
      </section>
    </AuthLayout>
  );
}
