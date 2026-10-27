import { useEffect, useRef, useState, type RefObject } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Badge } from '../../../components/ui/Badge';
import { useLanguage, useT } from '../../../lib/i18n/core';
import { api, ApiError, apiErrorReason, type FirmRequest, type OperatorFirmRequestDetail } from '../../api/client';
import { AlertIcon } from '../../components/Icons';
import { Empty, QueryView, Skeleton } from '../../components/QueryView';
import { useToast } from '../../components/Toast';
import { dropFirmRequest, useOperatorFirmRequest, useOperatorFirmRequests } from '../../data/operatorQueries';
import { OperatorConfirm, useOperatorRun } from '../../operator/OperatorStepUp';
import { isolated } from '../../operator/text';
import { agoText } from '../../operator/time';
import { ME_KEY } from '../../session/me';

/**
 * MUT-462 (design 16A, 8A): the pending requests for firm features, oldest first. Enable opens the owners in the row: a
 * person's own Business profile keeps its owners (enabled in place, MUT-300 D4); an operator firm names them from its
 * members, the requester ticked to start, a disabled or waiting member inert with the reason. Decline confirms in the
 * row. A decided request leaves the list with a toast, and focus moves to the next row (or the heading). Every write
 * goes through the operator step-up.
 */
type Mode = 'view' | 'enable' | 'decline';

const SKELETON_ROWS = 2;

export function OperatorFirmsPage({ headingRef }: { headingRef: RefObject<HTMLHeadingElement | null> }) {
  const t = useT();
  const showToast = useToast();
  const queryClient = useQueryClient();
  const query = useOperatorFirmRequests();
  const listRef = useRef<HTMLUListElement>(null);

  function focusRowAt(index: number) {
    requestAnimationFrame(() => {
      const rows = listRef.current?.querySelectorAll<HTMLElement>('[data-firm-row]') ?? [];
      (rows[Math.min(index, rows.length - 1)] ?? headingRef.current)?.focus();
    });
  }

  function decided(request: FirmRequest, index: number, message: string) {
    dropFirmRequest(queryClient, request.organizationId);
    showToast(message, { tone: 'info' });
    focusRowAt(index);
  }

  return (
    <QueryView
      queries={[query]}
      data={query.data}
      isEmpty={(list) => list.data.length === 0}
      loading={<Skeleton rows={SKELETON_ROWS} />}
      empty={<Empty title={t('hosted.operator.firms.emptyTitle')} body={t('hosted.operator.firms.emptyBody')} />}
    >
      {(list) => (
        <ul ref={listRef} className="hp-passkey-list hp-operator-list" aria-label={t('hosted.operator.firms.listLabel')}>
          {list.data.map((request, index) => (
            <FirmRow
              key={request.organizationId}
              request={request}
              stepUpUntil={list.stepUpUntil}
              onDecided={(message) => decided(request, index, message)}
              onGone={() => {
                void queryClient.invalidateQueries({ queryKey: ME_KEY });
                dropFirmRequest(queryClient, request.organizationId);
                focusRowAt(index);
              }}
            />
          ))}
        </ul>
      )}
    </QueryView>
  );
}

