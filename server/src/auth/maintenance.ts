import type { MiddlewareHandler } from 'hono';
import { ApiError } from '../errors.js';
import type { Logger } from '../logger.js';

export interface RequireNotInMaintenanceOptions {
  /** MAINTENANCE_MODE: read once at boot, like the minimum-build floors (a change is a new revision). */
  on: boolean;
  logger: Logger;
}

/**
 * MUT-551 (release gate RF-2): the phone app's maintenance switch. While MAINTENANCE_MODE is on, every phone request
 * (one carrying X-App-Platform, as for the minimum-build gate) answers 503 MAINTENANCE, sign-in included, and the app
 * shows its maintenance screen until a request gets through again. Runs before requireMinimumBuild, so a phone that
 * gets a 426 knows maintenance is off. The portal, API keys and /health are untouched.
 */
export function requireNotInMaintenance(options: RequireNotInMaintenanceOptions): MiddlewareHandler {
  return async (c, next) => {
    if (!options.on) return next();
    const platform = c.req.header('x-app-platform');
    if (platform !== 'ios' && platform !== 'android') return next();
    options.logger.info({ platform, path: c.req.path }, 'MAINTENANCE');
    throw new ApiError('MAINTENANCE', 'Mutaba3a is down for maintenance; try again in a few minutes');
  };
}
