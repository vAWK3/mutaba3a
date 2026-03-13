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
  /** Element to anchor the popover to (null when closed) */
  anchor: HTMLElement | null;
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
   * Pass the event to anchor the picker if needed.
   */
  trigger: (event: React.MouseEvent<HTMLElement>) => void;
  /** Props to spread to ProfileQuickPicker */
  pickerProps: ProfileQuickPickerProps;
  /** Whether the picker is currently open */
  isPickerOpen: boolean;
}

export function useProfileAwareAction(
  options: UseProfileAwareActionOptions
): UseProfileAwareActionReturn {
  const { isAllProfiles, activeProfileId, profiles } = useActiveProfile();
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null);

  const trigger = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (profiles.length === 0) {
        // No profiles at all - shouldn't happen in normal use
        console.warn('useProfileAwareAction: No profiles available');
        return;
      }

      if (profiles.length === 1) {
        // Single profile: execute immediately
        options.onExecute(profiles[0].id);
      } else if (!isAllProfiles && activeProfileId && activeProfileId !== 'all') {
        // Specific profile selected: execute with that profile
        options.onExecute(activeProfileId);
      } else {
        // "All Profiles" mode: show picker anchored to click target
        setPickerAnchor(event.currentTarget);
      }
    },
    [profiles, isAllProfiles, activeProfileId, options]
  );

  const handleSelect = useCallback(
    (profile: BusinessProfile) => {
      setPickerAnchor(null);
      options.onExecute(profile.id);
    },
    [options]
  );

  const handleClose = useCallback(() => {
    setPickerAnchor(null);
  }, []);

  const pickerProps = useMemo<ProfileQuickPickerProps>(
    () => ({
      anchor: pickerAnchor,
      profiles,
      onSelect: handleSelect,
      onClose: handleClose,
    }),
    [pickerAnchor, profiles, handleSelect, handleClose]
  );

  return {
    trigger,
    pickerProps,
    isPickerOpen: pickerAnchor !== null,
  };
}

export type { ProfileQuickPickerProps };
