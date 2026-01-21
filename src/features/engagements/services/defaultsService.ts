// ============================================================================
// Defaults Service - Apply/reset category defaults
// ============================================================================

import { nanoid } from 'nanoid';
import type { EngagementCategory, EngagementLanguage, Deliverable } from '../types';
import { SCOPE_PRESETS, getText, type DeliverablePreset } from '../presets';

/**
 * Get scope defaults (dependencies and exclusions) for a category
 */
export function getScopeDefaults(
  category: EngagementCategory,
  language: EngagementLanguage
): { dependencies: string[]; exclusions: string[] } {
  const presets = SCOPE_PRESETS[category];

  return {
    dependencies: presets.dependencies.map(d => getText(d, language)),
    exclusions: presets.exclusions.map(e => getText(e, language)),
  };
}

/**
 * Apply defaults to existing scope data (merge without duplicates)
 */
export function applyDefaults(
  category: EngagementCategory,
  language: EngagementLanguage,
  existing: { dependencies: string[]; exclusions: string[] }
): { dependencies: string[]; exclusions: string[] } {
  const defaults = getScopeDefaults(category, language);

  const mergedDependencies = [...new Set([...existing.dependencies, ...defaults.dependencies])];
  const mergedExclusions = [...new Set([...existing.exclusions, ...defaults.exclusions])];

  return {
    dependencies: mergedDependencies,
    exclusions: mergedExclusions,
  };
}

/**
 * Reset to defaults (replace existing with category defaults)
 */
export function resetToDefaults(
  category: EngagementCategory,
  language: EngagementLanguage
): { dependencies: string[]; exclusions: string[] } {
  return getScopeDefaults(category, language);
}

/**
 * Get deliverable presets for a category
 */
export function getDeliverablePresets(
  category: EngagementCategory,
  language: EngagementLanguage
): Array<DeliverablePreset & { displayText: string }> {
  const presets = SCOPE_PRESETS[category];

  return presets.deliverablePresets.map(preset => ({
    ...preset,
    displayText: getText(preset.description, language),
  }));
}

/**
 * Create a deliverable from a preset
 */
export function createDeliverableFromPreset(
  presetId: string,
  category: EngagementCategory,
  language: EngagementLanguage
): Deliverable | null {
  const presets = SCOPE_PRESETS[category];
  const preset = presets.deliverablePresets.find(p => p.id === presetId);

  if (!preset) {
    return null;
  }

  return {
    id: nanoid(),
    description: getText(preset.description, language),
    quantity: preset.defaultQuantity,
    format: preset.defaultFormat,
    source: 'preset',
    presetId: preset.id,
  };
}

/**
 * Check if defaults should be auto-applied
 * (when lists are empty and defaults haven't been applied yet)
 */
export function shouldAutoApplyDefaults(
  dependencies: string[],
  exclusions: string[],
  defaultsApplied?: boolean
): boolean {
  return !defaultsApplied && dependencies.length === 0 && exclusions.length === 0;
}
