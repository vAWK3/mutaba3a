import { useEffect, useRef, useState, type FocusEvent } from 'react';
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
 *   Like the app's toast, it holds while hovered or focused (WCAG 2.2.1).
 *
 * A save is settled (marked messaged in the store) when its notice times out,
 * Show is pressed, or the page is left, resolved or not, so nothing about it
 * is shown or announced again on a later visit.
 *
 * Show sets the list's `anchor`, and the flash is re-armed only once the page
 * renders with the new filters (`filtersKey`). Re-arming on the click itself
 * would let the list's next render, still on its old filters, report "settled,
 * not here" first. Keyed on the filters, not the anchor alone, so Show still
 * lands when the list was already anchored on that record.
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
  /** Changes whenever the list's filters do (anchor included). */
  filtersKey: string;
}

export function SavedNotice({ kind, message, profileId, onShow, anchor, filtersKey }: SavedNoticeProps) {
  const { t } = useLanguage();
  const { pending, claimed } = useSavedFlashResolution();
  const ours = pending && pending.kind === kind && pending.profileId === profileId ? pending : null;
  const candidate = ours && claimed === false && !ours.messaged ? ours : null;

  // Leaving the page settles whatever save of ours is still pending.
  useEffect(
    () => () => {
      const left = useSavedFlashStore.getState().pending;
      if (left && left.kind === kind && left.profileId === profileId) useSavedFlashStore.getState().settleMessage(left);
    },
    [kind, profileId],
  );

  // Show landed: the list now renders from the saved record, so let it claim the save.
  useEffect(() => {
    const store = useSavedFlashStore.getState();
    const shown = store.pending;
    if (!anchor || !shown || store.claimed !== false || !shown.messaged) return;
    if (shown.kind !== kind || shown.profileId !== profileId || shown.ids[0] !== anchor) return;
    store.rearm(shown);
  }, [filtersKey, anchor, kind, profileId]);

  if (ours && claimed === true && (!ours.messaged || anchor === ours.ids[0])) {
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
  return <NoticeBox key={candidate.ids[0]} flash={candidate} message={message} showLabel={t('hosted.savedFlash.show')} onShow={show} />;
}

/** One notice's lifetime: its own countdown, paused while hovered or focused. */
function NoticeBox({ flash, message, showLabel, onShow }: { flash: SavedFlash; message: string; showLabel: string; onShow: () => void }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const remaining = useRef(NOTICE_MS);
  const paused = hovered || focused;

  useEffect(() => {
    if (paused) return;
    const started = Date.now();
    const timer = setTimeout(() => useSavedFlashStore.getState().settleMessage(flash), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current -= Date.now() - started;
    };
  }, [flash, paused]);

  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
  };

  return (
    <div
      className="hp-toast hp-toast-info"
      role="status"
      aria-live="polite"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={onBlur}
    >
      <span>{message}</span>
      <Button variant="ghost" size="sm" onClick={onShow}>
        {showLabel}
      </Button>
    </div>
  );
}

/**
 * Above a list started at a saved record: why it is short, and the way back to
 * the newest. It takes focus after Show (`focusRequest` changes), so a keyboard
 * or screen-reader user lands where the list changed instead of on the page body.
 */
export function AnchoredNote({ onShowLatest, focusRequest = 0 }: { onShowLatest: () => void; focusRequest?: number }) {
  const { t } = useLanguage();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusRequest > 0) ref.current?.focus();
  }, [focusRequest]);
  return (
    <div ref={ref} className="hp-anchored" tabIndex={-1}>
      <span>{t('hosted.savedFlash.anchored')}</span>
      <Button variant="ghost" size="sm" onClick={onShowLatest}>
        {t('hosted.savedFlash.showLatest')}
      </Button>
    </div>
  );
}
