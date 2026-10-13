import { useEffect } from 'react';
import { useLanguage } from '../../lib/i18n/core';
import { Button } from '../../components/ui/Button';
import { useSavedFlashResolution } from '../../lib/useSavedFlash';
import { useSavedFlashStore, type SavedFlash } from '../../lib/savedFlashStore';

/**
 * The portal's view of an after-save (R1 via HP1, MUT-91). The store and the
 * list hook are the app's own; only this presentation is the portal's, since
 * the app's announcer runs on the app's router, profile store and toasts.
 *
 * - The list claimed the save: a polite, visually hidden "Saved" (the row tints itself).
 * - It didn't: "Expense saved · Show", on this page (eng review D5), so Show
 *   can never act on a page the person has left. It names no cause (D4): a
 *   filter, a later page or a failed refetch all look the same from here.
 *
 * The notice is settled (marked messaged in the store) when it times out,
 * its page unmounts or Show is pressed, so it is raised once per save, never
 * on a return visit.
 *
 * Show sets the list's `anchor`; the flash is re-armed only once the page
 * renders with that anchor. Re-arming on the click itself would let the list's
 * next render, still on its old filters, report "settled, not here" first.
 */

export const NOTICE_MS = 6000;

export interface SavedNoticeProps {
  kind: Extract<SavedFlash['kind'], 'expense' | 'conversion'>;
  message: string;
  profileId: string;
  /** Anchor the list on the saved record. */
  onShow: (id: string) => void;
  /** The list's current anchor, from its filters. */
  anchor?: string;
}

export function SavedNotice({ kind, message, profileId, onShow, anchor }: SavedNoticeProps) {
  const { t } = useLanguage();
  const { pending, claimed } = useSavedFlashResolution();
  const ours = pending && pending.kind === kind && pending.profileId === profileId ? pending : null;
  const candidate = ours && claimed === false && !ours.messaged ? ours : null;

  useEffect(() => {
    if (!candidate) return;
    const settle = () => useSavedFlashStore.getState().settleMessage(candidate);
    const timer = setTimeout(settle, NOTICE_MS);
    return () => {
      clearTimeout(timer);
      settle();
    };
  }, [candidate]);

  // Show landed: the list now renders from the saved record, so let it claim the save.
  useEffect(() => {
    const store = useSavedFlashStore.getState();
    const shown = store.pending;
    if (!anchor || !shown || store.claimed !== false || !shown.messaged) return;
    if (shown.kind !== kind || shown.profileId !== profileId || shown.ids[0] !== anchor) return;
    store.rearm(shown);
  }, [anchor, kind, profileId]);

  if (ours && claimed === true) {
    return (
      <span className="sr-only" role="status" aria-live="polite">
        {t('hosted.savedFlash.saved')}
      </span>
    );
  }
  if (!candidate) return null;

  const show = () => {
    useSavedFlashStore.getState().settleMessage(candidate);
    onShow(candidate.ids[0]);
  };

  return (
    <div className="hp-toast hp-toast-info" role="status" aria-live="polite">
      <span>{message}</span>
      <Button variant="ghost" size="sm" onClick={show}>
        {t('hosted.savedFlash.show')}
      </Button>
    </div>
  );
}

/** Above a list started at a saved record: why it is short, and the way back to the newest. */
export function AnchoredNote({ onShowLatest }: { onShowLatest: () => void }) {
  const { t } = useLanguage();
  return (
    <div className="hp-anchored">
      <span>{t('hosted.savedFlash.anchored')}</span>
      <Button variant="ghost" size="sm" onClick={onShowLatest}>
        {t('hosted.savedFlash.showLatest')}
      </Button>
    </div>
  );
}
