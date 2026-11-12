import { PERSON_OR_MALAFAT } from './security.js';
import type { DelegatedVia } from '../auth/delegation.js';
import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { AppEnv } from '../auth/middleware.js';
import { entitlementsWithFactsFor, memberProfilesForBilling, serializeEntitlement } from '../billing/coverage.js';
import { ACCOUNTANT_PLAN_OFF, clientBooksSummaryOf, clientCapOf, resolveAccountantPlan, type AccountantPlan, type AccountantPlanConfig } from '../billing/accountant-plan.js';
import { personStanding } from '../billing/gate.js';
import { resolveTrialPrompt } from '../billing/trial-prompt.js';
import { passkeyPromptView } from '../auth/passkey-prompt.js';
import { termsAccepted, type CurrentTerms } from '../legal.js';
import { resolveMalafatSuggestions } from '../malafat-suggestions.js';
import { SUPPORTED_CURRENCIES } from '../money.js';
import type { LedgerStore, UserRecord } from '../repositories/ports.js';
import { ErrorEnvelopeSchema, MeSchema } from '../schemas.js';
import { ownsProfile } from '../personal-profile.js';
import { hostedProfileFor } from '../serializers.js';
import { MAX_OWNED_PROFILES, ownedProfileCap } from './profiles.js';
import { clientBooksOf } from '../accountants/grants.js';

/** MUT-370 (D9): `buildMe`'s `passkeysAt`: the request's clock where this server offers passkeys, else null. */
export const passkeysClockOf = (c: Context<AppEnv>): Date | null => (c.get('passkeys') ? c.get('now')() : null);

/** GET /v1/me, acting on the person rather than an organization: no X-Mutaba3a-Profile. */
export const ME_ORGANIZATION_INDEPENDENT_ROUTES: ReadonlySet<string> = new Set(['GET /v1/me']);

const errorResponse = (description: string) => ({ description, content: { 'application/json': { schema: ErrorEnvelopeSchema } } });

/**
 * The signed-in person and the hosted profiles they may open (MUT-38,
 * hosted-portal.md §4, §6). Split out of routes/sessions.ts (MUT-286) so the
 * portal's local-mode backend can register it without pulling in sign-in,
 * which needs argon2 and never applies there.
 */
export function meRoutes(store: LedgerStore, terms: CurrentTerms | null, billing: boolean): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/me',
      tags: ['Sessions'],
      summary: 'The signed-in person and the hosted profiles they may open',
      description: 'MUT-593: under a delegated token (Malafat acting as the person), only the profile its Malafat tenant names, and nothing of the person’s own (no client books, billing standing or operator flag).',
      security: PERSON_OR_MALAFAT,
      responses: {
        200: { description: 'Me', content: { 'application/json': { schema: MeSchema } } },
        401: errorResponse('No valid session'),
        403: errorResponse('PRINCIPAL_NOT_ACCEPTED'),
      },
    }),
    async (c) => {
      const { user, via } = c.get('identity');
      const me = await buildMe(store, user, terms, billing ? c.get('now')() : null, c.get('billingGate'), passkeysClockOf(c), ownedProfileCap(c), c.get('accountantAccess'), c.get('accountantPlan'));
      return c.json(via ? delegatedMe(me, via) : me, 200);
    },
  );

  return app;
}

/**
 * Exported for routes/device-sessions.ts (MUT-64): both sign-in surfaces return the same Me shape.
 * `terms` is null where no terms apply (MUT-324: the portal's signed-out mode). `billingAt` is null there too
 * (MUT-358), and every profile's `billing` is then null; otherwise it is the request's clock. MUT-361:
 * `billingStanding` is the lapse gate's verdict on the person (gate.ts), null wherever the gate is off. MUT-370:
 * `passkeysAt` is the request's clock where this server offers passkeys (null elsewhere, the local mode included);
 * only then is the suggestion read (`user.passkeyPrompt`, else null). MUT-565: with `clients`, `clientBooks` (the
 * cap and the person's Accountant plan, resolved from the same billing read: no query of its own).
 */
