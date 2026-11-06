import { useEffect, useId, useReducer, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../../lib/i18n/core';
import { useTp } from '../../../lib/i18n/plural';
import { Button } from '../../../components/ui/Button';
import { BrandLoader } from '../../../components/brand/BrandLoader';
import { api, type Me, type ShareLinkUnlock } from '../../api/client';
import { setReporterUser } from '../../observability/errorReporting';
import { ME_KEY } from '../../session/me';
import { countPublicPage } from '../../analytics/portalAnalytics';
import { AlertIcon } from '../../components/Icons';
import { PIN_MIN, PinBoxes } from '../../components/PinBoxes';
import { TwoPanelLayout } from '../../components/TwoPanelLayout';
import { tokenFromHash } from '../auth/setupLink';
import { INITIAL_SHARE_LINK_STATE, forgetsViewer, shareLinkReducer, type PinProblem, type ShareLinkState } from './shareLinkState';
import { ShareLinkView } from './ShareLinkView';
import { forgetLinkForTab, forgetViewerToken, linkDigest, linkForTab, readViewerToken, rememberLinkForTab, saveViewerToken } from './viewerTokens';

/**
 * `/share#<token>` (MUT-562 over MUT-560's visitor routes, layout B): a share link's page, public, no account. The
 * token is read from the fragment and stripped at once (`replace`, as /setup), then kept for this tab only. Nothing
 * that names the profile or its owner shows before the right PIN (SL1). The page is `noindex` and sends no referrer.
 */
export function ShareLinkPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const incoming = tokenFromHash(location.hash);
  const [token, setToken] = useState(() => incoming ?? linkForTab());
  if (incoming && incoming !== token) setToken(incoming);

  useEffect(() => {
    if (!location.hash) return;
    if (incoming) rememberLinkForTab(incoming);
    void navigate({ to: '/share', replace: true });
  }, [location.hash, incoming, navigate]);

  usePrivatePageMeta();
  useNoReporterUser();

  if (!token) return <Ended state={{ kind: 'gone' }} />;
  return <ShareLink key={token} token={token} />;
}

/**
 * `noindex` (the portal's own, hosted.html; added here only if missing) and `no-referrer` while the page is open, in
 * place of the portal's `same-origin`, so a receipt opened from it never names the page. Put back on leaving.
 */
function usePrivatePageMeta() {
  useEffect(() => {
    const restore = [setMeta('robots', 'noindex, nofollow', false), setMeta('referrer', 'no-referrer', true)];
    return () => restore.forEach((undo) => undo());
  }, []);
}

/**
 * Review fix 4: a crash on a stranger's page is never tied to whoever is signed in on this browser. The reporter's
 * user is cleared while the page is open and put back (the signed-in person, if any) on leaving.
 */
function useNoReporterUser() {
  const queryClient = useQueryClient();
  useEffect(() => {
    setReporterUser(null);
    return () => setReporterUser(queryClient.getQueryData<Me>(ME_KEY)?.user.id ?? null);
  }, [queryClient]);
}

/** Sets a `<meta name>`: an existing one is changed when `override`, kept otherwise; returns how to undo it. */
function setMeta(name: string, content: string, override: boolean): () => void {
  const existing = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (existing) {
    if (!override) return () => undefined;
    const before = existing.content;
    existing.content = content;
    return () => {
      existing.content = before;
    };
  }
  const meta = document.createElement('meta');
  meta.name = name;
  meta.content = content;
  document.head.appendChild(meta);
  return () => meta.remove();
}

function ShareLink({ token }: { token: string }) {
  const [state, dispatch] = useReducer(shareLinkReducer, INITIAL_SHARE_LINK_STATE);
  // Each Retry asks the server again with a fresh query, so an old failure can't answer for it.
  const [attempt, setAttempt] = useState(0);
  const digest = useQuery({ queryKey: ['shareLink', 'digest', token], queryFn: () => linkDigest(token), staleTime: Infinity, gcTime: 0 });
  const check = useQuery({
    queryKey: ['shareLink', 'check', digest.data, attempt],
    queryFn: ({ signal }) => api.checkShareLink(token, signal),
    enabled: digest.data !== undefined && state.kind === 'checking',
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (state.kind !== 'checking') return;
    if (check.isSuccess) dispatch({ type: 'checked' });
    else if (check.isError) dispatch({ type: 'checkFailed', error: check.error });
  }, [state.kind, check.isSuccess, check.isError, check.error]);

  // Review fixes 3: a link that ended for good leaves nothing behind, neither its viewer record nor the tab's link
  useEffect(() => {
    if (state.kind === 'gone' || state.kind === 'locked' || state.kind === 'limit') forgetLinkForTab();
    if (digest.data && forgetsViewer(state)) forgetViewerToken(digest.data);
  }, [digest.data, state]);

  if (state.kind === 'open' && digest.data) {
    return <ShareLinkView digest={digest.data} unlock={state.unlock} onViewFailed={(error) => dispatch({ type: 'viewFailed', error })} />;
  }
  if (state.kind === 'pin' && digest.data) {
    return <PinStep token={token} digest={digest.data} state={state} onUnlocked={(unlock) => dispatch({ type: 'unlocked', unlock })} onFailed={(error) => dispatch({ type: 'unlockFailed', error })} />;
  }
  if (state.kind === 'unreachable') return <Unreachable minutes={state.minutes} onRetry={() => {
          setAttempt((n) => n + 1);
          dispatch({ type: 'retry' });
        }} />;
  if (state.kind === 'locked' || state.kind === 'gone' || state.kind === 'limit') return <Ended state={state} />;
  return (
    <TwoPanelLayout context={<PrivateViewNote />}>
      <div className="loading loading--section">
        <BrandLoader size={40} />
      </div>
    </TwoPanelLayout>
  );
}

