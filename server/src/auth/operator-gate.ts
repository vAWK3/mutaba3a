import type { MiddlewareHandler } from 'hono';
import { ApiError } from '../errors.js';
import type { AppEnv } from './middleware.js';
import { assertOperatorStepUp } from './step-up.js';

/**
 * MUT-459 (ADR-208): the gate on /v1/operator/*, mounted after the /v1 authenticate(), so a signed-out caller already
 * got its 401 there (the same answer every /v1 path gives, which says nothing about operators). Here:
 *
 *   - a signed-in person who isn't an operator gets 404, the same as a path that doesn't exist, and so does any
 *     session that isn't the portal's cookie (a phone's device token: review finding 3);
 *   - every write except the step-up's own two routes needs a fresh passkey step-up (step-up.ts).
 *
 * The operator mark is read from the user row authenticate() loaded for this request, so a revoke takes effect on the
 * operator's very next request, with no extra query.
 */
export const OPERATOR_STEP_UP_EXEMPT: ReadonlySet<string> = new Set(['/v1/operator/step-up/options', '/v1/operator/step-up']);

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function operatorGate(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const identity = c.get('identity');
    if (!identity?.user.operatorAt || identity.session.kind !== 'cookie') throw new ApiError('NOT_FOUND', 'Not found');
    if (!SAFE_METHODS.has(c.req.method) && !OPERATOR_STEP_UP_EXEMPT.has(c.req.path)) assertOperatorStepUp(identity.session, c.get('now')());
    await next();
  };
}
