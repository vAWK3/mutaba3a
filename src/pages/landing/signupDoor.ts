import { useEffect, useState } from 'react';
import { hostedPortalUrl } from '../../lib/goHosted';

/**
 * MUT-369 (D1–D3, D17): whether the landing shows "Create an account" (and, MUT-731, describes the free Starter
 * plan). The server decides: the portal's `GET /v1/self-service` says `signup: true` only while signup is switched on
 * and mail really goes out (MUT-368), and `starterPlan: true` only while STARTER_PLAN is on, so neither can drift from
 * its switch and neither needs a web release. Closed is the default and today's page: no
 * portal URL (tests, desktop), an error, an odd body or a slow server all leave the request form as the way in.
 *
 * Landing code only: the local app never imports this (ADR-024).
 */

/** A slow server reads as closed after this long, so the page never waits on it. */
export const SIGNUP_DOOR_TIMEOUT_MS = 3000;

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** What the landing reads from the portal's doors: signup (MUT-369) and the free Starter plan (MUT-731). */
export interface LandingDoors {
  signup: boolean;
  starterPlan: boolean;
}

const CLOSED: LandingDoors = { signup: false, starterPlan: false };

/**
 * Asks the portal which doors are open. Each is open only on a clear `true`; anything else reads as today's page.
 * The request must stay CORS-"simple" (a GET, no credentials, no custom headers): the server answers
 * `Access-Control-Allow-Origin: *` and no preflight. Adding Sentry tracing with the portal in `tracePropagationTargets`
 * would add headers, force a preflight, and keep this closed for good.
 */
export async function fetchDoors(portalUrl: string, fetchFn: FetchLike = fetch): Promise<LandingDoors> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), SIGNUP_DOOR_TIMEOUT_MS);
  try {
    const res = await fetchFn(`${portalUrl}/v1/self-service`, { credentials: 'omit', cache: 'no-store', signal: abort.signal });
    if (!res.ok) return CLOSED;
    const body: unknown = await res.json();
    if (typeof body !== 'object' || body === null) return CLOSED;
    const doors = body as { signup?: unknown; starterPlan?: unknown };
    return { signup: doors.signup === true, starterPlan: doors.starterPlan === true };
  } catch {
    return CLOSED;
  } finally {
    clearTimeout(timer);
  }
}

let asked: Promise<LandingDoors> | null = null;

/** One question per page load, shared by every part of the page. */
export function doorsOnce(portalUrl: string, fetchFn?: FetchLike): Promise<LandingDoors> {
  asked ??= fetchDoors(portalUrl, fetchFn);
  return asked;
}

export function resetSignupDoorForTests() {
  asked = null;
}

/** The portal's signup page in the page's language (MUT-369 AC1; the portal reads `?lang`, D5). */
export function signupHref(portalUrl: string, language: 'en' | 'ar'): string {
  return `${portalUrl}/signup?lang=${language}`;
}

/**
 * The signup link while signup is open, else null (today's page); and whether the page describes the free Starter
 * plan, which it does only while someone could sign up for it.
 */
export function useLandingDoors(language: 'en' | 'ar'): { signupUrl: string | null; starter: boolean } {
  const portalUrl = hostedPortalUrl();
  const [doors, setDoors] = useState<LandingDoors>(CLOSED);

  useEffect(() => {
    if (!portalUrl) return;
    let live = true;
    void doorsOnce(portalUrl).then((answer) => {
      if (live && answer.signup) setDoors(answer);
    });
    return () => {
      live = false;
    };
  }, [portalUrl]);

  const signupUrl = doors.signup && portalUrl ? signupHref(portalUrl, language) : null;
  return { signupUrl, starter: signupUrl !== null && doors.starterPlan };
}
