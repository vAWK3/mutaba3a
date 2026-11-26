import type { Context } from 'hono';
import { matchedRoutes } from 'hono/route';
import { endpointKey } from '../auth/middleware.js';

/** No route matched the request: every such path shares this one key (never the raw path). */
export const UNMATCHED_ROUTE = 'UNMATCHED';

/**
 * MUT-735 (ADR-281): the route template a request is counted under, e.g. `POST /v1/issued-documents`: the matched
 * OpenAPI route (`endpointKey`), else an `app.all` route's own path (where endpointKey is null), else UNMATCHED. Never
 * the raw path, so no id ever lands in the statistics.
 */
export function routeKeyOf(c: Context): string {
  const endpoint = endpointKey(c);
  if (endpoint) return endpoint;
  const all = matchedRoutes(c).find((r) => r.method === 'ALL' && !r.path.endsWith('*'));
  return all ? `${c.req.method} ${all.path}` : UNMATCHED_ROUTE;
}
