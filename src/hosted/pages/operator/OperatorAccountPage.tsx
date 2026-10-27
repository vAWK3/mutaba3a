import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Switch } from '../../../components/ui/Switch';
import { useLanguage, useT } from '../../../lib/i18n/core';
import { useTp } from '../../../lib/i18n/plural';
import { api, ApiError, apiErrorReason, type IssueSetupLinkResponse, type OperatorAccount } from '../../api/client';
import { CopyField } from '../../components/CopyField';
import { AlertIcon, InfoIcon } from '../../components/Icons';
import { Empty, QueryView, Skeleton } from '../../components/QueryView';
import { useToast } from '../../components/Toast';
import { RowButton, RowGroup } from '../../components/YouRows';
import { operatorAccountKey, patchOperatorAccount, useOperatorAccount } from '../../data/operatorQueries';
import { OperatorConfirm, useOperatorRun } from '../../operator/OperatorStepUp';
import { agoText, dayText, instantText } from '../../operator/time';
import { ME_KEY, useMe } from '../../session/me';
import { AccountStatusBadge } from './AccountStatusBadge';

/**
 * MUT-461 (design 3A, 4A, 5A, 12A): one account, as the operator sees it before acting. The header says who and how
 * they stand; a banner says why an action is missing (disabled, waiting for review, closing); the Access group holds
 * the actions, each with what it would end; then the profiles with their billing.
 *
 * Every action confirms in its row and goes through the operator step-up (OperatorStepUp.tsx). The reset link lives
 * only in this page's state: shown once, never in a toast, the URL or a query, and gone when the page is left (12A).
 * The operator's own account shows the rows inert with the reason (E10); the server refuses them regardless.
 */
type Action = 'signOut' | 'disable' | 'enable' | 'reset';

/** 12A: the portal's reset links work for 24 hours (the CLI's default is 72). */
const RESET_LINK_HOURS = 24;
const SKELETON_ROWS = 4;

export function OperatorAccountPage({ userId }: { userId: string }) {
  const t = useT();
  const query = useOperatorAccount(userId);
  return (
    <QueryView
      queries={[query]}
      data={query.data}
      loading={<Skeleton rows={SKELETON_ROWS} />}
      notFound={<Empty title={t('hosted.operator.accounts.notFoundTitle')} body={t('hosted.operator.accounts.notFoundBody')} />}
    >
      {(view) => <AccountDetail account={view.account} stepUpUntil={view.stepUpUntil} />}
    </QueryView>
  );
}

function AccountDetail({ account, stepUpUntil }: { account: OperatorAccount; stepUpUntil: string | null }) {
  const t = useT();
  const { language } = useLanguage();
  const own = useMe().user.id === account.id;
  return (
    <div className="hp-operator-account">
      <header className="hp-operator-account-header">
        <h2 className="hp-operator-email" dir="ltr">
          {account.email}
        </h2>
        <span className="hp-operator-chips">
          <AccountStatusBadge status={account.status} closing={account.closing} />
          {account.operator && (
            <Badge variant="accent" size="sm">
              {t('hosted.operator.accounts.operatorBadge')}
            </Badge>
          )}
        </span>
        <p className="hp-option-sub">
          <bdi dir="auto">{account.displayName}</bdi> ·{' '}
          {account.lastSignInAt ? t('hosted.operator.accounts.lastSignIn', { time: agoText(account.lastSignInAt, new Date(), language) }) : t('hosted.operator.accounts.neverSignedIn')} ·{' '}
          {t(account.passkeyCount > 0 ? 'hosted.operator.accounts.passkeyYes' : 'hosted.operator.accounts.passkeyNo')}
        </p>
      </header>
      <StatusBanner account={account} />
      <AccessGroup account={account} stepUpUntil={stepUpUntil} own={own} />
      <ProfilesGroup account={account} />
    </div>
  );
}

