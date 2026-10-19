import type { SessionKind } from './auth/sessions.js';

/**
 * MUT-324 (ADR-102): the terms of service a person accepts.
 *
 * The text is the landing's frozen content file
 * `src/content/legal/terms/<version>.<locale>.json`, served at `/terms/<version>`
 * and never edited once released: a new text is a new version. These are its
 * sha256 fingerprints, pinned to the files by `scripts/__tests__/legal-terms.test.ts`,
 * so an acceptance can always be tied to the exact words it accepted.
 * The server release (`scripts/preflight.sh server`, then `server/scripts/deploy.sh`) refuses
 * a version the public site does not yet list in `/legal/terms-versions.json` (web first).
 *
 * Versions are ISO dates, so comparing them as strings orders them by release.
 */
export const TERMS_LOCALES = ['en', 'ar'] as const;
export type TermsLocale = (typeof TERMS_LOCALES)[number];

export interface CurrentTerms {
  version: string;
  sha256: Readonly<Record<TermsLocale, string>>;
}

export const CURRENT_TERMS: CurrentTerms = {
  version: '2026-10-19',
  sha256: {
    en: '2ed299dc133d011452175ef182ae3701ab126dc8a316d0c3befe49c4833c864c',
    ar: '7f997e6b13e6a7ed0259f71523c8c2e5b0a8ead0ed9a405be6851753b77272cc',
  },
};

/** The shape of a terms version: an ISO date. */
export const TERMS_VERSION_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * D10: a person has accepted when their latest accepted version is the current one or newer,
 * so an API rollback, or an old and a new revision answering side by side, never asks again.
 */
export function termsAccepted(latestVersion: string | null, currentVersion: string): boolean {
  return latestVersion !== null && latestVersion >= currentVersion;
}

/** Where an acceptance happened. A session knows only cookie or device, not which phone (MUT-324 C7). */
export type TermsSurface = 'portal' | 'phone';

export const TERMS_SURFACE_OF: Readonly<Record<SessionKind, TermsSurface>> = { cookie: 'portal', device: 'phone' };
