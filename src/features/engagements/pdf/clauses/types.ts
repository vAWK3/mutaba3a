/**
 * A subsection within a legal clause section (e.g., 5.1, 5.2)
 */
export interface ClauseSubsection {
  id: string;           // "5.1", "5.2", etc.
  title?: string;       // Optional subtitle (e.g., "Work Product")
  content: string;      // Full legal text with {variables}
}

/**
 * A main legal clause section (e.g., Section 5: Intellectual Property)
 */
export interface ClauseSection {
  id: string;           // "5", "6", etc.
  title: string;        // "Intellectual Property"
  toggleKey?: string;   // Maps to EngagementSnapshot toggle field
  subsections: ClauseSubsection[];
}

/**
 * Configuration for all legal clauses in a language
 */
export interface LegalClausesConfig {
  version: string;
  sections: ClauseSection[];
}

/**
 * Variables available for interpolation in clause text
 */
export interface ClauseVariables {
  serviceprovider: string;
  company: string;
  effectivedate: string;
  terminationdate: string;
  noticeperiod: string;
  governinglaw: string;
  supportperiod: string;
}
