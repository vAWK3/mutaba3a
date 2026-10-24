import { tryGetContext } from 'hono/context-storage';
import { ApiError } from '../errors.js';
import type { LedgerStore } from '../repositories/ports.js';
import type { AppEnv } from './middleware.js';
import { mayRead, mayWriteFor, writeRefusal, type Domain, type Principal, type ProfileWriter } from './writability.js';

/**
 * The third layer of the writability matrix (hosted-portal.md §5, ADR-037
 * decision 7): a guard below the routes, so no route can opt out.
 *
 * Every repository method is classified once:
 *  - `read`     — reads of shared ledger data; any principal.
 *  - `{ read }` — reads of one matrix domain; refused where the principal's
 *                 column is `none` (MUT-42: an API key reads no expense).
 *  - `control`  — bookkeeping every request needs (audit rows, idempotency
 *                 claims, last-used stamps); any principal.
 *  - `operator` — provisioning that only /admin and the operator scripts do
 *                 (firm organizations, keys, users, memberships); refused under
 *                 every guard, which keeps ADR-037 decision 1 true below the routes.
 *                 A person's own standalone profiles (MUT-182) are `sessionOnly`.
 *  - `{ write }` — a write in one matrix domain; allowed only where the
 *                 principal's column is `read-write`.
 *  - `sessionOnly` — a signed-in person's own resource, belonging to no
 *                 organization and so to no matrix domain (MUT-66's inbox, the
 *                 first of its kind). Distinct from `control`, which accepts
 *                 any principal: an API key has no person behind it and so has
 *                 no inbox to reach.
 *
 * The map is typed over LedgerStore, so a new store method does not compile
 * until it is classified here.
 */
export type MethodAccess = 'read' | 'control' | 'operator' | 'sessionOnly' | { read: Domain } | { write: Domain };

type Repositories = Omit<LedgerStore, 'ping'>;
export type StoreAccess = { readonly [R in keyof Repositories]: { readonly [M in keyof Repositories[R]]-?: MethodAccess } };

