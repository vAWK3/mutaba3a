/**
 * Demo/Seed Mode Module
 *
 * Provides functionality to populate the app with realistic demo data
 * for sales demos and website screenshots.
 *
 * Usage:
 * - Navigate to /?demo=1 to trigger demo mode activation
 * - Type "SEED" in the confirmation modal to populate data
 * - Use the demo banner to freeze time for consistent screenshots
 * - Reset demo mode to remove all demo data
 *
 * All demo data uses the 'demo_' ID prefix for easy identification
 * and cleanup without affecting user data.
 */

// Types
export * from './types';

// Constants
export * from './constants';

// PRNG utilities
export { SeededRandom, seededRandom } from './prng';

// Store
export { useDemoStore } from './demoStore';

// Seed data utilities
export { seedDemoData, hasDemoData, removeDemoData, getDemoProfileId } from './seedData';

// Cleanup utilities
export { resetDemoMode, isDemoModeActive, getDemoModeStatus } from './cleanup';

// Time freeze utilities
export {
  freezeTime,
  unfreezeTime,
  isTimeFrozen,
  getFrozenTime,
  getDemoNow,
  getDemoToday,
  FREEZE_PRESETS,
  freezeToPreset,
} from './timeFreeze';