function FirmRow({ request, stepUpUntil, onDecided, onGone }: { request: FirmRequest; stepUpUntil: string | null; onDecided: (message: string) => void; onGone: () => void }) {
  const t = useT();
  const [mode, setMode] = useState<Mode>('view');
  const openers = useRef<Record<Exclude<Mode, 'view'>, HTMLButtonElement | null>>({ enable: null, decline: null });

  function cancel() {
    const opener = mode;
    setMode('view');
    requestAnimationFrame(() => (opener === 'view' ? null : openers.current[opener])?.focus());
  }

  return (
    <li className="hp-passkey-row" data-firm-row tabIndex={-1} aria-label={request.name}>
      {mode === 'view' ? (
        <>
          <RequestSummary request={request} />
          <span className="hp-passkey-actions">
            <button ref={(el) => void (openers.current.enable = el)} type="button" className="hp-link-button press" onClick={() => setMode('enable')}>
              {t('hosted.operator.firms.enable')}
            </button>
            <button ref={(el) => void (openers.current.decline = el)} type="button" className="hp-link-button hp-danger press" onClick={() => setMode('decline')}>
              {t('hosted.operator.firms.decline')}
            </button>
          </span>
        </>
      ) : mode === 'enable' ? (
        <EnableConfirm request={request} stepUpUntil={stepUpUntil} onDecided={onDecided} onGone={onGone} onCancel={cancel} />
      ) : (
        <DeclineConfirm request={request} stepUpUntil={stepUpUntil} onDecided={onDecided} onGone={onGone} onCancel={cancel} />
      )}
    </li>
  );
}

/** Which profile, who asked and how long ago, and whether it is a person's own profile or an operator firm. */
function RequestSummary({ request }: { request: FirmRequest }) {
  const t = useT();
  const { language } = useLanguage();
  return (
    <span className="hp-passkey-text">
      <span className="hp-passkey-name" dir="auto">
        {request.name}
      </span>
      <span className="hp-passkey-meta">
        {t('hosted.operator.firms.requestedBy')} <bdi dir="ltr">{request.requestedByEmail ?? '—'}</bdi> · {agoText(request.requestedAt, new Date(), language)}
      </span>
      <span className="hp-operator-chips">
        <Badge variant="neutral" size="sm">
          {t(request.owned ? 'hosted.operator.firms.owned' : 'hosted.operator.firms.operatorFirm')}
        </Badge>
      </span>
    </span>
  );
}

interface DecideProps {
  request: FirmRequest;
  stepUpUntil: string | null;
  onDecided: (message: string) => void;
  onGone: () => void;
  onCancel: () => void;
}

/** What the server said no to, in words. A 404 is a request decided elsewhere (or the operator mark gone). */
function useRefusal(onGone: () => void) {
  const t = useT();
  const [refusal, setRefusal] = useState<string | null>(null);
  function refused(error: unknown, run: ReturnType<typeof useOperatorRun>) {
    if (error instanceof ApiError && error.status === 404) return onGone();
    const reason = error instanceof ApiError ? apiErrorReason(error) : undefined;
    if (reason === 'NOT_A_MEMBER') setRefusal(t('hosted.operator.firms.notMember'));
    else if (reason === 'NOT_BUSINESS' || reason === 'PERSONAL_PROFILE') setRefusal(t('hosted.operator.firms.notBusiness'));
    else if (error instanceof ApiError && error.code === 'VALIDATION_FAILED') setRefusal(t('hosted.operator.firms.ownersRequired'));
    else run.setFailure('failed');
  }
  return { refusal, setRefusal, refused };
}

function EnableConfirm({ request, stepUpUntil, onDecided, onGone, onCancel }: DecideProps) {
  const t = useT();
  const detail = useOperatorFirmRequest(request.organizationId);
  // A 404: the request was decided elsewhere (or the operator mark is gone). The row leaves the list.
  const gone = detail.error instanceof ApiError && detail.error.status === 404;
  useEffect(() => {
    if (gone) onGone();
  }, [gone, onGone]);
  if (gone) return null;
  if (detail.isError) {
    return (
      <div className="hp-banner hp-banner-error" role="alert">
        <AlertIcon />
        <span>{t('hosted.operator.failed')}</span>
      </div>
    );
  }
  if (!detail.data) return <Skeleton rows={1} />;
  return <OwnersConfirm request={request} detail={detail.data} stepUpUntil={stepUpUntil} onDecided={onDecided} onGone={onGone} onCancel={onCancel} />;
}

