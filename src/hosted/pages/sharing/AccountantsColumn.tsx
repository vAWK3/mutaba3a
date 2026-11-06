import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { Badge, type BadgeVariant } from '../../../components/ui/Badge';
import { AccountantIcon } from '../../../components/icons/generated';
import { Button } from '../../../components/ui/Button';
import { useLanguage } from '../../../lib/i18n/core';
import type { AccountantGrant, AccountantGrantList, HostedProfile } from '../../api/client';
import { trackPortal } from '../../analytics/portalAnalytics';
import { InPlaceConfirm } from '../../components/InPlaceConfirm';
import { QueryView, type QueryState } from '../../components/QueryView';
import { useToast } from '../../components/Toast';
import { useRevokeAccountant } from '../../data/sharingQueries';
import { grantRow, isolate, revokeErrorOf, type GrantRow } from './sharingRules';

/**
 * MUT-561 (B1): the Accountants column. Each invite or reader with one action on its row (DESIGN.md › Rows with their
 * own actions): Stop an active one, Cancel a pending one (both confirm in place, D7), Invite again an expired one (no
 * confirm: it sends the same address a fresh invite). Stop and Cancel leave at once and come back if the server says
 * no (D11). Its own loading and error states, so a failing Links column never blanks it.
 */

const CHIP: Record<AccountantGrant['status'], BadgeVariant> = { active: 'success', pending: 'info', expired: 'neutral' };

export interface AccountantsColumnProps {
  profile: HostedProfile;
  query: QueryState & { data: AccountantGrantList | undefined };
  /** The id of the row just invited, tinted once (the saved-row cue). */
  flashId: string | null;
  writable: boolean;
  onInvite: () => void;
  onInviteAgain: (grant: AccountantGrant) => void;
  /** An Invite again in flight: its row's button is busy. */
  reinviting: string | null;
}

export function AccountantsColumn({ profile, query, flashId, writable, onInvite, onInviteAgain, reinviting }: AccountantsColumnProps) {
  const { t } = useLanguage();
  const ids = useId();
  const atLimit = query.data ? query.data.items.filter((grant) => grant.status !== 'expired').length >= query.data.limit : false;
  // Under the lapse gate Invite still opens: the drawer says why it is read-only (MUT-361). At the limit it says why here.
  const blocked = atLimit;

  return (
    <section className="hp-sharing-column" aria-labelledby={`${ids}-heading`}>
      <div className="hp-sharing-column-head">
        <h2 id={`${ids}-heading`} className="hp-sharing-heading">
          <span className="hp-sharing-icon" aria-hidden="true">
            <AccountantIcon size={20} />
          </span>
          {t('hosted.sharing.accountants.heading')}
        </h2>
        <Button variant="secondary" size="sm" aria-disabled={blocked || undefined} aria-describedby={atLimit ? `${ids}-limit` : undefined} onClick={() => !blocked && onInvite()}>
          {t('hosted.sharing.accountants.invite')}
        </Button>
      </div>
      <QueryView queries={[query]} data={query.data}>
        {(list) => (
          <>
            <ul className="hp-profile-list hp-sharing-list">
              {list.items.map((grant) => (
                <AccountantItem
                  key={grant.id}
                  grant={grant}
                  profile={profile}
                  flash={grant.id === flashId}
                  writable={writable}
                  reinviting={reinviting === grant.id}
                  atLimit={atLimit}
                  limitId={`${ids}-limit`}
                  onInviteAgain={() => onInviteAgain(grant)}
                />
              ))}
            </ul>
            <p className="hp-sharing-foot" id={`${ids}-limit`}>
              {atLimit ? t('hosted.sharing.accountants.atLimit', { limit: String(list.limit) }) : t('hosted.sharing.accountants.limit', { limit: String(list.limit) })}
            </p>
          </>
        )}
      </QueryView>
    </section>
  );
}

interface AccountantItemProps {
  grant: AccountantGrant;
  profile: HostedProfile;
  flash: boolean;
  writable: boolean;
  reinviting: boolean;
  /** At the limit an expired invite can't be sent again until one is stopped (review b); the foot says why. */
  atLimit: boolean;
  limitId: string;
  onInviteAgain: () => void;
}

