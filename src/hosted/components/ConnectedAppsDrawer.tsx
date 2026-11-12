import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../components/ui/Button';
import { useLanguage, useT } from '../../lib/i18n/core';
import { api, type ConnectedApp } from '../api/client';
import { CONNECTED_APPS_KEY } from '../data/oauthQueries';
import { formatInstant } from '../format/dates';
import { browserTimezone } from '../format/timezones';
import { AlertIcon } from './Icons';
import { Drawer } from './Drawer';
import { MalafatMark } from './MalafatMark';
import { QueryView } from './QueryView';
import { useToast } from './Toast';

/**
 * You › Account › Connected apps (MUT-596, ADR-254 D9): Malafat acting for the person, one row per firm, each with an
 * in-row Disconnect confirm (ConnectClaudeDrawer's pattern; no window.confirm). Disconnecting ends that firm's
 * connection at once; what Malafat recorded stays. AI agents stay in Connect Claude.
 */
export function ConnectedAppsDrawer({ onClose }: { onClose: () => void }) {
  const t = useT();
  const apps = useQuery({ queryKey: CONNECTED_APPS_KEY, queryFn: ({ signal }) => api.listConnectedApps(signal), retry: false });
  const [failed, setFailed] = useState(false);

  return (
    <Drawer title={t('hosted.connectedApps.title')} onClose={onClose} closeLabel={t('common.close')}>
      <QueryView queries={[apps]} data={apps.data}>
        {(data) => (
          <>
            <p className="hp-muted hp-passkey-intro">{t('hosted.connectedApps.lead')}</p>
            {failed && (
              <div className="hp-banner hp-banner-error" role="alert">
                <AlertIcon />
                <span>{t('hosted.connect.revokeFailed')}</span>
              </div>
            )}
            {data.items.length === 0 ? (
              <p className="hp-muted">{t('hosted.connectedApps.empty')}</p>
            ) : (
              <ul className="hp-passkey-list">
                {data.items.map((app) => (
                  <ConnectedAppRow key={app.grantId} app={app} onFailed={setFailed} />
                ))}
              </ul>
            )}
            <p className="hp-help">{t('hosted.connectedApps.agentsHint')}</p>
          </>
        )}
      </QueryView>
    </Drawer>
  );
}

function ConnectedAppRow({ app, onFailed }: { app: ConnectedApp; onFailed: (failed: boolean) => void }) {
  const t = useT();
  const { language } = useLanguage();
  const showToast = useToast();
  const queryClient = useQueryClient();
  const ids = useId();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const disconnectRef = useRef<HTMLButtonElement>(null);
  const firm = app.firmName ?? t('hosted.connectedApps.unknownFirm');

  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

  const timeZone = browserTimezone();
  const meta = [
    t('hosted.connectedApps.since', { date: formatInstant(app.connectedAt, language, timeZone) }),
    ...(app.lastUsedAt ? [t('hosted.connectedApps.lastUsed', { date: formatInstant(app.lastUsedAt, language, timeZone) })] : []),
  ].join(' · ');

  function cancel() {
    setConfirming(false);
    requestAnimationFrame(() => disconnectRef.current?.focus());
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape' && confirming) {
      event.stopPropagation();
      cancel();
    }
  }

  async function disconnect() {
    setBusy(true);
    onFailed(false);
    try {
      await api.revokeConnectedApp(app.grantId);
      await queryClient.invalidateQueries({ queryKey: CONNECTED_APPS_KEY });
      showToast(t('hosted.connectedApps.disconnected', { firm }), { tone: 'info' });
    } catch {
      onFailed(true);
      setBusy(false);
    }
  }

  return (
    <li className="hp-passkey-row" onKeyDown={onKeyDown}>
      {confirming ? (
        <div className="hp-passkey-confirm" role="group" aria-labelledby={`${ids}-confirm`}>
          <p id={`${ids}-confirm`}>{t('hosted.connectedApps.confirm', { firm })}</p>
          <div className="hp-passkey-actions">
            <Button ref={cancelRef} type="button" variant="secondary" size="sm" onClick={cancel}>
              {t('hosted.connectedApps.keep')}
            </Button>
            <Button type="button" variant="danger" size="sm" aria-busy={busy} disabled={busy} onClick={() => void disconnect()}>
              {t('hosted.connectedApps.disconnect')}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <MalafatMark size={28} />
          <span className="hp-passkey-text">
            <span className="hp-passkey-name">
              {app.clientName} · <bdi dir="auto">{firm}</bdi>
            </span>
            <span className="hp-option-sub">{meta}</span>
          </span>
          <span className="hp-passkey-actions">
            <button ref={disconnectRef} type="button" className="hp-link-button hp-danger press" aria-label={`${t('hosted.connectedApps.disconnect')}: ${firm}`} onClick={() => setConfirming(true)}>
              {t('hosted.connectedApps.disconnect')}
            </button>
          </span>
        </>
      )}
    </li>
  );
}
