/**
 * The portal origin the website's sign-in and signup links open (MUT-187, MUT-369).
 * The free web app's "Go hosted" card that this file also held is retired with
 * the app (MUT-445).
 */

/** The portal origin (MUTABA3A_PORTAL_URL), or "" where the build set none. */
export function hostedPortalUrl(): string {
  return typeof __PORTAL_URL__ !== 'undefined' ? __PORTAL_URL__ : '';
}