function OwnersConfirm({ request, detail, stepUpUntil, onDecided, onGone, onCancel }: DecideProps & { detail: OperatorFirmRequestDetail }) {
  const t = useT();
  const run = useOperatorRun(stepUpUntil);
  const { refusal, setRefusal, refused } = useRefusal(onGone);
  const choosable = (m: OperatorFirmRequestDetail['members'][number]) => m.status === 'ACTIVE';
  const [owners, setOwners] = useState<string[]>(() => detail.members.filter((m) => m.userId === request.requestedByUserId && choosable(m)).map((m) => m.userId));
  const fixedOwners = detail.members.filter((m) => m.role === 'OWNER');
  const named = request.owned ? fixedOwners : detail.members.filter((m) => owners.includes(m.userId));
  const ownerList = named.map((m) => isolated(m.email)).join(', ');

  async function enable() {
    setRefusal(null);
    if (!request.owned && owners.length === 0) return setRefusal(t('hosted.operator.firms.ownersRequired'));
    try {
      const result = await run.run(() => api.decideOperatorFirmRequest(request.organizationId, { verb: 'enable', ownerUserIds: request.owned ? [] : owners }));
      if (result) onDecided(t('hosted.operator.firms.enabled', { name: isolated(request.name) }));
    } catch (error) {
      refused(error, run);
    }
  }

  return (
    <OperatorConfirm
      text={t(request.owned ? 'hosted.operator.firms.confirmEnableOwned' : 'hosted.operator.firms.confirmEnable', { name: isolated(request.name), owners: ownerList || '—' })}
      labels={{ plain: t('hosted.operator.firms.enable'), passkey: t('hosted.operator.firms.enableWithPasskey') }}
      variant="primary"
      run={run}
      error={
        <>
          {!request.owned && (
            <fieldset className="hp-operator-owners" disabled={run.busy}>
              <legend className="form-label">{t('hosted.operator.firms.ownersLabel')}</legend>
              <ul className="hp-pick-list">
                {detail.members.map((m) => (
                  <li key={m.userId}>
                    <label className="hp-pick">
                      <input
                        type="checkbox"
                        checked={owners.includes(m.userId)}
                        disabled={!choosable(m)}
                        onChange={(event) => setOwners((now) => (event.target.checked ? [...now, m.userId] : now.filter((id) => id !== m.userId)))}
                      />
                      <span className="hp-pick-text">
                        <span dir="ltr">{m.email}</span>
                        <br />
                        <small>{choosable(m) ? <bdi dir="auto">{m.displayName}</bdi> : t(`hosted.operator.firms.memberStatus.${m.status}`)}</small>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}
          {refusal && (
            <div className="hp-banner hp-banner-error" role="alert">
              <AlertIcon />
              <span>{refusal}</span>
            </div>
          )}
        </>
      }
      onConfirm={() => void enable()}
      onCancel={() => {
        run.clear();
        onCancel();
      }}
    />
  );
}

function DeclineConfirm({ request, stepUpUntil, onDecided, onGone, onCancel }: DecideProps) {
  const t = useT();
  const run = useOperatorRun(stepUpUntil);
  const { refusal, setRefusal, refused } = useRefusal(onGone);

  async function decline() {
    setRefusal(null);
    try {
      const result = await run.run(() => api.decideOperatorFirmRequest(request.organizationId, { verb: 'decline' }));
      if (result) onDecided(t('hosted.operator.firms.declined', { name: isolated(request.name) }));
    } catch (error) {
      refused(error, run);
    }
  }

  return (
    <OperatorConfirm
      text={t('hosted.operator.firms.confirmDecline', { name: isolated(request.name) })}
      labels={{ plain: t('hosted.operator.firms.decline'), passkey: t('hosted.operator.firms.declineWithPasskey') }}
      variant="danger"
      run={run}
      error={
        refusal && (
          <div className="hp-banner hp-banner-error" role="alert">
            <AlertIcon />
            <span>{refusal}</span>
          </div>
        )
      }
      onConfirm={() => void decline()}
      onCancel={() => {
        run.clear();
        onCancel();
      }}
    />
  );
}