/** 5A: why an action is missing. */
function StatusBanner({ account }: { account: OperatorAccount }) {
  const t = useT();
  if (account.closing) return <Banner tone="warning" text={t('hosted.operator.accounts.closingBanner')} />;
  if (account.status === 'DISABLED') return <Banner tone="warning" text={t('hosted.operator.accounts.disabledBanner')} />;
  if (account.status !== 'PENDING_REVIEW') return null;
  return (
    <Banner
      tone="info"
      text={
        <>
          {t('hosted.operator.accounts.pendingBanner')} <Link to="/operator/signups">{t('hosted.operator.accounts.pendingLink')}</Link>
        </>
      }
    />
  );
}

function Banner({ tone, text, alert = false }: { tone: 'info' | 'warning' | 'error'; text: ReactNode; alert?: boolean }) {
  return (
    <div className={`hp-banner hp-banner-${tone}`} role={alert ? 'alert' : 'status'}>
      {tone === 'info' ? <InfoIcon /> : <AlertIcon />}
      <span>{text}</span>
    </div>
  );
}

/** Which actions an account offers: a disabled one only Enable; a waiting signup no status change (Signups decides it). */
function actionsFor(account: OperatorAccount): Action[] {
  if (account.status === 'DISABLED') return ['enable'];
  if (account.status === 'PENDING_REVIEW') return ['signOut', 'reset'];
  return ['signOut', 'disable', 'reset'];
}

