import { useEffect, useState } from 'react';
import { hostedPortalUrl } from '../../lib/goHosted';

/**
 * MUT-369 (D1–D3, D17): whether the landing shows "Create an account". The server decides: the portal's
 * `GET /v1/self-service` says `signup: true` only while signup is switched on and mail really goes out (MUT-368), so
 * the button can't drift from the switch and GA needs no web release. Closed is the default and today's page: no
 * portal URL (tests, desktop), an error, an odd body or a slow server all leave the request form as the way in.
 *
 * Landing code only: the local app never imports this (ADR-024).
 */

/** A slow server reads as closed after this long, so the page never waits on it. */
export const SIGNUP_DOOR_TIMEOUT_MS = 3000;

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Asks the portal whether signup is open. The request must stay CORS-"simple" (a GET, no credentials, no custom
 * headers): the server answers `Access-Control-Allow-Origin: *` and no preflight. Adding Sentry tracing with the
 * portal in `tracePropagationTargets` would add headers, force a preflight, and keep this closed for good.
 */
export async function fetchSignupOpen(portalUrl: string, fetchFn: FetchLike = fetch): Promise<boolean> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), SIGNUP_DOOR_TIMEOUT_MS);
  try {
    const res = await fetchFn(`${portalUrl}/v1/self-service`, { credentials: 'omit', cache: 'no-store', signal: abort.signal });
    if (!res.ok) return false;
    const body: unknown = await res.json();
    return typeof body === 'object' && body !== null && (body as { signup?: unknown }).signup === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

let asked: Promise<boolean> | null = null;

/** One question per page load, shared by every part of the page. */
export function signupOpenOnce(portalUrl: string, fetchFn?: FetchLike): Promise<boolean> {
  asked ??= fetchSignupOpen(portalUrl, fetchFn);
  return asked;
}

export function resetSignupDoorForTests() {
  asked = null;
}

/** The portal's signup page in the page's language (MUT-369 AC1; the portal reads `?lang`, D5). */
export function signupHref(portalUrl: string, language: 'en' | 'ar'): string {
  return `${portalUrl}/signup?lang=${language}`;
}

/** The signup link while signup is open, else null (today's page). */
export function useSignupUrl(language: 'en' | 'ar'): string | null {
  const portalUrl = hostedPortalUrl();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!portalUrl) return;
    let live = true;
    void signupOpenOnce(portalUrl).then((isOpen) => {
      if (live && isOpen) setOpen(true);
    });
    return () => {
      live = false;
    };
  }, [portalUrl]);

  return open && portalUrl ? signupHref(portalUrl, language) : null;
}
