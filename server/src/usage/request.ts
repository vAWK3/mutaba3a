import type { Context } from 'hono';
import type { AppEnv } from '../auth/middleware.js';
import type { LedgerStore, Organization, UsageStamp } from '../repositories/ports.js';
import type { DoorPrincipal } from './kinds.js';
import { usageStampFor } from './plan-of.js';

/**
 * MUT-735 (ADR-281): the usage stamp for a metered action on the request's selected profile (session or API key),
 * built lazily so a replay that meters nothing reads nothing. It also tells the access log the payer's plan
 * (`meterPlan`) for the route statistics, at no extra read.
 */
export function requestUsage(store: Pick<LedgerStore, 'billing' | 'memberships' | 'organizations' | 'integrations'>, c: Context<AppEnv>, organization: Organization): () => Promise<UsageStamp> {
  return async () => {
    const auth = c.get('auth');
    const principal: DoorPrincipal = auth.kind === 'apiKey' ? { kind: 'apiKey' } : { kind: 'session', sessionKind: auth.session?.kind ?? null, delegated: auth.via !== null };
    const stamp = await usageStampFor(
      store,
      { organization, principal, actorUserId: auth.kind === 'session' ? auth.user.id : null, writerOfRecord: auth.kind === 'session' ? auth.writerOfRecord : null },
      c.get('now')(),
    );
    c.set('meterPlan', stamp.plan);
    return stamp;
  };
}
