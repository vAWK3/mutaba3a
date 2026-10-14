/**
 * The path `src/main.tsx` matches the marketing pages (`/`, `/download`,
 * `/privacy`, `/hosted`) against: one trailing slash dropped, so a link that
 * gained one from a shortener or a paste still opens its page (MUT-186).
 */
export function marketingPath(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}
