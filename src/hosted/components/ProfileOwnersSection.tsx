import { useEffect, useId, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '../../components/ui/Button';
import { useT } from '../../lib/i18n/core';
import type { HostedProfile, Me, ProfileOwner } from '../api/client';
import { ownerActions, ownerLabel, ownersSectionVisible } from '../data/profileRules';
import { useRemoveProfileOwner, withOwnerRemoved } from '../data/profileQueries';
import { ME_KEY, useMe } from '../session/me';
import { useIsLocalMode } from '../session/mode';
import { mailtoFor } from '../data/partnerMail';
import { SUPPORT_EMAIL } from '../terms';
import { ProfileBanner } from './ProfileBanner';
import { mapOwnerError, type ProfileBanner as Banner } from './profileApiErrors';
import { useToast } from './Toast';

/**
 * MUT-373 (ADR-163): who owns a Business profile, in its edit pane between the form and firm features (design
 * review DR1). The creator removes a co-owner from that person's row; a co-owner leaves from the foot of the section
 * (AD1). Both confirm in place, under what they act on, with the person or profile named in full (AD2, AD3). It
 * reads the profile from `/v1/me`, like FirmRequestSection, so an owner removed elsewhere drops out at the next read.
 * Hidden signed out (one person owns everything on this device).
 */

type Confirm = { kind: 'remove'; owner: ProfileOwner } | { kind: 'leave' } | null;

/** A removed row collapses, then the cache forgets it (DR6). The transition's end, or this, whichever is first. */
const EXIT_FALLBACK_MS = 400;

export interface ProfileOwnersSectionProps {
  profileId: string;
  /** The leave succeeded: the drawer closes and, if this profile was open, the portal moves to the personal profile (DR4). */
  onLeft: (profile: HostedProfile) => void;
  /** A leave or removal is in flight: the drawer must not close under it (DR5). */
  onBusyChange: (busy: boolean) => void;
  /** The leave confirm is open: the form's footer steps aside so nothing is half-saved (DR4). */
  onLeaveConfirmChange: (open: boolean) => void;
}

export function ProfileOwnersSection({ profileId, onLeft, onBusyChange, onLeaveConfirmChange }: ProfileOwnersSectionProps) {
  const t = useT();
  const ids = useId();
  const me = useMe();
  const queryClient = useQueryClient();
  const showToast = useToast();
  const local = useIsLocalMode();
  const remove = useRemoveProfileOwner(profileId);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [exiting, setExiting] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const triggers = useRef(new Map<string, HTMLButtonElement | null>());
  const pendingExit = useRef<{ owner: ProfileOwner; index: number; timer: number } | null>(null);
  const profile = me.profiles.find((p) => p.id === profileId);

  useEffect(() => {
    onBusyChange(remove.isPending);
  }, [remove.isPending, onBusyChange]);

  if (!profile || local || !ownersSectionVisible(profile)) return null;
  const owners = profile.owners ?? [];
  const viewer = me.user.id;
  const actions = ownerActions(profile, viewer);

  const close = (focusKey: string) => {
    setConfirm(null);
    if (focusKey === 'leave') onLeaveConfirmChange(false);
    queueMicrotask(() => triggers.current.get(focusKey)?.focus());
  };

  const open = (next: NonNullable<Confirm>) => {
    setBanner(null);
    setConfirm(next);
    if (next.kind === 'leave') onLeaveConfirmChange(true);
  };

  /** After the row has gone (DR6): forget it, re-read, say so, and land focus on the next row or the heading. */
  const forget = (owner: ProfileOwner, index: number) => {
    const rest = owners.filter((o) => o.userId !== owner.userId);
    queryClient.setQueryData<Me>(ME_KEY, (current) => withOwnerRemoved(current, profileId, owner.userId));
    void queryClient.invalidateQueries({ queryKey: ME_KEY });
    setExiting(null);
    showToast(t('hosted.profiles.owners.removed', { name: ownerLabel(owner), profile: profile.name }), { tone: 'info' });
    const next = rest[index] ?? rest[index - 1];
    queueMicrotask(() => (next ? triggers.current.get(next.userId) : null)?.focus() ?? headingRef.current?.focus());
  };

  const runRemove = async (owner: ProfileOwner) => {
    if (remove.isPending) return;
    const index = owners.findIndex((o) => o.userId === owner.userId);
    try {
      await remove.mutateAsync(owner.userId);
    } catch (error) {
      const mapped = mapOwnerError(error);
      if (mapped.refetchMe) void queryClient.invalidateQueries({ queryKey: ME_KEY });
      if (!mapped.done) {
        setBanner(mapped.banner ?? null);
        return;
      }
    }
    setConfirm(null);
    setExiting(owner.userId);
    pendingExit.current = { owner, index, timer: window.setTimeout(finishExit, EXIT_FALLBACK_MS) };
  };

  /** Once, whichever comes first: the collapse's transitionend or the fallback (reduced motion has no transition). */
  function finishExit() {
    const exit = pendingExit.current;
    if (!exit) return;
    pendingExit.current = null;
    window.clearTimeout(exit.timer);
    forget(exit.owner, exit.index);
  }

  const runLeave = async () => {
    if (remove.isPending) return;
    try {
      await remove.mutateAsync(viewer);
    } catch (error) {
      const mapped = mapOwnerError(error);
      if (!mapped.done) {
        if (mapped.refetchMe) void queryClient.invalidateQueries({ queryKey: ME_KEY });
        setBanner(mapped.banner ?? null);
        return;
      }
    }
    onLeaveConfirmChange(false);
    onLeft(profile);
  };

  const mail = mailtoFor(profile.name, t);

  return (
    <section className="hp-owners" aria-labelledby={`${ids}-heading`}>
      <h3 id={`${ids}-heading`} ref={headingRef} tabIndex={-1} className="form-label">
        {t('hosted.profiles.owners.title')}
      </h3>
      <p className="form-hint">{owners.length > 1 ? t('hosted.profiles.owners.caption') : t('hosted.profiles.owners.solo')}</p>
      {banner && <ProfileBanner banner={banner} />}
      <ul className="hp-profile-list hp-owner-list" aria-labelledby={`${ids}-heading`}>
        {owners.map((owner) => {
          const you = owner.userId === viewer;
          const removable = actions.canRemove && !you && !owner.creator;
          const confirming = confirm?.kind === 'remove' && confirm.owner.userId === owner.userId;
          const label = ownerLabel(owner);
          return (
            <li
              key={owner.userId}
              className="hp-owner-item"
              data-exiting={exiting === owner.userId || undefined}
              onTransitionEnd={(event) => event.target === event.currentTarget && exiting === owner.userId && finishExit()}
            >
              <div className="hp-profile-row hp-owner-row">
                <span className="hp-profile-row-text">
                  <span className="hp-profile-row-line">
                    <span className="hp-profile-row-name" dir="auto" title={label}>
                      {label}
                    </span>
                    {you && <span className="hp-pill-open">{t('hosted.profiles.owners.you')}</span>}
                  </span>
                  <span className="hp-option-sub">
                    {owner.name && <bdi dir="ltr">{owner.email}</bdi>}
                    {owner.name && owner.creator && ' · '}
                    {owner.creator && t('hosted.profiles.owners.creator')}
                  </span>
                </span>
                {removable && !confirming && (
                  <button
                    type="button"
                    ref={(node) => void triggers.current.set(owner.userId, node)}
                    className="hp-link-button hp-danger press hp-owner-action"
                    aria-label={t('hosted.profiles.owners.removeAria', { name: label })}
                    onClick={() => open({ kind: 'remove', owner })}
                  >
                    {t('hosted.profiles.owners.remove')}
                  </button>
                )}
              </div>
              {confirming && (
                <OwnerConfirm
                  title={t('hosted.profiles.owners.removeTitle', { name: label })}
                  body={t('hosted.profiles.owners.removeBody', { name: label, profile: profile.name })}
                  action={remove.isPending ? t('hosted.profiles.owners.removing') : t('hosted.profiles.owners.removeConfirm', { name: label })}
                  pending={remove.isPending}
                  onCancel={() => close(owner.userId)}
                  onConfirm={() => void runRemove(owner)}
                />
              )}
            </li>
          );
        })}
      </ul>
      {actions.canLeave &&
        (confirm?.kind === 'leave' ? (
          <OwnerConfirm
            title={t('hosted.profiles.owners.leaveTitle', { profile: profile.name })}
            body={t('hosted.profiles.owners.leaveBody', { profile: profile.name })}
            action={remove.isPending ? t('hosted.profiles.owners.leaving') : t('hosted.profiles.owners.leaveConfirm', { profile: profile.name })}
            pending={remove.isPending}
            onCancel={() => close('leave')}
            onConfirm={() => void runLeave()}
          />
        ) : (
          <button
            type="button"
            ref={(node) => void triggers.current.set('leave', node)}
            className="hp-link-button hp-danger press hp-owner-action"
            aria-label={t('hosted.profiles.owners.leaveAria', { profile: profile.name })}
            onClick={() => open({ kind: 'leave' })}
          >
            {t('hosted.profiles.owners.leave')}
          </button>
        ))}
      {actions.canRemove && (
        <p className="form-hint hp-owner-add">
          {t('hosted.profiles.owners.addPartnerLead')}{' '}
          <a className="hp-link" href={mail}>
            {t('hosted.profiles.owners.addPartnerLink')}
          </a>{' '}
          <bdi dir="ltr" className="hp-owner-address">
            ({SUPPORT_EMAIL})
          </bdi>
        </p>
      )}
    </section>
  );
}

interface OwnerConfirmProps {
  title: string;
  body: string;
  action: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/** The in-place confirm (GroupDrawer's pattern, AD2): its heading takes focus; Cancel waits while the request runs (DR5). */
function OwnerConfirm({ title, body, action, pending, onCancel, onConfirm }: OwnerConfirmProps) {
  const t = useT();
  const ids = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <div className="hp-confirm hp-owner-confirm" role="group" aria-labelledby={`${ids}-title`}>
      <h3 id={`${ids}-title`} ref={heading} tabIndex={-1}>
        {title}
      </h3>
      <p>{body}</p>
      <div className="hp-empty-actions">
        <Button type="button" variant="secondary" aria-disabled={pending || undefined} onClick={() => !pending && onCancel()}>
          {t('common.cancel')}
        </Button>
        <Button type="button" variant="danger" aria-disabled={pending || undefined} aria-busy={pending || undefined} onClick={() => !pending && onConfirm()}>
          {action}
        </Button>
      </div>
    </div>
  );
}
