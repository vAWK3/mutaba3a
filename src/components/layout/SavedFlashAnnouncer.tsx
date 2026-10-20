/**
 * SavedFlashAnnouncer (MUT-81, R1; icon MUT-338)
 *
 * Mounted once in AppShell. Watches the saved-flash store's resolution:
 * - claimed -> a brief "Saved" toast carrying the animated save-feedback icon
 *   (the row also tints itself via useSavedFlashRows, so this is additional
 *   feedback, not the only signal).
 * - not claimed -> a message naming where the save went, with a Show action
 *   that switches profile if needed, navigates, and re-arms the flash so
 *   the row is tinted on arrival and the original message can never repeat.
 *
 * Both ride the existing Toast (role="status", aria-live, action support
 * already built) rather than a new floating surface added here - the legacy
 * app has no firm concept (MUT-299 B11), so the icon preset is always
 * playful.
 *
 * Payments are outside MUT-338: a claimed payment keeps its visually-hidden
 * "Saved" and its unclaimed message carries no icon.
 */

import { useEffect, useRef } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useSavedFlashResolution } from '../../lib/useSavedFlash';
import { useSavedFlashStore, flashTarget, FLASH_MS, type SavedFlash } from '../../lib/savedFlashStore';
import { useProfileStore } from '../../lib/profileStore';
import { useToast } from '../../lib/toastStore';
import { useT } from '../../lib/i18n';
import { isolate } from '../../lib/utils';
import { SaveFeedbackIcon } from '../icons/SaveFeedbackIcon';

/** MUT-338 animates the save of an entry (income, expense, conversion), not of a payment. */
const animatesSave = (flash: SavedFlash): boolean => flash.kind !== 'payment';

function messageFor(flash: SavedFlash, t: ReturnType<typeof useT>): string {
  switch (flash.kind) {
    case 'payment':
      return flash.clientName
        ? t('savedFlash.paymentSaved', { client: isolate(flash.clientName) })
        : t('savedFlash.paymentSavedNoClient');
    case 'income':
      return flash.clientName
        ? t('savedFlash.incomeSaved', { client: isolate(flash.clientName) })
        : t('savedFlash.incomeSavedNoClient');
    // Portal kinds (MUT-91): the app never marks them, so the plain word is enough.
    case 'expense':
    case 'conversion':
      return t('savedFlash.saved');
  }
}

export function SavedFlashAnnouncer() {
  const { pending, claimed } = useSavedFlashResolution();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const t = useT();
  // Which pending object this announcer has already raised a message for --
  // identity, not just "unclaimed", so a re-render with the same unresolved
  // save never shows it a second time.
  const shownFor = useRef<SavedFlash | null>(null);
  const shownClaimedFor = useRef<SavedFlash | null>(null);

  useEffect(() => {
    if (!pending || claimed !== false || pending.messaged || shownFor.current === pending) return;
    shownFor.current = pending;

    const handleShow = () => {
      // The raw store, never useActiveProfile's wrapper: that hook silently
      // refuses an id the profiles query has not loaded yet (eng review).
      // Show is not a pick: it changes the working business and leaves All
      // businesses as the user set it (MUT-89, ADR-051).
      if (pending.profileId) {
        useProfileStore.getState().setWorkingProfile(pending.profileId);
      }
      void navigate(flashTarget(pending));
      useSavedFlashStore.getState().rearm({ ...pending, messaged: true });
    };

    showToast(messageFor(pending, t), {
      action: { label: t('savedFlash.show'), onClick: handleShow },
      duration: 6000,
      icon: animatesSave(pending) ? <SaveFeedbackIcon preset="playful" /> : undefined,
    });
  }, [pending, claimed, showToast, navigate, t]);

  useEffect(() => {
    if (!pending || claimed !== true || !animatesSave(pending) || shownClaimedFor.current === pending) return;
    shownClaimedFor.current = pending;
    showToast(t('savedFlash.saved'), { icon: <SaveFeedbackIcon preset="playful" />, duration: FLASH_MS });
  }, [pending, claimed, showToast, t]);

  if (pending && claimed === true && !animatesSave(pending)) {
    return (
      <span className="sr-only" role="status" aria-live="polite">
        {t('savedFlash.saved')}
      </span>
    );
  }
  return null;
}
