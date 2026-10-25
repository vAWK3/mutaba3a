import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../components/ui/Button';
import { useLanguage, useT } from '../../lib/i18n/core';
import { api, type Schemas } from '../api/client';
import { OAUTH_GRANTS_KEY } from '../data/oauthQueries';
import { formatInstant } from '../format/dates';
import { browserTimezone } from '../format/timezones';
import { useHasFeature } from '../session/features';
import { CopyField } from './CopyField';
import { AlertIcon } from './Icons';
import { Drawer } from './Drawer';
import { QueryView } from './QueryView';
import { useToast } from './Toast';

type Grant = Schemas['OAuthGrant'];

/**
 * You › Account › Connect Claude (MUT-434, D15): the MCP address to paste into Claude, short how-tos for Claude.ai and
 * Claude Code, and the agents connected, each with an in-row Disconnect confirm (the PasskeysDrawer pattern; no
 * window.confirm). Without agent_access it only says the feature isn't on. Client names are the agent's own, shown with
 * dir="auto" and next to how much we trust where its codes go.
 */
export function ConnectClaudeDrawer({ onClose }: { onClose: () => void }) {
  const t = useT();
  const enabled = useHasFeature('agent_access');
  const grants = useQuery({ queryKey: OAUTH_GRANTS_KEY, queryFn: ({ signal }) => api.listOauthGrants(signal), enabled });
  const [failed, setFailed] = useState(false);

  return (
    <Drawer title={t('hosted.connect.title')} onClose={onClose} closeLabel={t('common.close')}>
      {!enabled ? (
        <p className="hp-muted">{t('hosted.connect.notEnabled')}</p>
      ) : (
        <QueryView queries={[grants]} data={grants.data}>
          {(data) => (
            <>
              <p className="hp-muted hp-passkey-intro">{t('hosted.connect.intro')}</p>
              <CopyField label={t('hosted.connect.urlLabel')} value={data.mcpUrl} />
              <h3 className="hp-connect-heading">{t('hosted.connect.howTitle')}</h3>
              <ol className="hp-connect-steps">
                <li>{t('hosted.connect.howClaudeAi')}</li>
                <li>
                  {t('hosted.connect.howClaudeCode')}{' '}
                  <code dir="ltr">claude mcp add --transport http mtb3a {data.mcpUrl}</code>
                </li>
              </ol>
              <h3 className="hp-connect-heading">{t('hosted.connect.appsTitle')}</h3>
              {failed && (
                <div className="hp-banner hp-banner-error" role="alert">
                  <AlertIcon />
                  <span>{t('hosted.connect.revokeFailed')}</span>
                </div>
              )}
              {data.items.length === 0 ? (
                <p className="hp-muted">{t('hosted.connect.appsEmpty')}</p>
              ) : (
                <ul className="hp-passkey-list">
                  {data.items.map((grant) => (
                    <GrantRow key={grant.id} grant={grant} onFailed={setFailed} />
                  ))}
                </ul>
              )}
            </>
          )}
        </QueryView>
      )}
    </Drawer>
  );
}

function GrantRow({ grant, onFailed }: { grant: Grant; onFailed: (failed: boolean) => void }) {
  const t = useT();
  const { language } = useLanguage();
  const showToast = useToast();
  const queryClient = useQueryClient();
  const ids = useId();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const revokeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

  const timeZone = browserTimezone();
  const meta = [
    t(`hosted.connect.trust.${grant.trust}`),
    t('hosted.connect.connectedOn', { date: formatInstant(grant.connectedAt, language, timeZone) }),
    grant.lastUsedAt ? t('hosted.connect.lastUsed', { date: formatInstant(grant.lastUsedAt, language, timeZone) }) : t('hosted.connect.neverUsed'),
    grant.scopes.includes('write') ? t('hosted.connect.scopeWrite') : t('hosted.connect.scopeRead'),
  ].join(' · ');

  function cancel() {
    setConfirming(false);
    requestAnimationFrame(() => revokeRef.current?.focus());
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape' && confirming) {
      event.stopPropagation();
      cancel();
    }
  }

  async function revoke() {
    setBusy(true);
    onFailed(false);
    try {
      await api.revokeOauthGrant(grant.id);
      await queryClient.invalidateQueries({ queryKey: OAUTH_GRANTS_KEY });
      showToast(t('hosted.connect.revoked', { name: grant.clientName }), { tone: 'info' });
    } catch {
      onFailed(true);
      setBusy(false);
    }
  }

  return (
    <li className="hp-passkey-row" onKeyDown={onKeyDown}>
      {confirming ? (
        <div className="hp-passkey-confirm" role="group" aria-labelledby={`${ids}-confirm`}>
          <p id={`${ids}-confirm`}>
            {t('hosted.connect.confirm', { name: grant.clientName })}
          </p>
          <div className="hp-passkey-actions">
            <Button ref={cancelRef} type="button" variant="secondary" size="sm" onClick={cancel}>
              {t('common.cancel')}
            </Button>
            <Button type="button" variant="danger" size="sm" aria-busy={busy} disabled={busy} onClick={() => void revoke()}>
              {t('hosted.connect.revoke')}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <span className="hp-passkey-text">
            <span className="hp-passkey-name" dir="auto">
              {grant.clientName}
            </span>
            <span className="hp-option-sub">{meta}</span>
          </span>
          <span className="hp-passkey-actions">
            <button ref={revokeRef} type="button" className="hp-link-button hp-danger press" aria-label={t('hosted.connect.revokeLabel', { name: grant.clientName })} onClick={() => setConfirming(true)}>
              {t('hosted.connect.revoke')}
            </button>
          </span>
        </>
      )}
    </li>
  );
}