function AccountantItem({ grant, profile, flash, writable, reinviting, atLimit, limitId, onInviteAgain }: AccountantItemProps) {
  const { t, language } = useLanguage();
  const showToast = useToast();
  const revoke = useRevokeAccountant(profile.id);
  const [confirming, setConfirming] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRef = useRef<HTMLLIElement>(null);
  // Review (c): the row just invited takes focus, so the drawer closing (or the empty page leaving) never drops it
  useEffect(() => {
    if (flash) itemRef.current?.focus();
  }, [flash]);
  // "viewed 2 days ago" against the clock when the row appeared; a refetch on focus brings a fresh row
  const [now] = useState(() => new Date());
  const row = grantRow(grant, now, language, profile.timezone);
  const name = row.label;

  const cancelConfirm = () => {
    setConfirming(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const runRevoke = async () => {
    const was = grant.status === 'active' ? 'active' : 'pending';
    setConfirming(false);
    try {
      await revoke.mutateAsync(grant);
    } catch (error) {
      const outcome = revokeErrorOf(error);
      if (!outcome.done) {
        showToast(t(outcome.toast));
        return;
      }
    }
    void trackPortal('accountant_revoked', { was });
    const vars = { name: isolate(name), profile: isolate(profile.name) };
    showToast(was === 'active' ? t('hosted.sharing.accountants.stopped', vars) : t('hosted.sharing.accountants.cancelled', vars), { tone: 'info' });
  };

  return (
    <li ref={itemRef} tabIndex={flash ? -1 : undefined} className={`hp-sharing-item${flash ? ' hp-sharing-item--new' : ''}`} data-status={grant.status}>
      <div className="hp-profile-row hp-sharing-row">
        <span className="hp-avatar" aria-hidden="true">
          {row.initial}
        </span>
        <span className="hp-profile-row-text">
          <span className="hp-profile-row-line">
            {/* A name is the person's own text; with no name yet, the label is the address, always left to right */}
            {row.email ? (
              <span className="hp-profile-row-name" dir="auto" title={name}>
                {name}
              </span>
            ) : (
              <span className="hp-profile-row-name" dir="ltr" title={name}>
                {name}
              </span>
            )}
            <Badge variant={CHIP[grant.status]} size="sm">
              {t(`hosted.sharing.accountants.chip.${grant.status}`)}
            </Badge>
          </span>
          {row.email && (
            <span className="hp-option-sub">
              <bdi dir="ltr">{row.email}</bdi>
            </span>
          )}
          <span className="hp-option-sub">{row.meta.map((line) => t(line.key, line.vars)).join(' · ')}</span>
        </span>
        {/* Under the lapse gate taking access back still works; only a new invite waits (plan › failure modes) */}
        {(writable || row.action !== 'inviteAgain') && !confirming && <RowAction row={row} name={name} triggerRef={triggerRef} busy={reinviting} blockedBy={atLimit ? limitId : null} onAsk={() => setConfirming(true)} onInviteAgain={onInviteAgain} />}
      </div>
      {confirming && (
        <InPlaceConfirm
          appearance="row"
          message={row.action === 'stop' ? t('hosted.sharing.accountants.stopConfirm', { name: isolate(name), profile: isolate(profile.name) }) : t('hosted.sharing.accountants.cancelConfirm', { name: isolate(name) })}
          cancelLabel={row.action === 'stop' ? t('common.cancel') : t('hosted.sharing.accountants.keep')}
          confirmLabel={row.action === 'stop' ? t('hosted.sharing.accountants.stopAction') : t('hosted.sharing.accountants.cancelAction')}
          onCancel={cancelConfirm}
          onConfirm={() => void runRevoke()}
        />
      )}
    </li>
  );
}

interface RowActionProps {
  row: GrantRow;
  name: string;
  triggerRef: RefObject<HTMLButtonElement | null>;
  busy: boolean;
  /** The id of what says why Invite again does nothing (the limit foot), or null when it can. */
  blockedBy: string | null;
  onAsk: () => void;
  onInviteAgain: () => void;
}

function RowAction({ row, name, triggerRef, busy, blockedBy, onAsk, onInviteAgain }: RowActionProps) {
  const { t } = useLanguage();
  if (row.action === 'inviteAgain') {
    return (
      <button
        type="button"
        className="hp-link-button press hp-sharing-action"
        aria-label={t('hosted.sharing.accountants.inviteAgainAria', { name })}
        aria-busy={busy || undefined}
        aria-disabled={blockedBy ? true : undefined}
        aria-describedby={blockedBy ?? undefined}
        onClick={() => !busy && !blockedBy && onInviteAgain()}
      >
        {t('hosted.sharing.accountants.inviteAgain')}
      </button>
    );
  }
  const stop = row.action === 'stop';
  return (
    <button
      type="button"
      ref={triggerRef}
      className="hp-link-button hp-danger press hp-sharing-action"
      aria-label={stop ? t('hosted.sharing.accountants.stopAria', { name }) : t('hosted.sharing.accountants.cancelAria', { name })}
      onClick={onAsk}
    >
      {stop ? t('hosted.sharing.accountants.stop') : t('hosted.sharing.accountants.cancel')}
    </button>
  );
}