export const STORE_ACCESS: StoreAccess = {
  organizations: {
    create: 'operator',
    getById: 'read',
    getBySlug: 'read',
    list: 'read',
    // MUT-182: a person's own standalone profiles. Owner checks live in the queries (`ownerUserId`); an API key has no
    // person behind it, so it can neither create nor change one, and `create` (firms, Malafat tenants) stays operator-only.
    createOwned: 'sessionOnly',
    countOwnedBy: 'sessionOnly',
    updateOwned: 'sessionOnly',
    typeChangeImpact: 'sessionOnly',
    // MUT-300: the owner's own request (ownership is the route's ownedBy check); enabling, declining and the listing are the operator's.
    requestFirm: 'sessionOnly',
    setFirm: 'operator',
    declineFirmRequest: 'operator',
    listFirmRequests: 'operator',
  },
  apiKeys: {
    create: 'operator',
    findByPrefix: 'read',
    getById: 'read',
    listByOrganization: 'read',
    touchLastUsed: 'control',
    // A key revokes itself on disconnect and rotation (/v1/integration*, /v1/api-keys/self/revoke).
    revoke: { write: 'integration' },
  },
  users: {
    create: 'operator',
    getById: 'read',
    findByEmail: 'read',
    setPassword: 'operator',
    setStatus: 'operator',
    recordFailedSignIn: 'control',
    recordSignIn: 'control',
    // MUT-191: a person's own preference, written by their session (identity row)
    updateMalafatSuggestions: { write: 'identity' },
    // MUT-418: the person's answers to the trial's card prompt, the same identity-row write.
    updateTrialPrompt: { write: 'identity' },
    // MUT-237: a person's own password, same identity-row write as updateMalafatSuggestions above.
    changePassword: { write: 'identity' },
    // MUT-324: a person's own acceptance of the terms, the same identity-row write.
    latestTermsAcceptance: 'read',
    acceptTerms: { write: 'identity' },
    // MUT-324 T1: the operator's "who is behind on the terms" list.
    listLatestTermsVersions: 'operator',
  },
  // MUT-373: co-owners are added by the operator; a co-owner leaves, or the creator removes one, from their session (the
  // checks run inside removeOwner's transaction). The owners list is read on /v1/me.
  memberships: { grant: 'operator', revoke: 'operator', grantOwner: 'operator', removeOwner: 'sessionOnly', find: 'read', listByUser: 'read', listByOrganization: 'read', listOwnersOf: 'read' },
  sessions: { create: { write: 'identity' }, findByDigest: 'read', touch: 'control', revoke: { write: 'identity' }, revokeAllForUser: 'operator' },
  // MUT-235: issued by /admin, redeemed by the two public setup routes; both run with no guard, so every principal is refused here.
  // MUT-366: the self-service routes are public, so they run with no guard (like redeem); no credential may call these.
  accountSetup: { issue: 'operator', findByDigest: 'operator', redeem: 'operator', issueSignup: 'operator', redeemSignup: 'operator', pruneSignupLinks: 'operator' },
  // MUT-367: the review queue is the operator's (/admin and the CLI); the SIGNUP redeem writes its rows inside redeemSignup.
  signupReviews: { list: 'operator', findByUser: 'operator', digestFacts: 'operator', markNotified: 'operator', approve: 'operator', decline: 'operator' },
  integrations: {
    findByOrganizationAndProvider: 'read',
    findByProviderAndTenant: 'read',
    listByOrganization: 'read',
    connect: { write: 'integration' },
    disconnect: { write: 'integration' },
  },
  audit: { append: 'control', listByOrganization: 'read', list: 'read' },
  idempotency: { claim: 'control', get: 'read', complete: 'control', fail: 'control' },
  // MUT-131: partitioned by user, not organization — an API key has no person behind it (MUT-66's rationale for inboxEntries, below).
  userIdempotency: { claim: 'sessionOnly', get: 'sessionOnly', complete: 'sessionOnly', fail: 'sessionOnly' },
  customers: { create: { write: 'customers' }, getById: 'read', list: 'read', update: { write: 'customers' }, archive: { write: 'customers' } },
  projects: {
    create: { write: 'projects' },
    getById: 'read',
    list: 'read',
    update: { write: 'projects' },
    archive: { write: 'projects' },
    countActiveByCustomer: 'read',
    hasPostedActivity: 'read',
  },
  // Links customers and projects alike (import); the two rows have the same columns.
  externalReferences: { link: { write: 'customers' }, findByExternalId: 'read', findByExternalIds: 'read', findByEntities: 'read' },
  vatRates: { upsert: { write: 'agreements' }, list: 'read', effectiveOn: 'read' },
  agreements: {
    create: { write: 'agreements' },
    getById: 'read',
    list: 'read',
    listInstallments: 'read',
    getInstallment: 'read',
    // Posting and charging are agreement terms coming due (/v1/installments/*, retainer changes); lazy posting by a session uses unguarded().
    postInstallment: { write: 'agreements' },
    listUnpostedDue: 'read',
    applySupplement: { write: 'agreements' },
    listSupplements: 'read',
    cancel: { write: 'agreements' },
    appendVersion: { write: 'agreements' },
    listVersions: 'read',
    listRetainers: 'read',
    listCharges: 'read',
    createPostedCharge: { write: 'agreements' },
    // MUT-100: contingency terms and outcomes are agreement writes, Malafat's alone.
    updateContingencyTerms: { write: 'agreements' },
    recordOutcome: { write: 'agreements' },
    correctOutcome: { write: 'agreements' },
  },
  receivables: {
    getById: 'read',
    getByIdIncludingDeleted: 'read',
    getByIds: 'read',
    list: 'read',
    listEligible: 'read',
    countOutstandingByProject: 'read',
    credit: { write: 'payments' },
    listCredits: 'read',
    // MUT-65: "Owed", a bare receivable written outside an Agreement.
    createAdjustment: { write: 'payments' },
    softDeleteAdjustment: { write: 'payments' },
    // MUT-223: moving an Owed entry's date is the same row's write as creating or voiding it.
    redateAdjustment: { write: 'payments' },
  },
  payments: {
    create: { write: 'payments' },
    getById: 'read',
    list: 'read',
    listAllocations: 'read',
    listAllocationsFor: 'read',
    allocate: { write: 'payments' },
    reverse: { write: 'payments' },
    findReplacedBy: 'read',
    // MUT-61: the capture row's entire write surface — a person's own unallocated Received and its undo.
    capture: { write: 'capture' },
    undoCapture: { write: 'capture' },
    // MUT-223: re-dating a person's own capture (a settle payment included: settle writes origin CAPTURE).
    redateCapture: { write: 'capture' },
  },
  attachments: {
    create: { write: 'attachments' },
    setKey: { write: 'attachments' },
    getById: 'read',
    list: 'read',
    complete: { write: 'attachments' },
    softDelete: { write: 'attachments' },
  },
  feeProposals: { create: { write: 'agreements' }, getById: 'read', list: 'read', findOpenByProject: 'read', transition: { write: 'agreements' } },
  // MUT-42: the session's whole write surface, and nothing an API key may even read.
  expenses: {
    create: { write: 'expenses' },
    getById: { read: 'expenses' },
    list: { read: 'expenses' },
    update: { write: 'expenses' },
    softDelete: { write: 'expenses' },
    totalsByCurrency: { read: 'expenses' },
  },
  // MUT-267 (ADR-094): groups are part of the expenses domain — same session-only scopes, nothing an API key may read.
  expenseGroups: {
    create: { write: 'expenses' },
    getById: { read: 'expenses' },
    list: { read: 'expenses' },
    update: { write: 'expenses' },
    softDelete: { write: 'expenses' },
    setOverride: { write: 'expenses' },
    clearOverride: { write: 'expenses' },
    overridesForExpense: { read: 'expenses' },
  },
  expenseCategories: {
    create: { write: 'expenses' },
    getById: { read: 'expenses' },
    list: { read: 'expenses' },
    seed: { write: 'expenses' },
    update: { write: 'expenses' },
  },
  // MUT-254: vendors are expense data — session-only; Malafat's API key never reads or writes them (MUT-298 D1).
  vendors: {
    resolve: { write: 'expenses' },
    touch: { write: 'expenses' },
    getById: { read: 'expenses' },
    search: { read: 'expenses' },
  },
  expenseReceipts: {
    create: { write: 'expenses' },
    setKey: { write: 'expenses' },
    getById: { read: 'expenses' },
    listByExpense: { read: 'expenses' },
    complete: { write: 'expenses' },
    softDelete: { write: 'expenses' },
    // MUT-270: counts for the entries feed, across the person's own profiles (the route resolves them from memberships).
    countReadyByExpenseIds: { read: 'expenses' },
    // MUT-255: the receipts library.
    list: { read: 'expenses' },
    countByFilingStatus: { read: 'expenses' },
    countPendingSince: { read: 'expenses' },
    setSuggested: { write: 'expenses' },
    fileAsExpense: { write: 'expenses' },
    // MUT-389: onto an expense that already exists.
    fileOntoExpense: { write: 'expenses' },
    // MUT-397: the MUT-44 completion under the expense lock.
    completeOnExpense: { write: 'expenses' },
    // The operator's edit-rate figure (/admin only): across every profile, counts only.
    editRates: 'operator',
  },
  /**
   * MUT-66. Capturing is the person's own business, on no profile — hence
   * `sessionOnly`, the one classification that is neither "any principal" nor
   * a matrix domain. Filing keeps the *existing* `{ write: Domain }` shape of
   * the record it creates, deliberately: that is what makes filing refused in
   * exactly the places a direct create already is — filing as an expense lands
   * on any profile the person belongs to, filing as income is refused
   * READ_ONLY_PROFILE on a Malafat-fed one — with no inbox-specific
   * writability logic anywhere.
   */
  inboxEntries: {
    create: 'sessionOnly',
    getById: 'sessionOnly',
    list: 'sessionOnly',
    update: 'sessionOnly',
    delete: 'sessionOnly',
    // MUT-240: the person's own count, for the Capture hub's Recent handle — the same
    // basis as every other method here. /admin's per-user support lookup calls it too,
    // unguarded, so this change does not touch that route's behaviour.
    countByUser: 'sessionOnly',
    fileAsExpense: { write: 'expenses' },
    fileAsIncome: { write: 'payments' },
  },
  // MUT-161; MUT-194 (ADR-075) adds the optimistic update and the soft delete.
  conversions: {
    create: { write: 'conversions' },
    getById: { read: 'conversions' },
    list: { read: 'conversions' },
    update: { write: 'conversions' },
    softDelete: { write: 'conversions' },
  },
  /**
   * MUT-270: a person's own view across every profile they belong to, so no single matrix domain fits — hence
   * `sessionOnly`, as the inbox. The route resolves the organizations from the person's memberships; an API key has
   * no person behind it and so no feed.
   */
  entries: { list: 'sessionOnly', loggedDays: 'sessionOnly', settledOwedIds: 'sessionOnly' },
  /**
   * MUT-358: a signed-in person's /v1/me reads the billing facts of their own profiles (`sessionOnly`: an API key has no
   * person behind it, and MUT-361's gate runs on sessions only). Grants, links and Stripe's mirror are written by the
   * operator and, from MUT-360, the webhook, both on the unguarded store.
   */
  billing: {
    factsFor: 'sessionOnly',
    // MUT-362: Settings › Billing reads the person's own account; the route passes the session's user, never a parameter.
    summaryOf: 'sessionOnly',
    setTrialStart: 'operator',
    // MUT-419: the daily trial-mail run (the job and the operator), on the unguarded store.
    trialMailCandidates: 'operator',
    createGrant: 'operator',
    revokeGrant: 'operator',
    getGrant: 'operator',
    listGrants: 'operator',
    linkAccount: 'operator',
    getAccount: 'operator',
    getSubscription: 'operator',
    listAccounts: 'operator',
    saveAccount: 'operator',
    saveSubscription: 'operator',
    beginStripeEvent: 'operator',
    finishStripeEvent: 'operator',
    pruneStripeEvents: 'operator',
  },
  /**
   * MUT-359: only server code reaches the mail send log and the suppression list: the mailer and the Resend webhook,
   * both built on the unguarded store. No principal's request may (a key could otherwise stop mail to an address or
   * wipe the cap ledger).
   */
  email: { isSuppressed: 'operator', suppress: 'operator', claimDelivery: 'operator', finishDelivery: 'operator', pruneDeliveries: 'operator' },
  // MUT-325: a person downloading their own profile's records; an API key has no person to download for.
  recordsExport: { profilePage: 'sessionOnly', inboxPage: 'sessionOnly', findExportableReceipt: 'sessionOnly' },
};

