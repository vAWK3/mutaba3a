/**
 * MUT-324 (ADR-102): where the portal shows the terms. A build-time value read
 * through a typeof guard (ADR-076): the test runner defines none, so a test
 * stubs the global, and an unset build links nowhere rather than somewhere wrong.
 * With a version, the address is that version's frozen text, so what a person
 * reads is exactly what their acceptance records.
 */
export function termsHref(version?: string): string {
  const base = typeof __TERMS_URL__ !== 'undefined' ? __TERMS_URL__ : '';
  if (!base) return '';
  return version ? `${base}/${version}` : base;
}

/** The address people write to for help, and to close their account (the pilot's support promise, MUT-323). */
export const SUPPORT_EMAIL = 'info@malafat.app';
