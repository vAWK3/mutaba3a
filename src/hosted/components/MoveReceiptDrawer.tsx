import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Button } from '../../components/ui/Button';
import { useLanguage } from '../../lib/i18n/core';
import type { HostedProfile } from '../api/client';
import { useAttemptKey } from '../data/attemptKey';
import { moveErrorOf, useMoveReceipt, useReceipt } from '../data/receiptQueries';
import { billingGateOf } from '../data/trialPrompt';
import { formatDay } from '../format/dates';
import { useMe } from '../session/me';
import { Drawer } from './Drawer';
import { AlertIcon, InfoIcon } from './Icons';
import { ProfileKindLine } from './ProfileKindLine';

/**
 * MUT-503: move a To-review receipt to another of the person's profiles (DR2, DR3, DR6, DR9). The other profiles
 * are radio rows (`.hp-profile-row`); one that is read-only or locked stays listed but can't be chosen, with its
 * reason. Choosing one names it on the primary ("Move to Noor Design Studio"). A refusal shows in the banner at the
 * top of the body and the receipt stays where it is. Opened from the URL (`?move=<receiptId>`), drawer-first.
 */
export interface MoveReceiptDrawerProps {
  /** The profile the receipt is on now. */
  profile: HostedProfile;
  receipt: { id: string; receivedOn: string; reading: boolean };
  onClose: () => void;
  /** After the move held: the profile it went to. */
  onMoved: (target: HostedProfile) => void;
}

const FORM_ID = 'hosted-move-receipt';

/**
 * The drawer for a receipt named in the URL (`?move=`), fetched if the page hasn't got it. Only a To-review receipt
 * opens it: a Filed one, or one not on this profile, opens nothing (AC3).
 */
export function MoveReceiptDrawerHost({ profile, receiptId, onClose, onMoved }: Omit<MoveReceiptDrawerProps, 'receipt'> & { receiptId: string }) {
  const receipt = useReceipt(profile.id, receiptId);
  const data = receipt.data;
  if (!data || data.filingStatus !== 'TO_REVIEW' || data.status !== 'READY') return null;
  return <MoveReceiptDrawer profile={profile} receipt={{ id: data.id, receivedOn: data.receivedOn, reading: data.reading === 'pending' }} onClose={onClose} onMoved={onMoved} />;
}

export function MoveReceiptDrawer({ profile, receipt, onClose, onMoved }: MoveReceiptDrawerProps) {
  const { t, language } = useLanguage();
  const me = useMe();
  const navigate = useNavigate();
  const move = useMoveReceipt(profile.id);
  const attempt = useAttemptKey();
  const [chosen, setChosen] = useState<HostedProfile | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const others = me.profiles.filter((p) => p.id !== profile.id).map((p) => ({ profile: p, gate: billingGateOf(me, p) }));
  const noneOpen = others.every((o) => o.gate !== 'open');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!chosen || move.isPending) return;
    setBanner(null);
    try {
      await move.mutateAsync({ receiptId: receipt.id, targetProfileId: chosen.id, idempotencyKey: attempt.keyFor({ receiptId: receipt.id, to: chosen.id }) });
      attempt.succeeded();
      onMoved(chosen);
    } catch (error) {
      setBanner(t(`hosted.receipts.move.errors.${moveErrorOf(error)}`, { name: chosen.name }));
    }
  };

  const footer = (
    <div className="drawer-footer-right">
      <Button variant="secondary" onClick={onClose}>
        {t('common.cancel')}
      </Button>
      <Button type="submit" form={FORM_ID} disabled={!chosen} isLoading={move.isPending} keepLabelWhileLoading>
        {chosen ? t('hosted.receipts.move.moveTo', { name: chosen.name }) : t('hosted.receipts.move.submit')}
      </Button>
    </div>
  );

  return (
    <Drawer title={t('hosted.receipts.move.title')} onClose={onClose} closeLabel={t('common.close')} footer={footer}>
      <form id={FORM_ID} onSubmit={(event) => void submit(event)} className="hp-move-receipt">
        {banner && (
          <div className="hp-banner hp-banner-error" role="alert">
            <AlertIcon />
            <span>{banner}</span>
          </div>
        )}
        <p className="hp-move-receipt-lead">{t('hosted.receipts.move.lead', { day: formatDay(receipt.receivedOn, language), profile: profile.name })}</p>
        {receipt.reading && (
          <p className="hp-banner hp-banner-info" role="note">
            <InfoIcon />
            <span>{t('hosted.receipts.move.reading')}</span>
          </p>
        )}
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
                  if (off) return;
                  setChosen(p);
                  setBanner(null);
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
      </form>
    </Drawer>
  );
}