export interface StoreGuard {
  /** Throws the matrix's refusal when this request may not call `repo.method`. */
  assertCanCall(repo: string, method: string): void;
}

/** The decision for one classified method, for a principal on a profile whose writer of record is `profileWriter`. */
export function storeRefusal(principal: Principal, profileWriter: ProfileWriter, access: MethodAccess): ApiError | null {
  if (access === 'read' || access === 'control') return null;
  if (access === 'sessionOnly') return principal === 'session' ? null : principalNotAccepted();
  if (access === 'operator' || ('read' in access && !mayRead(principal, access.read))) {
    return principalNotAccepted();
  }
  if ('read' in access) return null;
  return mayWriteFor(principal, access.write, profileWriter) ? null : writeRefusal(access.write, profileWriter);
}

function principalNotAccepted(): ApiError {
  return new ApiError('PRINCIPAL_NOT_ACCEPTED', 'This operation does not accept this kind of credential');
}

export function principalStoreGuard(principal: Principal, profileWriter: ProfileWriter): StoreGuard {
  return {
    assertCanCall(repo, method) {
      const access = (STORE_ACCESS as Record<string, Record<string, MethodAccess> | undefined>)[repo]?.[method];
      if (!access) throw new Error(`Unclassified store method ${repo}.${method}`);
      const refusal = storeRefusal(principal, profileWriter, access);
      if (refusal) throw refusal;
    },
  };
}

