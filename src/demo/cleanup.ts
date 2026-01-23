/**
 * Demo Mode Cleanup Utilities
 *
 * Functions for cleaning up demo data and resetting demo mode state.
 */

import { useDemoStore } from './demoStore';
import { removeDemoData, hasDemoData } from './seedData';
import { DEMO_STATE_KEY } from './constants';

/**
 * Full demo mode reset:
 * 1. Remove all demo data from database
 * 2. Clear demo mode state from store
 * 3. Clear localStorage
 */
export async function resetDemoMode(): Promise<void> {
  // Remove demo data from database
  await removeDemoData();

  // Clear store state
  useDemoStore.getState().deactivateDemo();

  // Clear localStorage
  localStorage.removeItem(DEMO_STATE_KEY);

  console.log('Demo mode fully reset');
}

/**
 * Check if demo mode is currently active
 */
export function isDemoModeActive(): boolean {
  return useDemoStore.getState().isActive;
}

/**
 * Check if there's demo data in the database
 */
export { hasDemoData };

/**
 * Get demo mode statistics for debugging
 */
export function getDemoModeStatus(): {
  isActive: boolean;
  seededAt: string | null;
  frozenTime: string | null;
} {
  const state = useDemoStore.getState();
  return {
    isActive: state.isActive,
    seededAt: state.seededAt,
    frozenTime: state.frozenTime,
  };
}