export async function buildMe(
  store: LedgerStore,
  user: UserRecord,
  terms: CurrentTerms | null,
  billingAt: Date | null,
  billingGate = false,
  passkeysAt: Date | null = null,
  maxOwnedProfiles = MAX_OWNED_PROFILES,
  accountantAccess = false,
  accountantPlan: AccountantPlanConfig = ACCOUNTANT_PLAN_OFF,
) {
  // MUT-361 (review R7): one loader with the lapse gate's standing, its reads batched per tick.
  const loaded = await memberProfilesForBilling(store, user.id);
  // MUT-358: one billing read for all the profiles (billing/coverage.ts), never one per profile. MUT-373 (eng review
  // D1): likewise one owners read for every profile the caller owns; the two are independent, so they run together.
  const ownedIds = loaded.filter(({ organization, membership }) => ownsProfile(organization, user.id, membership.role)).map(({ organization }) => organization.id);
  const [billingRead, ownerEntries] = await Promise.all([billingAt ? entitlementsWithFactsFor(store, loaded, billingAt, user.id) : null, store.memberships.listOwnersOf(ownedIds)]);
  const entitlements = billingRead?.entitlements ?? null;
  // MUT-565: the Accountant plan from the facts just read (no query of its own). Without that read (billing off), the
  // same resolution as the accountant door, so `readable` never disagrees with what opens.
  const planAt = billingAt ?? new Date();
  const plan: AccountantPlan = billingRead
    ? resolveAccountantPlan(user.id, billingRead.facts, planAt)
    : accountantAccess && accountantPlan.on
      ? resolveAccountantPlan(user.id, await store.billing.factsFor({ ownerUserIds: [user.id], organizationIds: [] }), planAt)
      : { state: 'NONE', source: null, until: null, cancelAtPeriodEnd: false };
  const profiles = loaded.map(({ organization, membership, malafatConnected }) => {
    const entitlement = entitlements?.get(organization.id);
    return {
      ...hostedProfileFor(organization, malafatConnected ? 'MALAFAT' : null, user.id, membership, ownerEntries),
      billing: entitlement ? serializeEntitlement(entitlement) : null,
    };
  });
  // MUT-120: the personal membership is created in the same instant as the firm's, so membership order alone ties on a
  // random id. A stable sort on rank keeps membership order (oldest first) inside each group: firms, then the profiles
  // the caller created (MUT-182), then the caller's personal profile last. The portal opens profiles[0].
  const rank = (p: { isPersonalDefault: boolean; owned: boolean }) => (p.isPersonalDefault ? 2 : p.owned ? 1 : 0);
  profiles.sort((a, b) => rank(a) - rank(b));
  const [ownedProfiles, termsNow, passkeyPrompt, features, clients, passkeyCount] = await Promise.all([
    store.organizations.countOwnedBy(user.id),
    terms && termsStatus(store, user.id, terms),
    passkeysAt ? store.passkeys.promptOf(user.id) : null,
    store.features.activeFor(user.id),
    // MUT-559: the profiles shared with the person as an accountant; never part of `profiles`. MUT-575: ended ones too,
    // until removed, so the clients show the tab while any row is left. No stat queries here (GET /v1/clients has them).
    accountantAccess ? clientBooksOf(store, user.id, clientCapOf(plan, accountantPlan)) : null,
    // MUT-596: only when it decides ownSignIn (a password the person never chose).
    user.passwordChosen ? 0 : store.passkeys.listByUser(user.id).then((keys) => keys.length),
  ]);
  return {
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      locale: user.locale,
      malafatSuggestions: resolveMalafatSuggestions(user.malafatSuggestions),
      // MUT-596: false for an account Sign in with Malafat created, until the person adds a passkey or their own password.
      ownSignIn: user.passwordChosen || passkeyCount > 0,
      trialPrompt: resolveTrialPrompt(user.trialPrompt),
      // MUT-370 (D3, D9): the server decides whether to suggest a passkey; null where it offers none.
      passkeyPrompt: passkeyPrompt && passkeyPromptView(passkeyPrompt.prompt, passkeyPrompt.passkeys, passkeysAt!, user.closure !== null),
      status: user.status,
      // MUT-333: while closing, the clients show only Keep my account and Sign out.
      closure: user.closure ? { requestedAt: user.closure.requestedAt.toISOString(), deleteAfter: user.closure.deleteAfter.toISOString() } : null,
      // MUT-433: read on every request, never cached, so an operator's revoke shows at once.
      features,
      // MUT-459: only an operator's /v1/me names it; the console's link and pages hang off this.
      ...(user.operatorAt ? { operator: true as const } : {}),
    },
    profiles,
    limits: { ownedProfiles, maxOwnedProfiles },
    currencies: [...SUPPORTED_CURRENCIES],
    terms: termsNow,
    billingStanding: entitlements && billingGate ? personStanding([...entitlements.values()].map((e) => e.state)) : null,
    ...(clients ? { clients: clients.rows, clientBooks: clientBooksSummaryOf(clients.activeCount, plan, accountantPlan) } : {}),
  };
}

/**
 * MUT-593 (ADR-254 D9): Me as Malafat sees it when acting as the person — the tenant's profile alone, and none of the
 * person's own standing: no accountant client books, no billing standing (their own profiles' bills), no operator flag.
 */
function delegatedMe(me: Awaited<ReturnType<typeof buildMe>>, via: DelegatedVia): Awaited<ReturnType<typeof buildMe>> {
  const { operator, ...user } = me.user;
  void operator;
  return { user, profiles: me.profiles.filter((p) => p.id === via.organizationId), limits: me.limits, currencies: me.currencies, terms: me.terms, billingStanding: null };
}

/** MUT-324: the current version, and whether the person's latest acceptance covers it (D10). */
async function termsStatus(store: LedgerStore, userId: string, terms: CurrentTerms) {
  const latest = await store.users.latestTermsAcceptance(userId);
  return { version: terms.version, accepted: termsAccepted(latest?.version ?? null, terms.version) };
}
