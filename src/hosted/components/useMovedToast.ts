import { useNavigate } from '@tanstack/react-router';
import { useLanguage } from '../../lib/i18n/core';
import type { HostedProfile } from '../api/client';
import { useToast } from './Toast';

/** MUT-503 (DR4): "Moved to <name>" with Open, which shows the receipt on its new profile (AC: the confirmation names it). */
export function useMovedToast(): (target: HostedProfile, receiptId: string) => void {
  const { t } = useLanguage();
  const showToast = useToast();
  const navigate = useNavigate();
  return (target, receiptId) =>
    showToast(t('hosted.receipts.move.moved', { name: target.name }), {
      tone: 'info',
      action: { label: t('hosted.receipts.move.open'), onAction: () => void navigate({ to: `/p/${target.id}/expenses/receipts/${receiptId}` }) },
    });
}

/** MUT-503 (DR2): whether there is anywhere to move to — another profile, writable or not; none at all hides Move. */
export function hasOtherProfiles(me: { profiles: readonly { id: string }[] }, profileId: string): boolean {
  return me.profiles.some((p) => p.id !== profileId);
}
