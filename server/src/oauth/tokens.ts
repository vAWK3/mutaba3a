/**
 * MUT-434: the prefixes of what the OAuth server mints. Its own module with no imports, because the /v1 middleware
 * needs `isOAuthToken` and the portal's local mode bundles that middleware into the browser (MUT-286): nothing here
 * may pull in a Node built-in.
 */
export const OAUTH_TOKEN_PREFIX = { client: 'mcl_', code: 'mac_', access: 'mat_', refresh: 'mrt_' } as const;

export function isAccessToken(token: string): boolean {
  return token.startsWith(OAUTH_TOKEN_PREFIX.access);
}

/** Any credential this server mints, so /v1 can refuse it explicitly rather than try it as an API key. */
export function isOAuthToken(token: string): boolean {
  return token.startsWith(OAUTH_TOKEN_PREFIX.access) || token.startsWith(OAUTH_TOKEN_PREFIX.refresh);
}