/** 4A: the Access group. One confirm open at a time, in the row it replaces; Cancel gives focus back to that row. */
function AccessGroup({ account, stepUpUntil, own }: { account: OperatorAccount; stepUpUntil: string | null; own: boolean }) {
  const t = useT();
  const tp = useTp();
  const showToast = useToast();
  const queryClient = useQueryClient();
  const run = useOperatorRun(stepUpUntil);
  const [open, setOpen] = useState<Action | null>(null);
  const [lock, setLock] = useState(true);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [link, setLink] = useState<IssueSetupLinkResponse | null>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const devices = (count: number) => tp('hosted.operator.accounts.devices', count);
  const agents = (count: number) => tp('hosted.operator.accounts.agents', count);
  const email = account.email;

  function focusRow(action: Action) {
    requestAnimationFrame(() => groupRef.current?.querySelector<HTMLElement>(`[data-access-row="${action}"] button`)?.focus());
  }

  function close(action: Action) {
    setOpen(null);
    setRefusal(null);
    run.clear();
    focusRow(action);
  }

  function ask(action: Action) {
    setLock(true);
    setRefusal(null);
    run.clear();
    setOpen(action);
  }

  /** What the server said no to, in words; a 404 means the account (or the operator mark) is gone. */
  function refused(error: unknown) {
    if (error instanceof ApiError && error.status === 404) {
      void queryClient.invalidateQueries({ queryKey: ME_KEY });
      void queryClient.invalidateQueries({ queryKey: operatorAccountKey(account.id) });
      return;
    }
    const reason = error instanceof ApiError ? apiErrorReason(error) : undefined;
    if (reason === 'USER_PENDING_REVIEW') setRefusal(t('hosted.operator.accounts.pendingRefused'));
    else if (reason === 'USER_DISABLED') setRefusal(t('hosted.operator.accounts.disabledRefused'));
    else if (reason === 'OWN_ACCOUNT') setRefusal(t('hosted.operator.accounts.ownRefused'));
    else run.setFailure('failed');
  }

  async function act(action: Action) {
    setRefusal(null);
    try {
      if (action === 'signOut') {
        const result = await run.run(() => api.revokeOperatorAccountSessions(account.id));
        if (!result) return;
        patchOperatorAccount(queryClient, account.id, { activeSessionCount: 0, agentGrantCount: 0 });
        showToast(t('hosted.operator.accounts.signedOut', { email: isolated(email), devices: devices(result.revoked) }), { tone: 'info' });
      } else if (action === 'disable' || action === 'enable') {
        const result = await run.run(() => api.setOperatorAccountStatus(account.id, action));
        if (!result) return;
        patchOperatorAccount(queryClient, account.id, { status: result.user.status, ...(action === 'disable' ? { activeSessionCount: 0, agentGrantCount: 0 } : {}) });
        showToast(
          action === 'disable' ? t('hosted.operator.accounts.disabled', { email: isolated(email), devices: devices(result.sessionsRevoked) }) : t('hosted.operator.accounts.enabled', { email: isolated(email) }),
          { tone: 'info' },
        );
        // The row it was on is gone (Disable became Enable): focus the group's first row.
        setOpen(null);
        requestAnimationFrame(() => groupRef.current?.querySelector<HTMLElement>('[data-access-row] button')?.focus());
        return;
      } else {
        const result = await run.run(() => api.issueOperatorSetupLink(account.id, { lock, validHours: RESET_LINK_HOURS }));
        if (!result) return;
        // 12A: the link stays in this component's state only.
        setLink(result);
        if (result.lock) patchOperatorAccount(queryClient, account.id, { activeSessionCount: 0 });
      }
      setOpen(null);
      focusRow(action);
    } catch (error) {
      refused(error);
    }
  }

  const rows: Record<Action, { label: string; sub: string; tone?: 'danger' }> = {
    signOut: { label: t('hosted.operator.accounts.signOut'), sub: t('hosted.operator.accounts.signOutSub', { devices: devices(account.activeSessionCount) }) },
    disable: {
      label: t('hosted.operator.accounts.disable'),
      sub: t('hosted.operator.accounts.disableSub', { devices: devices(account.activeSessionCount), agents: agents(account.agentGrantCount) }),
      tone: 'danger',
    },
    enable: { label: t('hosted.operator.accounts.enable'), sub: t('hosted.operator.accounts.enableSub') },
    reset: { label: t('hosted.operator.accounts.reset'), sub: t('hosted.operator.accounts.resetSub') },
  };

  return (
    <div ref={groupRef}>
      <RowGroup label={t('hosted.operator.accounts.access')}>
        {actionsFor(account).map((action) =>
          open === action ? (
            <div key={action} className="hp-operator-confirm">
              <ActionConfirm action={action} account={account} run={run} lock={lock} onLock={setLock} refusal={refusal} onConfirm={() => void act(action)} onCancel={() => close(action)} />
            </div>
          ) : action === 'reset' && link ? (
            <ResetLink key={action} email={email} link={link} onDone={() => setLink(null)} />
          ) : (
            <div key={action} data-access-row={action}>
              <RowButton label={rows[action].label} sub={own ? t('hosted.operator.accounts.own') : rows[action].sub} inert={own} tone={rows[action].tone} onClick={() => ask(action)} />
            </div>
          ),
        )}
      </RowGroup>
    </div>
  );
}

