import { useId, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '../../../components/ui/Button';
import { useLanguage } from '../../../lib/i18n/core';
import type { AccountantGrant, HostedProfile } from '../../api/client';
import { trackPortal } from '../../analytics/portalAnalytics';
import { AccessScopeList } from '../../components/AccessScopeList';
import { Drawer, ReadOnlyFields } from '../../components/Drawer';
import { AlertIcon } from '../../components/Icons';
import { accountantsKey, refetchAfterRefusal, useInviteAccountant } from '../../data/sharingQueries';
import { useWritableFor } from '../../session/me';
import { inviteErrorOf, type Line } from './sharingRules';

/**
 * MUT-561 (B2; Basel 13244: the portal's side drawer, not a dialog): invite an accountant to read one profile. One
 * email field and the four scope points. No language picker: the email goes in the portal's language (OW2). A refusal
 * about the address shows under the field, anything about the whole submit in the banner slot (DESIGN.md). Under the
 * lapse gate it opens read-only, like every write drawer (MUT-361).
 */

const FORM_ID = 'hosted-invite-accountant-form';
/** Enough to catch a slip before sending; the server decides what an address is. */
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface InviteAccountantDrawerProps {
  profile: HostedProfile;
  /** The list's limit, for a limit refusal that names none (review f). */
  listLimit?: number;
  onClose: () => void;
  onInvited: (grant: AccountantGrant) => void;
}

export function InviteAccountantDrawer({ profile, listLimit, onClose, onInvited }: InviteAccountantDrawerProps) {
  const { t, language } = useLanguage();
  const ids = useId();
  const queryClient = useQueryClient();
  const writable = useWritableFor(profile);
  const invite = useInviteAccountant(profile.id);
  const fieldRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [banner, setBanner] = useState<Line | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (invite.isPending || !writable) return;
    const address = email.trim();
    setBanner(null);
    if (!LOOKS_LIKE_EMAIL.test(address)) {
      setFieldError('hosted.sharing.invite.errors.invalid');
      fieldRef.current?.focus();
      return;
    }
    setFieldError(null);
    try {
      const grant = await invite.mutateAsync({ email: address, locale: language });
      void trackPortal('accountant_invited', {});
      onInvited(grant);
    } catch (error) {
      const mapped = inviteErrorOf(error, address, listLimit);
      if (mapped.refetch) refetchAfterRefusal(queryClient, accountantsKey(profile.id));
      setFieldError(mapped.field ?? null);
      setBanner(mapped.banner ?? null);
      if (mapped.field) fieldRef.current?.focus();
    }
  }

  const hintId = `${ids}-hint`;
  const errorId = `${ids}-error`;

  return (
    <Drawer
      title={t('hosted.sharing.invite.title')}
      onClose={onClose}
      closeLabel={t('common.close')}
      readOnly={!writable}
      footer={
        <div className="drawer-footer-right">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form={FORM_ID} isLoading={invite.isPending} keepLabelWhileLoading aria-busy={invite.isPending || undefined}>
            {t('hosted.sharing.invite.send')}
          </Button>
        </div>
      }
    >
      {banner && (
        <div className="hp-banner hp-banner-error" role="alert">
          <AlertIcon />
          <span>{t(banner.key, banner.vars)}</span>
        </div>
      )}
      <p className="hp-sharing-intro" id={hintId}>
        {t('hosted.sharing.invite.intro')}
      </p>
      <ReadOnlyFields readOnly={!writable}>
        <form id={FORM_ID} noValidate onSubmit={(event) => void onSubmit(event)}>
          <div className="form-group">
            <label className="form-label" htmlFor={`${ids}-email`}>
              {t('hosted.sharing.invite.email')}
            </label>
            <input
              ref={fieldRef}
              id={`${ids}-email`}
              className={`input ${fieldError ? 'input-error' : ''}`}
              type="email"
              inputMode="email"
              autoComplete="off"
              dir="ltr"
              autoFocus
              readOnly={invite.isPending}
              value={email}
              aria-invalid={Boolean(fieldError)}
              aria-describedby={fieldError ? errorId : hintId}
              onChange={(event) => setEmail(event.target.value)}
            />
            {fieldError && (
              <p className="form-error" id={errorId}>
                {t(fieldError)}
              </p>
            )}
          </div>
        </form>
      </ReadOnlyFields>
      <AccessScopeList />
    </Drawer>
  );
}
