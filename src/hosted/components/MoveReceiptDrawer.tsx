import { useState } from 'react';
import { useLanguage } from '../../lib/i18n/core';
import type { HostedProfile } from '../api/client';
import { useAttemptKey } from '../data/attemptKey';
import { moveErrorOf, useMoveReceipt, useReceipt } from '../data/receiptQueries';
import { formatDay } from '../format/dates';
import { InfoIcon } from './Icons';
import { MoveToProfileDrawer } from './MoveToProfileDrawer';

/**
 * MUT-503: move a To-review receipt to another of the person's profiles (DR2, DR3, DR6, DR9). The other profiles
 * are radio rows (`.hp-profile-row`); one that is read-only or locked stays listed but can't be chosen, with its
 * reason. Choosing one names it on the primary ("Move to Noor Design Studio"). A refusal shows in the banner at the
 * top of the body and the receipt stays where it is. Opened from the URL (`?move=<receiptId>`), drawer-first.
 * MUT-589: a thin wrapper over `MoveToProfileDrawer`, which the expense move shares.
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
  const move = useMoveReceipt(profile.id);
  const attempt = useAttemptKey();
  const [chosen, setChosen] = useState<HostedProfile | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const submit = async (target: HostedProfile) => {
    setBanner(null);
    try {
      await move.mutateAsync({ receiptId: receipt.id, targetProfileId: target.id, idempotencyKey: attempt.keyFor({ receiptId: receipt.id, to: target.id }) });
      attempt.succeeded();
      onMoved(target);
    } catch (error) {
      setBanner(t(`hosted.receipts.move.errors.${moveErrorOf(error)}`, { name: target.name }));
    }
  };

  return (
    <MoveToProfileDrawer
      profile={profile}
      title={t('hosted.receipts.move.title')}
      lead={t('hosted.receipts.move.lead', { day: formatDay(receipt.receivedOn, language), profile: profile.name })}
      notes={
        receipt.reading && (
          <p className="hp-banner hp-banner-info" role="note">
            <InfoIcon />
            <span>{t('hosted.receipts.move.reading')}</span>
          </p>
        )
      }
      chosen={chosen}
      onChoose={(p) => {
        setChosen(p);
        setBanner(null);
      }}
      banner={banner}
      pending={move.isPending}
      onSubmit={(target) => void submit(target)}
      onClose={onClose}
      formId={FORM_ID}
    />
  );
}