function ActionConfirm({
  action,
  account,
  run,
  lock,
  onLock,
  refusal,
  onConfirm,
  onCancel,
}: {
  action: Action;
  account: OperatorAccount;
  run: ReturnType<typeof useOperatorRun>;
  lock: boolean;
  onLock: (lock: boolean) => void;
  refusal: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const tp = useTp();
  const vars = { devices: tp('hosted.operator.accounts.devices', account.activeSessionCount), agents: tp('hosted.operator.accounts.agents', account.agentGrantCount) };
  const text = {
    signOut: 'hosted.operator.accounts.confirmSignOut',
    disable: 'hosted.operator.accounts.confirmDisable',
    enable: 'hosted.operator.accounts.confirmEnable',
    reset: 'hosted.operator.accounts.confirmReset',
  }[action];
  const labels = {
    signOut: ['signOutAction', 'signOutWithPasskey'],
    disable: ['disableAction', 'disableWithPasskey'],
    enable: ['enableAction', 'enableWithPasskey'],
    reset: ['resetAction', 'resetWithPasskey'],
  }[action];
  const lockId = useId();
  return (
    <OperatorConfirm
      text={t(text, { ...vars, email: isolated(account.email) })}
      labels={{ plain: t(`hosted.operator.accounts.${labels[0]}`), passkey: t(`hosted.operator.accounts.${labels[1]}`) }}
      variant={action === 'disable' || action === 'signOut' ? 'danger' : 'primary'}
      run={run}
      error={
        <>
          {action === 'reset' && (
            <div className="hp-operator-lock">
              <span>
                <span id={lockId}>{t('hosted.operator.accounts.lock')}</span>
                <small>{t('hosted.operator.accounts.lockHint')}</small>
              </span>
              <Switch checked={lock} onChange={onLock} labelledBy={lockId} disabled={run.busy} />
            </div>
          )}
          {refusal && <Banner tone="error" text={refusal} alert />}
        </>
      }
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}

/** The address isolated in the sentence (FSI … PDI), so it reads left to right and never reorders an Arabic line. */
const isolated = (email: string) => `\u2068${email}\u2069`;

/** 12A: the reset link, once. Copy or share it, then Done; leaving the page discards it. */
function ResetLink({ email, link, onDone }: { email: string; link: IssueSetupLinkResponse; onDone: () => void }) {
  const t = useT();
  const { language } = useLanguage();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  return (
    <div className="hp-operator-confirm hp-operator-link" ref={ref} tabIndex={-1}>
      <Banner tone="info" text={t('hosted.operator.accounts.linkOnce')} />
      {link.lock && <p className="hp-muted">{t('hosted.operator.accounts.linkLocked')}</p>}
      <CopyField label={t('hosted.operator.accounts.linkLabel', { email })} value={link.setupLink.url} />
      <p className="hp-option-sub">{t('hosted.operator.accounts.linkValid', { time: instantText(link.setupLink.expiresAt, language) })}</p>
      <span className="hp-passkey-actions">
        <Button type="button" variant="secondary" size="sm" onClick={onDone}>
          {t('hosted.operator.accounts.done')}
        </Button>
        {canShare && (
          <Button type="button" size="sm" onClick={() => void navigator.share({ url: link.setupLink.url }).catch(() => undefined)}>
            {t('hosted.operator.accounts.share')}
          </Button>
        )}
      </span>
    </div>
  );
}

/** Each profile the person belongs to, with their role, firm state and billing as /v1/me reports it. */
function ProfilesGroup({ account }: { account: OperatorAccount }) {
  const t = useT();
  const { language } = useLanguage();
  return (
    <RowGroup label={t('hosted.operator.accounts.profiles')}>
      {account.profiles.length === 0 && <p className="hp-you-row hp-you-row--note">{t('hosted.operator.accounts.noProfiles')}</p>}
      {account.profiles.map((profile) => (
        <div key={profile.id} className="hp-you-row hp-operator-profile">
          <span className="hp-you-row-text">
            <span className="hp-you-row-label" dir="auto">
              {profile.name}
            </span>
            <small>
              {t(`hosted.operator.accounts.role.${profile.role}`)}
              {profile.billing && (
                <>
                  {' · '}
                  {t(`hosted.operator.accounts.billingSource.${profile.billing.source}`)} · {t(`hosted.operator.accounts.billingState.${profile.billing.state}`)}
                  {profile.billing.until && <> {t('hosted.operator.accounts.billingUntil', { date: dayText(profile.billing.until, language) })}</>}
                </>
              )}
            </small>
          </span>
          <span className="hp-operator-chips">
            {profile.personal && (
              <Badge variant="neutral" size="sm">
                {t('hosted.operator.accounts.personal')}
              </Badge>
            )}
            {profile.firmEnabledAt && (
              <Badge variant="info" size="sm">
                {t('hosted.operator.accounts.firm')}
              </Badge>
            )}
            {profile.firmRequestedAt && (
              <Badge variant="warning" size="sm">
                {t('hosted.operator.accounts.firmRequested')}
              </Badge>
            )}
          </span>
        </div>
      ))}
    </RowGroup>
  );
}
