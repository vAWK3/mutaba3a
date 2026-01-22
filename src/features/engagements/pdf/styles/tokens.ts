import type { EngagementLanguage } from '../../types';

// Font families by language (serif for professional letter look)
export const FONTS = {
  en: { body: 'SourceSerif4', mono: 'IBMPlexSans' },
  ar: { body: 'Amiri', mono: 'IBMPlexSansArabic' },
};

// Font sizes in points
export const SIZES = {
  // Letter body text
  letterBody: 11,
  letterSmall: 10,

  // Schedule/table text
  scheduleBody: 10,
  scheduleSmall: 9,

  // Clause text (legal terms)
  clauseBody: 9,
  clauseTitle: 10,

  // Header elements
  headerBusiness: 14,
  headerDetail: 8,

  // Page number
  pageNumber: 9,

  // Titles
  documentTitle: 18,
  sectionTitle: 12,
  scheduleTitle: 11,
};

// Page dimensions (A4 in points: 595 x 842)
export const PAGE = {
  paddingTop: 44,
  paddingBottom: 54,
  paddingLeft: 52,
  paddingRight: 52,
  headerHeight: 70,
  footerHeight: 36,

  // With header, content starts lower
  contentStartWithHeader: 90,
  contentStartNoHeader: 44,
};

// Spacing values in points
export const SPACING = {
  // Paragraph spacing
  paragraph: 8,
  paragraphLarge: 12,

  // Section spacing
  section: 16,
  sectionLarge: 24,

  // List spacing
  listItem: 4,
  listIndent: 16,

  // Table spacing
  tableCellPadding: 6,
  tableRowGap: 0,
};

// Colors
export const COLORS = {
  text: '#111111',
  textMuted: '#666666',
  textLight: '#888888',
  border: '#e5e7eb',
  borderLight: '#f0f0f0',
  background: '#ffffff',
  backgroundMuted: '#f9f9f9',
};

// Border widths
export const BORDERS = {
  thin: 0.5,
  regular: 1,
  thick: 2,
};

// Helper to get font family for a language
export function getBodyFont(language: EngagementLanguage): string {
  return language === 'ar' ? FONTS.ar.body : FONTS.en.body;
}

export function getMonoFont(language: EngagementLanguage): string {
  return language === 'ar' ? FONTS.ar.mono : FONTS.en.mono;
}
