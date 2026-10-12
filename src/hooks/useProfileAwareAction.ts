import { useState, useCallback, useMemo } from 'react';
import { useActiveProfile } from './useActiveProfile';
import type { BusinessProfile } from '../types';

/**
 * useProfileAwareAction Hook
 *
 * Handles profile-checking before executing profile-scoped actions.
 *
 * Behavior:
 * - Single profile: executes immediately with that profile
 * - Multi-profile with specific one active: executes with active profile
 * - "All Profiles" mode: shows picker first, then executes after selection
 *
 * Usage:
 * ```tsx
 * const { trigger, pickerProps } = useProfileAwareAction({
 *   onExecute: (profileId) => openIncomeDrawer({ defaultProfileId: profileId })
 * });
 *
 * return (
 *   <>
 *     <button onClick={trigger}>+ New Income</button>
 *     <ProfileQuickPicker {...pickerProps} />
 *   </>
 * );
 * ```
 */

interface UseProfileAwareActionOptions {
  /** Called when profile is determined (immediately or after picker selection) */
  onExecute: (profileId: string) => void;
}

interface ProfileQuickPickerProps {
  /** The item that asked (null when closed). It may leave the page right after: its menu closes */
  anchor: HTMLElement | null;
  /** Where that item was when the picker opened: the picker is placed from this (MUT-89) */
  anchorRect?: DOMRect;
  /** Where focus goes back when the picker is dismissed: the menu's own button (MUT-89) */
  returnFocus?: HTMLElement | null;
  /** Available profiles to choose from */
  profiles: BusinessProfile[];
  /** Called when user selects a profile */
  onSelect: (profile: BusinessProfile) => void;
  /** Called when picker is dismissed without selection */
  onClose: () => void;
}

interface UseProfileAwareActionReturn {
  /**
   * Call this to initiate the action.
   * Pass the event to anchor the picker if needed, and the element focus
   * should return to if it is dismissed (the menu button whose item asked).
   */
  trigger: (event: React.MouseEvent<HTMLElement>, returnFocus?: HTMLElement | null) => void;
  /** Props to spread to ProfileQuickPicker */
  pickerProps: ProfileQuickPickerProps;
  /** Whether the picker is currently open */
  isPickerOpen: boolean;
}

export function useProfileAwareAction(
  options: UseProfileAwareActionOptions
): UseProfileAwareActionReturn {
  const { isAllProfiles, activeProfileId, profiles } = useActiveProfile();
  // The asking item, where it was, and where focus returns: captured at once,
  // because the item's menu closes (and unmounts it) right after (MUT-89)
  const [picker, setPicker] = useState<{
    anchor: HTMLElement;
    anchorRect: DOMRect;
    returnFocus: HTMLElement | null;
  } | null>(null);

  const trigger = useCallback(
    (event: React.MouseEvent<HTMLElement>, returnFocus: HTMLElement | null = null) => {
      if (profiles.length === 0) {
        // No profiles at all - shouldn't happen in normal use
        console.warn('useProfileAwareAction: No profiles available');
        return;
      }

      if (profiles.length === 1) {
        // Single profile: execute immediately
        options.onExecute(profiles[0].id);
      } else if (!isAllProfiles && activeProfileId) {
        // Specific profile selected: execute with that profile
        options.onExecute(activeProfileId);
      } else {
        // All businesses: ask which business, next to the item that asked
        const anchor = event.currentTarget;
        setPicker({ anchor, anchorRect: anchor.getBoundingClientRect(), returnFocus });
      }
    },
    [profiles, isAllProfiles, activeProfileId, options]
  );

  const handleSelect = useCallback(
    (profile: BusinessProfile) => {
      setPicker(null);
      options.onExecute(profile.id);
    },
    [options]
  );

  const handleClose = useCallback(() => {
    setPicker(null);
  }, []);

  const pickerProps = useMemo<ProfileQuickPickerProps>(
    () => ({
      anchor: picker?.anchor ?? null,
      anchorRect: picker?.anchorRect,
      returnFocus: picker?.returnFocus,
      profiles,
      onSelect: handleSelect,
      onClose: handleClose,
    }),
    [picker, profiles, handleSelect, handleClose]
  );

  return {
    trigger,
    pickerProps,
    isPickerOpen: picker !== null,
  };
}

export type { ProfileQuickPickerProps };
