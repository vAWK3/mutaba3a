import { HOSTED_OFFER_FILE, HOSTED_OFFER_URL } from '../../content/download-config';

/** The page copy's own addresses (with and without .html), which must show the offer, not the app. */
const HOSTED_OFFER_ALIASES = new Set([`/${HOSTED_OFFER_FILE}`, `/${HOSTED_OFFER_FILE.replace(/\.html$/, '')}`]);

/**
 * The path `src/main.tsx` matches the marketing pages (`/`, `/download`,
 * `/privacy`, `/terms`, `/hosted`) against: one trailing slash dropped, so a link that
 * gained one from a shortener or a paste still opens its page, and the
 * /hosted page copy's own file address reads as /hosted (MUT-186).
 */
export function marketingPath(pathname: string): string {
  const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  return HOSTED_OFFER_ALIASES.has(path) ? HOSTED_OFFER_URL : path;
}

/** The pages the website renders, as templates: a terms version never appears in one (MUT-150). */
export type LandingRoute = '/' | '/download' | '/privacy' | '/terms' | '/terms/:version';

/**
 * Which website page `pathname` is, or null for anything else: the one list of
 * landing pages (MUT-150 eng D7). `src/main.tsx` renders from it, and the
 * landing's error reports start, send and tag their route from it, so no page
 * can report from outside it. `/hosted` only redirects, so it is not one.
 */
export function landingRoute(pathname: string): LandingRoute | null {
  const path = marketingPath(pathname);
  if (path === '/' || path === '/download' || path === '/privacy' || path === '/terms') return path;
  if (path.startsWith('/terms/') && path.length > '/terms/'.length) return '/terms/:version';
  return null;
}