function PrivateViewNote() {
  const t = useT();
  return <p className="hp-two-panel-lead">{t('hosted.shareLink.privateView')}</p>;
}

function PinStep({
  token,
  digest,
  state,
  onUnlocked,
  onFailed,
}: {
  token: string;
  digest: string;
  state: Extract<ShareLinkState, { kind: 'pin' }>;
  onUnlocked: (unlock: ShareLinkUnlock) => void;
  onFailed: (error: unknown) => void;
}) {
  const t = useT();
  const ids = useId();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [short, setShort] = useState(false);
  const problemId = `${ids}-problem`;

  async function onSubmit(event?: FormEvent) {
    event?.preventDefault();
    if (busy) return;
    if (pin.length < PIN_MIN) return setShort(true);
    setShort(false);
    setBusy(true);
    try {
      const previous = readViewerToken(digest);
      const unlock = await api.unlockShareLink({ token, pin, ...(previous ? { viewerToken: previous } : {}) });
      saveViewerToken(digest, { viewerToken: unlock.viewerToken, viewerExpiresAt: unlock.viewerExpiresAt, linkExpiresAt: unlock.linkExpiresAt });
      countPublicPage({ event: 'share_link_opened', properties: { period: unlock.period.toLowerCase() as never } });
      onUnlocked(unlock);
    } catch (error) {
      setPin('');
      setBusy(false);
      onFailed(error);
    }
  }

  return (
    <TwoPanelLayout context={<PrivateViewNote />}>
      <form className="hp-two-panel-form" noValidate onSubmit={(event) => void onSubmit(event)}>
        <h1>{t(state.again ? 'hosted.shareLink.again.title' : 'hosted.shareLink.enterPin')}</h1>
        {state.again && <p className="hp-setup-lead">{t('hosted.shareLink.again.body')}</p>}
        <PinBoxes
          value={pin}
          onChange={(next) => {
            setPin(next);
            setShort(false);
          }}
          label={t('hosted.shareLink.enterPin')}
          onSubmit={() => void onSubmit()}
          invalid={state.problem?.kind === 'wrong' || short}
          disabled={busy}
          describedBy={state.problem || short ? problemId : undefined}
          autoFocus
        />
        {(state.problem || short) && (
          <p className="hp-field-error" id={problemId} role="alert">
            {short ? t('hosted.shareLink.pinShort') : <ProblemLine problem={state.problem!} />}
          </p>
        )}
        <Button type="submit" variant="primary" className="hp-block" disabled={busy} aria-busy={busy}>
          {t(busy ? 'hosted.shareLink.opening' : 'hosted.shareLink.open')}
        </Button>
        <p className="hp-field-hint">{t('hosted.shareLink.askSender')}</p>
      </form>
    </TwoPanelLayout>
  );
}

function ProblemLine({ problem }: { problem: PinProblem }) {
  const t = useT();
  const tp = useTp();
  if (problem.kind === 'wrong') return <>{tp('hosted.shareLink.wrong', problem.attemptsLeft)}</>;
  if (problem.kind === 'rateLimited') return <>{tp('hosted.shareLink.rateLimited', problem.minutes)}</>;
  if (problem.kind === 'retry') return <>{t('hosted.shareLink.retry')}</>;
  return <>{t('hosted.shareLink.unreachable')}</>;
}

/** Locked, gone or full: the page ends here, with nothing to press. */
function Ended({ state }: { state: Extract<ShareLinkState, { kind: 'locked' | 'gone' | 'limit' }> }) {
  const t = useT();
  return (
    <TwoPanelLayout context={<PrivateViewNote />}>
      {/* TODO(MUT-561): the `link-closed` scene above the heading once MUT-561's Scene renderer merges. */}
      <section className="hp-two-panel-ended" role="status" data-state={state.kind}>
        <h1>{t(`hosted.shareLink.${state.kind}.title`)}</h1>
        <p className="hp-setup-lead">{t(`hosted.shareLink.${state.kind}.body`)}</p>
      </section>
    </TwoPanelLayout>
  );
}

function Unreachable({ minutes, onRetry }: { minutes?: number; onRetry: () => void }) {
  const t = useT();
  const tp = useTp();
  return (
    <TwoPanelLayout context={<PrivateViewNote />}>
      <section className="hp-two-panel-ended" role="alert">
        <p className="hp-banner hp-banner-error">
          <AlertIcon />
          <span>{minutes ? tp('hosted.shareLink.rateLimited', minutes) : t('hosted.shareLink.unreachable')}</span>
        </p>
        <Button variant="secondary" onClick={onRetry}>
          {t('hosted.shareLink.retryButton')}
        </Button>
      </section>
    </TwoPanelLayout>
  );
}
