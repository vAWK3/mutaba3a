import { useId, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '../../../components/ui/Button';
import { useLanguage, useT } from '../../../lib/i18n/core';
import type { Language } from '../../../lib/i18n/types';
import { api, ApiError, apiErrorReason, type EntitlementGrant, type OperatorAccount } from '../../api/client';
import { Drawer } from '../../components/Drawer';
import { AlertIcon } from '../../components/Icons';
import { RadioCards } from '../../components/RadioCards';
import { useToast } from '../../components/Toast';
import { RowButton, RowGroup } from '../../components/YouRows';
import { ME_KEY } from '../../session/me';
import { refreshOperatorBilling, useOperatorBillingGrants } from '../../data/operatorQueries';
import { GRANT_PRESET_DAYS, grantExpiryOf, grantStateOf, isFutureDay, presetDay } from '../../operator/grants';
import { OperatorConfirm, StepUpFailureBanner, useOperatorRun } from '../../operator/OperatorStepUp';
import { isolated } from '../../operator/text';
import { dayText } from '../../operator/time';

/**
 * MUT-462 (design 5A, 14A): the account's billing grants, newest first, each with where it stands; an active one revokes
 * with the in-row danger confirm. "Grant coverage" opens the drawer (`?grant=new`): tier, a reason, and an expiry with
 * 30 / 90 day and no-end presets. A grant covers the profiles the person created, as `billing:grant` does. Every write
 * goes through the operator step-up; the operator's own account shows the rows inert (E10).
 */
type Tier = EntitlementGrant['tier'];

const TIERS: readonly Tier[] = ['FREELANCER', 'FIRM'];

interface BillingSectionProps {
  account: OperatorAccount;
  /** The account view's step-up window: the drawer may open (from the address) before the grants have loaded. */
  stepUpUntil: string | null;
  own: boolean;
  grantOpen: boolean;
  onGrantOpen: (open: boolean) => void;
}

export function OperatorBillingSection({ account, stepUpUntil: viewStepUpUntil, own, grantOpen, onGrantOpen }: BillingSectionProps) {
  const t = useT();
  const { language } = useLanguage();
  const grants = useOperatorBillingGrants(account.id);
  const [revoking, setRevoking] = useState<string | null>(null);
  const openerRef = useRef<HTMLDivElement>(null);
  const now = new Date();
  const list = grants.data?.grants ?? [];
  const stepUpUntil = grants.data?.stepUpUntil ?? viewStepUpUntil;

  function closeDrawer() {
    onGrantOpen(false);
    requestAnimationFrame(() => openerRef.current?.querySelector<HTMLElement>('button')?.focus());
  }

  return (
    <RowGroup label={t('hosted.operator.billing.title')}>
      {grants.isError && <p className="hp-you-row hp-you-row--note">{t('hosted.operator.failed')}</p>}
      {grants.isSuccess && list.length === 0 && <p className="hp-you-row hp-you-row--note">{t('hosted.operator.billing.none')}</p>}
      {list.map((grant) =>
        revoking === grant.id ? (
          <div key={grant.id} className="hp-operator-confirm">
            <RevokeConfirm account={account} grant={grant} stepUpUntil={stepUpUntil} onDone={() => setRevoking(null)} />
          </div>
        ) : (
          <div key={grant.id} className="hp-you-row hp-operator-grant" data-grant-row={grant.id}>
            <span className="hp-you-row-text">
              <span className="hp-you-row-label">
                {t(`hosted.operator.billing.tier.${grant.tier}`)} · <bdi dir="auto">{grant.reason}</bdi>
              </span>
              <small>{grantLine(grant, now, language, t)}</small>
            </span>
            {grantStateOf(grant, now) === 'active' && !own && (
              <button type="button" className="hp-link-button hp-danger press" onClick={() => setRevoking(grant.id)}>
                {t('hosted.operator.billing.revoke')}
              </button>
            )}
          </div>
        ),
      )}
      <div ref={openerRef}>
        <RowButton label={t('hosted.operator.billing.grant')} sub={own ? t('hosted.operator.accounts.own') : t('hosted.operator.billing.grantSub')} inert={own} onClick={() => onGrantOpen(true)} />
      </div>
      {grantOpen && !own && <GrantDrawer account={account} stepUpUntil={stepUpUntil} onClose={closeDrawer} />}
    </RowGroup>
  );
}

function grantLine(grant: EntitlementGrant, now: Date, language: Language, t: ReturnType<typeof useT>): string {
  const state = grantStateOf(grant, now);
  if (state === 'revoked') return t('hosted.operator.billing.revokedOn', { date: dayText(grant.revokedAt!, language) });
  if (state === 'ended') return t('hosted.operator.billing.endedOn', { date: dayText(grant.expiresAt!, language) });
  return grant.expiresAt ? t('hosted.operator.billing.until', { date: dayText(grant.expiresAt, language) }) : t('hosted.operator.billing.noEnd');
}

function RevokeConfirm({ account, grant, stepUpUntil, onDone }: { account: OperatorAccount; grant: EntitlementGrant; stepUpUntil: string | null; onDone: () => void }) {
  const t = useT();
  const showToast = useToast();
  const queryClient = useQueryClient();
  const run = useOperatorRun(stepUpUntil);

  async function revoke() {
    try {
      const result = await run.run(() => api.revokeOperatorBillingGrant(account.id, grant.id));
      if (!result) return;
      refreshOperatorBilling(queryClient, account.id);
      showToast(t('hosted.operator.billing.revoked', { email: isolated(account.email) }), { tone: 'info' });
      onDone();
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        // The grant (or the operator mark) is gone: read both again; the page follows.
        void queryClient.invalidateQueries({ queryKey: ME_KEY });
        refreshOperatorBilling(queryClient, account.id);
        onDone();
      } else run.setFailure('failed');
    }
  }

  return (
    <OperatorConfirm
      text={t('hosted.operator.billing.confirmRevoke', { email: isolated(account.email), tier: t(`hosted.operator.billing.tier.${grant.tier}`) })}
      labels={{ plain: t('hosted.operator.billing.revoke'), passkey: t('hosted.operator.billing.revokeWithPasskey') }}
      variant="danger"
      run={run}
      onConfirm={() => void revoke()}
      onCancel={() => {
        run.clear();
        onDone();
      }}
    />
  );
}

