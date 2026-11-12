/**
 * MUT-596 (MUT-595, ADR-254 D1): Sign in with Malafat, the portal's half. The person names their office once (its
 * Malafat address, remembered on this device), the browser goes to `/v1/auth/malafat/start`, Malafat, and back to
 * `/malafat/return` with `#result=` or `#error=` in the fragment, which never reaches a server log.
 */

/** Malafat's own domain for a firm's address; what a person may paste in full. */
export const MALAFAT_HOST_SUFFIX = '.malafat.app';
/** A firm's slug, as the server checks it (MUT-595 `MALAFAT_SLUG`). */
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const OFFICE_KEY = 'mtb3a.malafatOffice';

export const MALAFAT_START_PATH = '/v1/auth/malafat/start';

/**
 * What the person typed, as a slug: `sader`, `Sader`, `sader.malafat.app` and `https://sader.malafat.app/` are all
 * `sader`. Null when nothing like an office address is left.
 */
export function officeSlugOf(typed: string): string | null {
  let value = typed.trim().toLowerCase();
  value = value.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (value.endsWith(MALAFAT_HOST_SUFFIX)) value = value.slice(0, -MALAFAT_HOST_SUFFIX.length);
  return SLUG.test(value) ? value : null;
}

/** The office this device remembers; storage may be blocked (private windows), which reads as none. */
export function rememberedOffice(): string {
  try {
    return window.localStorage.getItem(OFFICE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function rememberOffice(slug: string): void {
  try {
    window.localStorage.setItem(OFFICE_KEY, slug);
  } catch {
    // Storage blocked: the person types it again next time.
  }
}

export function malafatStartUrl(slug: string): string {
  return `${MALAFAT_START_PATH}?${new URLSearchParams({ tenant: slug, client: 'web' }).toString()}`;
}

export type MalafatReturnError = 'access_denied' | 'malafat_unavailable' | 'state_invalid' | 'office_not_found';
const RETURN_ERRORS: readonly MalafatReturnError[] = ['access_denied', 'malafat_unavailable', 'state_invalid', 'office_not_found'];

/** `#result=…` or `#error=…` from the return; anything else (a reload, a hand-typed URL) is an expired sign-in. */
export function malafatReturnOf(hash: string): { result: string } | { error: MalafatReturnError } {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const result = params.get('result')?.trim();
  if (result) return { result };
  const error = params.get('error');
  return { error: RETURN_ERRORS.includes(error as MalafatReturnError) ? (error as MalafatReturnError) : 'state_invalid' };
}
