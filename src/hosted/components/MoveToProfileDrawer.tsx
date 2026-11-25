import type { ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Button } from '../../components/ui/Button';
import { useLanguage } from '../../lib/i18n/core';
import type { HostedProfile } from '../api/client';
import { billingGateOf } from '../data/trialPrompt';
import { useMe } from '../session/me';
import { Drawer } from './Drawer';
import { AlertIcon } from './Icons';
import { ProfileKindLine } from './ProfileKindLine';

/**
 * MUT-503 (DR2, DR3, DR6, DR9), generalised by MUT-589: a drawer that moves one record to another of the person's
 * profiles. The other profiles are radio rows (`.hp-profile-row`); one that is read-only or locked stays listed but
 * can't be chosen, with its reason. Choosing one names it on the primary ("Move to Noor Design Studio"). A refusal
 * shows in the banner at the top of the body and the record stays where it is.
 *
 * The caller owns the choice (`chosen`, `onChoose`), so it can read what the move would change for that profile
 * and show it under the rows (`details`, MUT-589's changes list), and it owns the submit.
 */
export interface MoveToProfileDrawerProps {
  /** The profile the record is on now. */
  profile: HostedProfile;
  title: string;
  /** One line under the banner: what is moving, and from where. */
  lead: ReactNode;
  /** Notes between the lead and the rows (the receipt's "still being read"). */
  notes?: ReactNode;
  chosen: HostedProfile | null;
  onChoose: (profile: HostedProfile) => void;
  /** Under the rows once a profile is chosen. */
  details?: ReactNode;
  /** The refusal to show, or null. */
  banner: string | null;
  /** Move is held (a preview still loading, or refused). */
  submitBlocked?: boolean;
  pending: boolean;
  onSubmit: (chosen: HostedProfile) => void;
  onClose: () => void;
  formId: string;
}

export function MoveToProfileDrawer({ profile, title, lead, notes, chosen, onChoose, details, banner, submitBlocked = false, pending, onSubmit, onClose, formId }: MoveToProfileDrawerProps) {
  const { t } = useLanguage();
  const me = useMe();
  const navigate = useNavigate();

  const others = me.profiles.filter((p) => p.id !== profile.id).map((p) => ({ profile: p, gate: billingGateOf(me, p) }));
  const noneOpen = others.every((o) => o.gate !== 'open');

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!chosen || pending || submitBlocked) return;
    onSubmit(chosen);
  };

  const footer = (
    <div className="drawer-footer-right">
      <Button variant="secondary" onClick={onClose}>
        {t('common.cancel')}
      </Button>
      <Button type="submit" form={formId} disabled={!chosen || submitBlocked} isLoading={pending} keepLabelWhileLoading>
        {chosen ? t('hosted.receipts.move.moveTo', { name: chosen.name }) : t('hosted.receipts.move.submit')}
      </Button>
    </div>
  );

  return (
    <Drawer title={title} onClose={onClose} closeLabel={t('common.close')} footer={footer}>
      <form id={formId} onSubmit={submit} className="hp-move-receipt">
        {banner && (
          <div className="hp-banner hp-banner-error" role="alert">
            <AlertIcon />
            <span>{banner}</span>
          </div>
        )}
        <p className="hp-move-receipt-lead">{lead}</p>
        {notes}
        {noneOpen && (
          <div className="hp-banner hp-banner-warning" role="note">
            <AlertIcon />
            <span>
              <strong>{t('hosted.receipts.move.noneTitle')}</strong> {t('hosted.receipts.move.noneBody')}{' '}
              <button type="button" className="hp-link-button press" onClick={() => void navigate({ to: '.', search: { billing: true } } as never)}>
                {t('hosted.receipts.move.billing')}
              </button>
            </span>
          </div>
        )}
        <div className="hp-you-box hp-move-receipt-profiles" role="radiogroup" aria-label={t('hosted.receipts.move.pick')}>
          {others.map(({ profile: p, gate }) => {
            const off = gate !== 'open';
            const on = chosen?.id === p.id;
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={on}
                aria-disabled={off || undefined}
                className={`hp-profile-row press ${on ? 'hp-profile-row-on' : ''}`}
                onClick={() => {
                  if (!off) onChoose(p);
                }}
              >
                <span className="hp-profile-row-text">
                  <span className="hp-profile-row-line">
                    <span className="hp-profile-row-name" dir="auto" title={p.name}>
                      {p.name}
                    </span>
                  </span>
                  {off ? <span className="hp-option-sub">{t(`hosted.receipts.move.reason.${gate === 'locked' ? 'locked' : 'readOnly'}`)}</span> : <ProfileKindLine profile={p} viewerId={me.user.id} />}
                </span>
                {!off && <span className="hp-radio" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
        {chosen && details}
      </form>
    </Drawer>
  );
}