const BASES = new WeakMap<LedgerStore, LedgerStore>();

/**
 * The store every route factory receives. Each repository call consults the
 * guard authenticate() set on the current request (Hono context storage);
 * outside a request, or on a request with no guard (/admin, health, the
 * public sign-in), calls pass straight through. Helpers that are handed the
 * store are covered too, because the check lives in the store, not the handler.
 */
export function requestScopedStore(base: LedgerStore): LedgerStore {
  const repositories = new Map<string, unknown>();
  const scoped = new Proxy(base, {
    get(target, prop) {
      const value: unknown = Reflect.get(target, prop, target);
      if (typeof prop !== 'string' || !(prop in STORE_ACCESS)) {
        return typeof value === 'function' ? value.bind(target) : value;
      }
      if (!repositories.has(prop)) repositories.set(prop, guardRepository(prop, value as Record<string, unknown>));
      return repositories.get(prop);
    },
  });
  BASES.set(scoped, base);
  return scoped;
}

/**
 * The one escape hatch: the store beneath the guard. Used only for lazy
 * posting by a session (ADR-037 decision 8), through `lazyPostingOf`; a test
 * pins its call sites.
 */
export function unguarded(store: LedgerStore): LedgerStore {
  return BASES.get(store) ?? store;
}

function guardRepository(name: string, repository: Record<string, unknown>): Record<string, unknown> {
  return new Proxy(repository, {
    get(target, method) {
      const value: unknown = Reflect.get(target, method, target);
      if (typeof method !== 'string' || typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        try {
          tryGetContext<AppEnv>()?.var.storeGuard?.assertCanCall(name, method);
        } catch (err) {
          return Promise.reject(err);
        }
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}
