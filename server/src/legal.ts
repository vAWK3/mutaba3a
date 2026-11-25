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
  version: '2026-10-26',
  sha256: {
    en: 'c81b2eaa8d880f8a2742e6aa588de421fbb0491828f7b45fa142b74fe9663669',
    ar: 'b5362228222b06304e81f3fe91d932b0c43a2e8360a368aab029753db15e8b88',
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

/**
 * MUT-354 (MUT-348 decision 1): the client release that showed the terms, recorded with each acceptance so it maps
 * to the git tag holding the page code (`web-v0.1.16` from the portal; the phone's version+build, MUT-344). Stored as
 * sent, never trusted for anything else. Printable ASCII with no spaces, so the operator's terms report can't be fed
 * terminal escapes; at most CLIENT_RELEASE_MAX characters, the column's width.
 */
export const CLIENT_RELEASE_MAX = 64;
export const CLIENT_RELEASE_PATTERN = /^[\x21-\x7E]+$/;