/** 14A: tier, reason (required) and expiry. The drawer is the confirm: its Grant button runs the step-up when stale. */
function GrantDrawer({ account, stepUpUntil, onClose }: { account: OperatorAccount; stepUpUntil: string | null; onClose: () => void }) {
  const t = useT();
  const showToast = useToast();
  const queryClient = useQueryClient();
  const run = useOperatorRun(stepUpUntil);
  const formId = useId();
  const tierLabel = useId();
  const [tier, setTier] = useState<Tier>('FREELANCER');
  const [reason, setReason] = useState('');
  const [day, setDay] = useState(() => presetDay(GRANT_PRESET_DAYS[0], new Date()));
  const [errors, setErrors] = useState<{ reason?: string; day?: string }>({});
  const [refusal, setRefusal] = useState<string | null>(null);

  function validate(): { expiresAt: string | undefined } | null {
    const next: typeof errors = {};
    if (reason.trim() === '') next.reason = t('hosted.operator.billing.reasonRequired');
    const expiresAt = grantExpiryOf(day);
    if (expiresAt === null || (day !== '' && !isFutureDay(day, new Date()))) next.day = t('hosted.operator.billing.dayInvalid');
    setErrors(next);
    return Object.keys(next).length > 0 || expiresAt === null ? null : { expiresAt };
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (run.busy) return;
    setRefusal(null);
    const valid = validate();
    if (!valid) return;
    try {
      const grant = await run.run(() => api.createOperatorBillingGrant(account.id, { tier, reason: reason.trim(), ...(valid.expiresAt ? { expiresAt: valid.expiresAt } : {}) }));
      if (!grant) return;
      refreshOperatorBilling(queryClient, account.id);
      showToast(t('hosted.operator.billing.granted', { email: isolated(account.email) }), { tone: 'info' });
      onClose();
    } catch (error) {
      const reasonCode = error instanceof ApiError ? apiErrorReason(error) : undefined;
      if (reasonCode === 'OWN_ACCOUNT') setRefusal(t('hosted.operator.accounts.ownRefused'));
      else if (error instanceof ApiError && error.code === 'VALIDATION_FAILED') setErrors({ day: t('hosted.operator.billing.dayInvalid') });
      else run.setFailure('failed');
    }
  }

  const submitLabel = run.label === 'confirm' ? t('hosted.operator.stepUp.confirmWithPasskey') : run.label === 'passkey' ? t('hosted.operator.billing.grantWithPasskey') : t('hosted.operator.billing.grantAction');
  return (
    <Drawer
      title={t('hosted.operator.billing.drawerTitle')}
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        <div className="drawer-footer-right">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form={formId} isLoading={run.busy} keepLabelWhileLoading>
            {submitLabel}
          </Button>
        </div>
      }
    >
      <form id={formId} onSubmit={(event) => void submit(event)} noValidate>
        <p className="hp-settle-context">
          {t('hosted.operator.billing.drawerFor')} <bdi dir="ltr">{account.email}</bdi>
        </p>
        <div className="form-group">
          <span className="form-label" id={tierLabel}>
            {t('hosted.operator.billing.tierLabel')}
          </span>
          <RadioCards
            name={`${formId}-tier`}
            labelledBy={tierLabel}
            value={tier}
            onChange={setTier}
            options={TIERS.map((value) => ({ value, label: t(`hosted.operator.billing.tier.${value}`), note: t(`hosted.operator.billing.tierNote.${value}`) }))}
          />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor={`${formId}-reason`}>
            {t('hosted.operator.billing.reason')}
          </label>
          <input
            id={`${formId}-reason`}
            className="input"
            dir="auto"
            maxLength={200}
            value={reason}
            aria-invalid={Boolean(errors.reason)}
            aria-describedby={`${formId}-reason-hint`}
            onChange={(event) => {
              setReason(event.target.value);
              setErrors((e) => ({ ...e, reason: undefined }));
            }}
          />
          <p className="form-hint" id={`${formId}-reason-hint`}>
            {t('hosted.operator.billing.reasonHint')}
          </p>
          {errors.reason && <p className="form-error">{errors.reason}</p>}
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor={`${formId}-day`}>
            {t('hosted.operator.billing.ends')}
          </label>
          <span className="hp-passkey-actions hp-operator-presets">
            {GRANT_PRESET_DAYS.map((days) => (
              <Button key={days} type="button" variant="secondary" size="sm" aria-pressed={day === presetDay(days, new Date())} onClick={() => setDay(presetDay(days, new Date()))}>
                {t('hosted.operator.billing.presetDays', { count: days })}
              </Button>
            ))}
            <Button type="button" variant="secondary" size="sm" aria-pressed={day === ''} onClick={() => setDay('')}>
              {t('hosted.operator.billing.noEnd')}
            </Button>
          </span>
          <input
            id={`${formId}-day`}
            type="date"
            className="input"
            value={day}
            aria-invalid={Boolean(errors.day)}
            onChange={(event) => {
              setDay(event.target.value);
              setErrors((e) => ({ ...e, day: undefined }));
            }}
          />
          {day === '' && <p className="form-hint">{t('hosted.operator.billing.noEndHint')}</p>}
          {errors.day && <p className="form-error">{errors.day}</p>}
        </div>
        {run.failure && <StepUpFailureBanner failure={run.failure} />}
        {refusal && (
          <div className="hp-banner hp-banner-error" role="alert">
            <AlertIcon />
            <span>{refusal}</span>
          </div>
        )}
      </form>
    </Drawer>
  );
}

