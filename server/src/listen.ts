import { serve } from '@hono/node-server';
import type { ServerType } from '@hono/node-server';
import type { AddressInfo } from 'node:net';
import type { Config } from './config.js';

type Fetch = Parameters<typeof serve>[0]['fetch'];

/**
 * MUT-463: the one place the API starts listening, shared by index.ts and its socket test. HOST unset passes no
 * hostname, so Node binds every interface (`::`, IPv4 and IPv6), as Cloud Run needs; never default it to 0.0.0.0.
 */
export function startServer(
  fetch: Fetch,
  config: Pick<Config, 'PORT' | 'HOST'>,
  onListening?: (info: AddressInfo) => void,
): ServerType {
  return serve({ fetch, port: config.PORT, ...(config.HOST ? { hostname: config.HOST } : {}) }, onListening);
}
