/**
 * Time Freeze Utilities
 *
 * Provides utilities for freezing time during demo/screenshot sessions.
 * When time is frozen, the demo store's getNow() and getToday() will
 * return the frozen time instead of the real current time.
 */

import { useDemoStore } from './demoStore';
import { DEFAULT_FROZEN_TIME } from './constants';

/**
 * Freeze time to a specific date for consistent screenshots
 * @param isoDate - ISO date string to freeze to (defaults to DEFAULT_FROZEN_TIME)
 */
export function freezeTime(isoDate?: string): void {
  useDemoStore.getState().freezeTime(isoDate || DEFAULT_FROZEN_TIME);
}

/**
 * Unfreeze time to return to real-time
 */
export function unfreezeTime(): void {
  useDemoStore.getState().unfreezeTime();
}

/**
 * Check if time is currently frozen
 */
export function isTimeFrozen(): boolean {
  return useDemoStore.getState().frozenTime !== null;
}

/**
 * Get the current frozen time (or null if not frozen)
 */
export function getFrozenTime(): string | null {
  return useDemoStore.getState().frozenTime;
}

/**
 * Get "now" - returns frozen time if set, otherwise real time
 * Use this instead of `new Date()` in demo-aware components
 */
export function getDemoNow(): Date {
  return useDemoStore.getState().getNow();
}

/**
 * Get "today" as YYYY-MM-DD - returns frozen date if set, otherwise real date
 * Use this instead of date calculations in demo-aware components
 */
export function getDemoToday(): string {
  return useDemoStore.getState().getToday();
}

/**
 * Preset frozen times for common screenshot scenarios
 */
export const FREEZE_PRESETS = {
  // Mid-January - shows December overdue and January upcoming
  january: '2025-01-15T12:00:00.000Z',
  // End of month - shows more urgent due items
  endOfMonth: '2025-01-28T12:00:00.000Z',
  // Beginning of month - shows new month overview
  beginningOfMonth: '2025-01-02T12:00:00.000Z',
  // Mid-year for different perspective
  midYear: '2025-06-15T12:00:00.000Z',
} as const;

/**
 * Freeze to a preset time
 */
export function freezeToPreset(preset: keyof typeof FREEZE_PRESETS): void {
  freezeTime(FREEZE_PRESETS[preset]);
}
