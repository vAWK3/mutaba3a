import { HOSTED_OFFER_FILE, HOSTED_OFFER_URL } from '../../content/download-config';

/** The page copy's own addresses (with and without .html), which must show the offer, not the app. */
const HOSTED_OFFER_ALIASES = new Set([`/${HOSTED_OFFER_FILE}`, `/${HOSTED_OFFER_FILE.replace(/\.html$/, '')}`]);

/**
 * The path `src/main.tsx` matches the marketing pages (`/`, `/download`,
 * `/privacy`, `/hosted`) against: one trailing slash dropped, so a link that
 * gained one from a shortener or a paste still opens its page, and the
 * /hosted page copy's own file address reads as /hosted (MUT-186).
 */
export function marketingPath(pathname: string): string {
  const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  return HOSTED_OFFER_ALIASES.has(path) ? HOSTED_OFFER_URL : path;
}
