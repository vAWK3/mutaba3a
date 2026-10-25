import { ApiError } from '../errors.js';
import type { Entitlement, EntitlementState } from './entitlement.js';

/**
 * MUT-361 (ADR-181, amending ADR-160 decision 4): the lapse gate, decided at the door. `authenticate()` applies it
 * once per session request, for a cookie session and a phone device session alike; an API key (Malafat) is never
 * gated. Pure: the middleware gathers the entitlements (coverage.ts), this decides.
 *
 *   request                                 rule
 *   ─────────────────────────────────────── ──────────────────────────────────────────────────────────────
 *   profile-scoped (X-Mutaba3a-Profile)     that profile's state: open → anything; read-only → safe methods;
 *                                           locked → only LOCKED_OPEN_ENDPOINTS (the records export)
 *   organization-independent, 'open'        never gated (identity, sessions, billing, fx, leaving a profile)
 *   organization-independent, 'person'      the person's standing: the best state across their profiles
 *   organization-independent, 'pathProfile' the state of the profile named in the path (members only)
 *
 * Nothing here deletes or hides a record: a refused request changes nothing, and the export always works.
 */

/** What a person may do on a profile, or across all of theirs. */
export type Standing = 'open' | 'read-only' | 'locked';
export type GateClass = 'open' | 'person' | 'pathProfile';

/** The only profile-scoped endpoints a LOCKED profile still answers (MUT-325's records export and its receipts). */
export const LOCKED_OPEN_ENDPOINTS: ReadonlySet<string> = new Set(['GET /v1/records-export', 'GET /v1/records-export/receipts/:receiptId']);

/**
 * Every organization-independent session endpoint, classified. A test walks the app's organization-independent set
 * and fails on any endpoint missing here, so a new person-level route can't slip past the gate unclassified.
 */
export const PERSON_LEVEL_GATE: Readonly<Record<string, GateClass>> = {
  // The identity row and the session: who the person is, signing out, their own preferences and the terms.
  'GET /v1/me': 'open',
  'PATCH /v1/me/malafat-suggestions': 'open',
  'PATCH /v1/me/trial-prompt': 'open',
  'POST /v1/me/terms-acceptance': 'open',
  'POST /v1/me/password': 'open',
  'DELETE /v1/sessions/current': 'open',
  'DELETE /v1/device-sessions/current': 'open',
  // Paying is how a lapse ends.
  'GET /v1/billing': 'open',
  'POST /v1/billing/checkout-session': 'open',
  'POST /v1/billing/portal-session': 'open',
  // Reference rates: no record of anyone's.
  'GET /v1/fx-rates': 'open',
  // MUT-115: a person's own passkeys are identity, like the password (the sign-in routes are public, never gated).
  'GET /v1/passkeys': 'open',
  'POST /v1/passkeys/creation-options': 'open',
  'POST /v1/passkeys': 'open',
  'PATCH /v1/passkeys/:passkeyId': 'open',
  'DELETE /v1/passkeys/:passkeyId': 'open',
  // MUT-370: the person's answer to the passkey suggestion, identity like the trial prompt.
  'PATCH /v1/me/passkey-prompt': 'open',
  // MUT-333: a locked or read-only person can always close their account, and keep it.
  'POST /v1/me/closure': 'open',
  'DELETE /v1/me/closure': 'open',
  // MUT-434: connecting or disconnecting an agent is identity, like passkeys: it writes no record. What the agent
  // writes is gated per profile at the tool (agentWriteGate, MUT-436); a lapsed person can always disconnect one.
  'GET /v1/oauth/requests/:requestId': 'open',
  'POST /v1/oauth/requests/:requestId/decision': 'open',
  'GET /v1/oauth/grants': 'open',
  'DELETE /v1/oauth/grants/:grantId': 'open',
  // D6: leaving a co-owned profile, or its creator removing someone, adds no record.
  'DELETE /v1/profiles/:profileId/owners/:userId': 'open',
  // D4: the person's own captures and their cross-profile feed, and a new profile of their own.
  'GET /v1/inbox': 'person',
  'GET /v1/inbox/count': 'person',
  'POST /v1/inbox': 'person',
  'PATCH /v1/inbox/:entryId': 'person',
  'DELETE /v1/inbox/:entryId': 'person',
  'GET /v1/entries': 'person',
  'POST /v1/profiles': 'person',
  // A profile's own settings follow that profile.
  'PATCH /v1/profiles/:profileId': 'pathProfile',
  'GET /v1/profiles/:profileId/type-change': 'pathProfile',
  'POST /v1/profiles/:profileId/firm-request': 'pathProfile',
};

const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

export function standingOf(state: EntitlementState): Standing {
  if (state === 'READ_ONLY') return 'read-only';
  if (state === 'LOCKED') return 'locked';
  return 'open';
}

const RANK: Record<Standing, number> = { open: 2, 'read-only': 1, locked: 0 };

/** The best standing across a person's profiles; open with none, so someone with no profile can still create one. */
export function personStanding(states: Iterable<EntitlementState>): Standing {
  let best: Standing | null = null;
  for (const state of states) {
    const standing = standingOf(state);
    if (best === null || RANK[standing] > RANK[best]) best = standing;
  }
  return best ?? 'open';
}

/** Whether the gate refuses `method` on a person-level or path-profile route at this standing. */
export function standingRefuses(standing: Standing, method: string): boolean {
  if (standing === 'open') return false;
  if (standing === 'locked') return true;
  return !SAFE_METHODS.has(method);
}

/** Whether the gate refuses `endpoint` (`METHOD /hono/:path`) on a profile-scoped route at this standing. */
export function profileGateRefuses(standing: Standing, method: string, endpoint: string): boolean {
  if (standing === 'locked') return !LOCKED_OPEN_ENDPOINTS.has(endpoint);
  return standingRefuses(standing, method);
}

/**
 * The refusal (D2, D3): 402 SUBSCRIPTION_LAPSED, one code with the state in its details. `until` is the lock date
 * while a trial is read-only, else null. `profileId` is null when the person's standing refused (no one profile).
 */
export function lapsedError(profileId: string | null, entitlement: Pick<Entitlement, 'state' | 'source' | 'until'>): ApiError {
  if (entitlement.state !== 'READ_ONLY' && entitlement.state !== 'LOCKED') throw new Error(`No lapse to report for ${entitlement.state}`);
  const message =
    entitlement.state === 'LOCKED'
      ? 'This account is locked until it is subscribed; only Subscribe and Download my records still work'
      : 'This profile is read-only: its plan has ended. Subscribe to add or change records; reading and the records export still work';
  return new ApiError('SUBSCRIPTION_LAPSED', message, {
    profileId,
    state: entitlement.state,
    source: entitlement.source,
    until: entitlement.until?.toISOString() ?? null,
  });
}
