import type { EngagementSnapshot, EngagementLanguage } from '../../types';
import { clausesEn } from './clauses.en';
import { clausesAr } from './clauses.ar';

// Re-export types
export type {
  ClauseSubsection,
  ClauseSection,
  LegalClausesConfig,
  ClauseVariables,
} from './types';

import type { ClauseSection, LegalClausesConfig, ClauseVariables } from './types';

// ============================================================================
// Toggle-to-Section Mapping
// ============================================================================

/**
 * Maps toggle keys from EngagementSnapshot to their behavior:
 * - toggleKey matches a boolean field in snapshot
 * - If the toggle is true, the section is included
 * - Sections without toggleKey are always included
 */
export const TOGGLE_TO_SECTIONS: Record<string, string[]> = {
  ipOwnership: ['5'],
  confidentiality: ['6', '7'],
  limitationOfLiability: ['8'],
  nonSolicitation: ['9'],
  // Sections 10, 11, 12 are always included (no toggleKey)
};

// ============================================================================
// Utilities
// ============================================================================

/**
 * Format a date string for display in legal documents
 */
function formatLegalDate(dateString?: string): string {
  if (!dateString) return '_______________';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * Build clause variables from an engagement snapshot
 */
export function buildClauseVariables(snapshot: EngagementSnapshot): ClauseVariables {
  return {
    serviceprovider: snapshot.profileName || 'Service Provider',
    company: snapshot.clientName || 'Client',
    effectivedate: formatLegalDate(snapshot.startDate),
    terminationdate: formatLegalDate(snapshot.endDate),
    noticeperiod: String(snapshot.terminationNoticeDays || 14),
    governinglaw: snapshot.governingLaw || 'the applicable jurisdiction',
    supportperiod: 'six (6) months',
  };
}

/**
 * Interpolate variables into clause text
 * Replaces {variablename} with actual values (case-insensitive)
 */
export function interpolateClause(text: string, vars: ClauseVariables): string {
  return Object.entries(vars).reduce(
    (result, [key, value]) =>
      result.replace(new RegExp(`\\{${key}\\}`, 'gi'), String(value ?? '')),
    text
  );
}

/**
 * Get clauses configuration for a specific language
 */
export function getClausesForLanguage(language: EngagementLanguage): LegalClausesConfig {
  return language === 'ar' ? clausesAr : clausesEn;
}

/**
 * Filter sections based on engagement toggles
 * Returns only sections that should be included based on toggle values
 */
export function getActiveSections(
  config: LegalClausesConfig,
  snapshot: EngagementSnapshot
): ClauseSection[] {
  return config.sections.filter((section) => {
    // If section has no toggleKey, it's always included
    if (!section.toggleKey) return true;

    // Check if the toggle is enabled in the snapshot
    const toggleValue = snapshot[section.toggleKey as keyof EngagementSnapshot];
    return Boolean(toggleValue);
  });
}

/**
 * Process all sections: filter by toggles and interpolate variables
 */
export function processClausesForPdf(
  language: EngagementLanguage,
  snapshot: EngagementSnapshot
): ClauseSection[] {
  const config = getClausesForLanguage(language);
  const activeSections = getActiveSections(config, snapshot);
  const variables = buildClauseVariables(snapshot);

  // Deep clone and interpolate all text
  return activeSections.map((section) => ({
    ...section,
    title: interpolateClause(section.title, variables),
    subsections: section.subsections.map((sub) => ({
      ...sub,
      title: sub.title ? interpolateClause(sub.title, variables) : undefined,
      content: interpolateClause(sub.content, variables),
    })),
  }));
}
