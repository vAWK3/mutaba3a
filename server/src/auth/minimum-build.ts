import type { Context, MiddlewareHandler } from 'hono';
import { ApiError } from '../errors.js';
import type { Logger } from '../logger.js';
import { endpointKey, type RouteAccessIndex } from './middleware.js';

export type AppPlatform = 'ios' | 'android';

export interface PlatformBuildConfig {
  /** Hard floor. Undefined = this platform is never gated. */
  min?: number | undefined;
  /** Soft "update available" ceiling. Undefined = no nudge, only the hard floor (if any). */
  recommended?: number | undefined;
}

export interface MinimumBuildConfig {
  ios: PlatformBuildConfig;
  android: PlatformBuildConfig;
  /** MUT-293 safety valve: bypasses the whole check regardless of the floors above, independent of editing/redeploying them. */
  disabled: boolean;
}

export interface RequireMinimumBuildOptions {
  config: MinimumBuildConfig;
  /** Shared with authenticate() (MUT-293 eng review): the same index answers "is this route public" for both. */
  routeAccess: () => RouteAccessIndex;
  logger: Logger;
}

function isAppPlatform(value: string | undefined): value is AppPlatform {
  return value === 'ios' || value === 'android';
}

/**
 * MUT-293: tells an outdated phone build to update instead of letting it
 * silently mishandle something new. Scoped to the phone API only — a request
 * with no X-App-Platform header (the portal, or any build older than this
 * ticket, which never learned to send it) is invisible to this gate by
 * construction, not merely unenforced for it.
 */
export function requireMinimumBuild(options: RequireMinimumBuildOptions): MiddlewareHandler {
  return async (c: Context, next) => {
    const platformHeader = c.req.header('x-app-platform');
    if (!isAppPlatform(platformHeader)) return next();

    const endpoint = endpointKey(c);
    const access = endpoint ? options.routeAccess().get(endpoint) : undefined;
    if (access?.public) return next();

    if (options.config.disabled) return next();

    const { min: floor, recommended } = options.config[platformHeader];
    if (floor === undefined) return next();

    const buildHeader = c.req.header('x-app-build');
    const parsed = buildHeader ? Number.parseInt(buildHeader, 10) : NaN;
    // A declared platform with no (or malformed) build number can't prove it meets the floor — treat as build 0.
    const build = Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;

    if (build < floor) {
      options.logger.warn({ platform: platformHeader, build, minimumBuild: floor, path: c.req.path }, 'APP_UPDATE_REQUIRED');
      throw new ApiError('APP_UPDATE_REQUIRED', 'This app version is no longer supported; update to continue', {
        platform: platformHeader,
        minimumBuild: floor,
      });
    }

    if (recommended !== undefined && build < recommended) {
      c.header('X-Update-Available', 'true');
      c.header('X-Recommended-Build', String(recommended));
    }

    return next();
  };
}
