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
    en: '92c4ede3d4dee929c66205d7c90f83883c5677f12ced4e2bd45b1c43355377f1',
    ar: '61b3bafe15f604819e55cdcc1f5ecf22d965eec43e6493369bfec2d741be042f',
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
