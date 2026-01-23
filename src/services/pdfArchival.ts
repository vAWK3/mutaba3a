/**
 * PDF Archival Service for Tauri Desktop Builds
 *
 * This service handles saving PDF files to disk when running in a Tauri environment.
 * For web builds, all operations gracefully return undefined.
 *
 * Directory Structure:
 * Documents/Mutaba3a/{sanitizedProfileName}/{year}/{documentNumber}.pdf
 *
 * Versioning:
 * - First export: INV-0001.pdf
 * - Subsequent exports: INV-0001_v2.pdf, INV-0001_v3.pdf, etc.
 */

import { isTauri } from '../lib/platform';

/**
 * Sanitize a string to be safe for use in file paths.
 * Removes or replaces characters that are problematic in file systems.
 */
function sanitizeForPath(input: string): string {
  return input
    .replace(/[<>:"/\\|?*]/g, '') // Remove Windows-forbidden characters
    .replace(/\s+/g, ' ')          // Normalize whitespace
    .trim()
    .slice(0, 100);                // Limit length
}

/**
 * Extract year from an ISO date string.
 */
function extractYear(isoDate: string): string {
  return isoDate.slice(0, 4);
}

/**
 * Build the directory path for storing documents.
 * @param profileName Business profile name (will be sanitized)
 * @param issueDate ISO date string
 * @returns Path segments for the directory
 */
function buildDirectoryPath(profileName: string, issueDate: string): string[] {
  const sanitizedProfile = sanitizeForPath(profileName) || 'Default';
  const year = extractYear(issueDate);
  return ['Mutaba3a', sanitizedProfile, year];
}

/**
 * Build the full file name for a document with optional version suffix.
 * @param documentNumber Document number (e.g., "INV-0001")
 * @param version PDF version number (1 = no suffix, 2+ = _v2, _v3, etc.)
 * @returns Sanitized file name with .pdf extension
 */
function buildFileName(documentNumber: string, version: number = 1): string {
  const sanitized = sanitizeForPath(documentNumber) || 'document';
  if (version <= 1) {
    return `${sanitized}.pdf`;
  }
  return `${sanitized}_v${version}.pdf`;
}

/**
 * Save a PDF blob to disk using Tauri's filesystem API.
 * Returns undefined for web builds (graceful skip).
 *
 * @param blob PDF blob to save
 * @param profileName Business profile name (for directory structure)
 * @param issueDate ISO date string (for year-based organization)
 * @param documentNumber Document number (for file name)
 * @param version PDF version number (1 = no suffix, 2+ = _v2, _v3, etc.)
 * @returns Full path where file was saved, or undefined if not in Tauri
 */
export async function savePdfToDisk(
  blob: Blob,
  profileName: string,
  issueDate: string,
  documentNumber: string,
  version: number = 1
): Promise<string | undefined> {
  // Gracefully skip for web builds
  if (!isTauri()) {
    return undefined;
  }

  try {
    // Dynamic import of Tauri plugin - use string concatenation to bypass Vite's static analysis
    const moduleName = '@tauri-apps/' + 'plugin-fs';
    const { writeFile, mkdir, BaseDirectory } = await import(/* @vite-ignore */ moduleName);

    // Build path segments
    const dirSegments = buildDirectoryPath(profileName, issueDate);
    const fileName = buildFileName(documentNumber, version);

    // Create directory structure
    const dirPath = dirSegments.join('/');
    await mkdir(dirPath, { baseDir: BaseDirectory.Document, recursive: true });

    // Convert blob to Uint8Array
    const arrayBuffer = await blob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    // Build full path
    const fullPath = `${dirPath}/${fileName}`;

    // Write file
    await writeFile(fullPath, uint8Array, { baseDir: BaseDirectory.Document });

    // Return the conceptual path (user's Documents folder + our path)
    // Note: We don't have access to the actual absolute path easily,
    // so we return a relative path from Documents
    return `Documents/${fullPath}`;
  } catch (error) {
    // Log error but don't throw - disk save is a nice-to-have
    console.error('Failed to save PDF to disk:', error);
    return undefined;
  }
}

/**
 * Check if PDF archival is available (i.e., running in Tauri).
 */
export function isPdfArchivalAvailable(): boolean {
  return isTauri();
}

/**
 * Get the expected path where a document would be saved.
 * Useful for display purposes.
 *
 * @param profileName Business profile name
 * @param issueDate ISO date string
 * @param documentNumber Document number
 * @param version PDF version number (1 = no suffix, 2+ = _v2, _v3, etc.)
 */
export function getExpectedPath(
  profileName: string,
  issueDate: string,
  documentNumber: string,
  version: number = 1
): string {
  const dirSegments = buildDirectoryPath(profileName, issueDate);
  const fileName = buildFileName(documentNumber, version);
  return `Documents/${dirSegments.join('/')}/${fileName}`;
}

/**
 * Check if a PDF file exists at the expected path.
 * Returns false for web builds.
 *
 * @param profileName Business profile name
 * @param issueDate ISO date string
 * @param documentNumber Document number
 * @param version PDF version number
 */
export async function checkPdfExists(
  profileName: string,
  issueDate: string,
  documentNumber: string,
  version: number = 1
): Promise<boolean> {
  if (!isTauri()) {
    return false;
  }

  try {
    const moduleName = '@tauri-apps/' + 'plugin-fs';
    const { exists, BaseDirectory } = await import(/* @vite-ignore */ moduleName);

    const dirSegments = buildDirectoryPath(profileName, issueDate);
    const fileName = buildFileName(documentNumber, version);
    const fullPath = `${dirSegments.join('/')}/${fileName}`;

    return await exists(fullPath, { baseDir: BaseDirectory.Document });
  } catch {
    return false;
  }
}
