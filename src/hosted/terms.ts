import { APP_VERSION } from '../lib/appVersion';
import type { Language } from '../lib/i18n/types';

/**
 * MUT-324 (ADR-102): where the portal shows the terms. A build-time value read
 * through a typeof guard (ADR-076): the test runner defines none, so a test
 * stubs the global, and an unset build links nowhere rather than somewhere wrong.
 * With a version, the address is that version's frozen text, and `?lang` is the
 * portal's language: the landing opens in its own stored language otherwise, so
 * what a person reads is exactly what their acceptance records (version and locale).
 */
export function termsHref(language: Language, version?: string): string {
  const base = typeof __TERMS_URL__ !== 'undefined' ? __TERMS_URL__ : '';
  if (!base) return '';
  return `${version ? `${base}/${version}` : base}?lang=${language}`;
}

/**
 * MUT-354 (MUT-348 decision 1): the release each acceptance records, so it maps to
 * the git tag holding the page code: `web-v<x>` (ADR-081) of the version this build
 * reports. Sent as `clientRelease` by the setup page and the Updated-terms step.
 */
export const TERMS_CLIENT_RELEASE = `web-v${APP_VERSION}`;

/**
 * The address people write to for help (the pilot's support promise, MUT-323). MUT-382 (B2): MTB3A's own domain;
 * info@malafat.app keeps forwarding for older builds.
 */
export const SUPPORT_EMAIL = 'info@mtb3a.com';
