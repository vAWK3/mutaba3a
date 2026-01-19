/**
 * Vendor Normalization Utilities
 *
 * Provides functions to normalize vendor names and calculate similarity
 * for matching and deduplication purposes.
 */

// Common business suffixes to remove during normalization
const BUSINESS_SUFFIXES = [
  'llc',
  'inc',
  'inc.',
  'ltd',
  'ltd.',
  'corp',
  'corp.',
  'corporation',
  'company',
  'co',
  'co.',
  'llp',
  'plc',
  'gmbh',
  'ag',
  'sa',
  'sarl',
  'בע״מ',
  'בע"מ',
  'בעמ',
];

// Common prefixes to remove
const COMMON_PREFIXES = ['the'];

/**
 * Normalizes a vendor name for comparison and matching.
 *
 * Steps:
 * 1. Convert to lowercase
 * 2. Trim whitespace
 * 3. Remove common punctuation
 * 4. Collapse multiple whitespace
 * 5. Remove business suffixes (LLC, Inc, Ltd, etc.)
 * 6. Remove common prefixes (The, etc.)
 *
 * @param raw - The raw vendor name
 * @returns The normalized vendor name
 */
export function normalizeVendor(raw: string): string {
  if (!raw) return '';

  let normalized = raw
    // Convert to lowercase
    .toLowerCase()
    // Trim whitespace
    .trim()
    // Remove common punctuation but keep spaces
    .replace(/[.,;:!?'"()[\]{}@#$%^&*+=<>\\|`~]/g, '')
    // Replace hyphens and underscores with spaces
    .replace(/[-_]/g, ' ')
    // Collapse multiple whitespace into single space
    .replace(/\s+/g, ' ')
    .trim();

  // Remove business suffixes
  for (const suffix of BUSINESS_SUFFIXES) {
    const suffixPattern = new RegExp(`\\s+${escapeRegex(suffix)}$`, 'i');
    normalized = normalized.replace(suffixPattern, '');
  }

  // Remove common prefixes
  for (const prefix of COMMON_PREFIXES) {
    const prefixPattern = new RegExp(`^${escapeRegex(prefix)}\\s+`, 'i');
    normalized = normalized.replace(prefixPattern, '');
  }

  return normalized.trim();
}

/**
 * Calculates the Levenshtein distance between two strings.
 *
 * @param a - First string
 * @param b - Second string
 * @returns The edit distance between the strings
 */
function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];

  // Initialize first column
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  // Initialize first row
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  // Fill in the rest of the matrix
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1 // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calculates the similarity between two vendor names.
 *
 * Uses Levenshtein distance normalized to a 0-1 scale where:
 * - 1.0 = exact match
 * - 0.0 = completely different
 *
 * Both strings are normalized before comparison.
 *
 * @param a - First vendor name
 * @param b - Second vendor name
 * @returns Similarity score between 0 and 1
 */
export function vendorSimilarity(a: string, b: string): number {
  const normalizedA = normalizeVendor(a);
  const normalizedB = normalizeVendor(b);

  if (normalizedA === normalizedB) return 1.0;
  if (!normalizedA || !normalizedB) return 0.0;

  const distance = levenshteinDistance(normalizedA, normalizedB);
  const maxLength = Math.max(normalizedA.length, normalizedB.length);

  // Normalize to 0-1 scale (1 = identical, 0 = completely different)
  return 1 - distance / maxLength;
}

/**
 * Checks if two vendor names are likely the same vendor.
 *
 * @param a - First vendor name
 * @param b - Second vendor name
 * @param threshold - Similarity threshold (default: 0.8)
 * @returns True if the vendors are likely the same
 */
export function isSameVendor(a: string, b: string, threshold = 0.8): boolean {
  return vendorSimilarity(a, b) >= threshold;
}

/**
 * Finds the best matching vendor from a list of candidates.
 *
 * @param target - The vendor name to match
 * @param candidates - List of candidate vendor names
 * @param threshold - Minimum similarity threshold (default: 0.8)
 * @returns The best match and its score, or null if no match above threshold
 */
export function findBestVendorMatch(
  target: string,
  candidates: string[],
  threshold = 0.8
): { name: string; score: number } | null {
  if (!target || candidates.length === 0) return null;

  let bestMatch: { name: string; score: number } | null = null;

  for (const candidate of candidates) {
    const score = vendorSimilarity(target, candidate);
    if (score >= threshold && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { name: candidate, score };
    }
  }

  return bestMatch;
}

/**
 * Escapes special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Suggests a canonical name from raw vendor input.
 * Capitalizes first letter of each word for display.
 *
 * @param raw - The raw vendor name
 * @returns A suggested canonical name
 */
export function suggestCanonicalName(raw: string): string {
  const normalized = normalizeVendor(raw);
  if (!normalized) return '';

  // Title case each word
  return normalized
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
