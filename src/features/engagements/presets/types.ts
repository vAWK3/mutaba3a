// ============================================================================
// Engagement Presets Types
// ============================================================================

import type { EngagementCategory, EngagementLanguage } from '../types';

/**
 * Bilingual text for presets
 */
export interface BilingualText {
  en: string;
  ar: string;
}

/**
 * Deliverable preset definition
 */
export interface DeliverablePreset {
  id: string;
  description: BilingualText;
  defaultQuantity?: number;
  defaultFormat?: string;
}

/**
 * Category-specific scope defaults
 */
export interface CategoryScopeDefaults {
  dependencies: BilingualText[];
  exclusions: BilingualText[];
  deliverablePresets: DeliverablePreset[];
}

/**
 * Map of category to scope defaults
 */
export type ScopePresetsMap = Record<EngagementCategory, CategoryScopeDefaults>;

/**
 * Get text in the specified language
 */
export function getText(text: BilingualText, language: EngagementLanguage): string {
  return text[language];
}
