import { tryGetContext } from 'hono/context-storage';
import { ApiError } from '../errors.js';
import type { LedgerStore } from '../repositories/ports.js';
import type { AppEnv } from './middleware.js';
import { mayWrite, writeRefusal, type Domain, type Principal, type ProfileWriter } from './writability.js';

/**
 * The third layer of the writability matrix (hosted-portal.md §5, ADR-037
 * decision 7): a guard below the routes, so no route can opt out.
 *
 * Every repository method is classified once:
 *  - `read`     — reads; any principal.
 *  - `control`  — bookkeeping every request needs (audit rows, idempotency
 *                 claims, last-used stamps); any principal.
 *  - `operator` — provisioning that only /admin and the operator scripts do
 *                 (organizations, keys, users, memberships); refused under
 *                 every guard, which keeps ADR-037 decision 1 true below the routes.
 *  - `{ write }` — a write in one matrix domain; allowed only where the
 *                 principal's column is `read-write`.
 *
 * The map is typed over LedgerStore, so a new store method does not compile
 * until it is classified here.
 */
export type MethodAccess = 'read' | 'control' | 'operator' | { write: Domain };

type Repositories = Omit<LedgerStore, 'ping'>;
export type StoreAccess = { readonly [R in keyof Repositories]: { readonly [M in keyof Repositories[R]]-?: MethodAccess } };

export const STORE_ACCESS: StoreAccess = {
  organizations: { create: 'operator', getById: 'read', getBySlug: 'read', list: 'read' },
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
  },
  memberships: { grant: 'operator', revoke: 'operator', find: 'read', listByUser: 'read', listByOrganization: 'read' },
  sessions: { create: { write: 'identity' }, findByDigest: 'read', touch: 'control', revoke: { write: 'identity' }, revokeAllForUser: 'operator' },
  integrations: {
    findByOrganizationAndProvider: 'read',
    findByProviderAndTenant: 'read',
    listByOrganization: 'read',
    connect: { write: 'integration' },
    disconnect: { write: 'integration' },
  },
  audit: { append: 'control', listByOrganization: 'read', list: 'read' },
  idempotency: { claim: 'control', get: 'read', complete: 'control', fail: 'control' },
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
  },
  receivables: {
    getById: 'read',
    getByIds: 'read',
    list: 'read',
    listEligible: 'read',
    countOutstandingByProject: 'read',
    credit: { write: 'payments' },
    listCredits: 'read',
  },
  payments: {
    create: { write: 'payments' },
    getById: 'read',
    list: 'read',
    listAllocations: 'read',
    allocate: { write: 'payments' },
    reverse: { write: 'payments' },
    findReplacedBy: 'read',
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
};

export interface StoreGuard {
  /** Throws the matrix's refusal when this request may not call `repo.method`. */
  assertCanCall(repo: string, method: string): void;
}

/** The decision for one classified method, for a principal on a profile whose writer of record is `profileWriter`. */
export function storeRefusal(principal: Principal, profileWriter: ProfileWriter, access: MethodAccess): ApiError | null {
  if (access === 'read' || access === 'control') return null;
  if (access === 'operator') return new ApiError('PRINCIPAL_NOT_ACCEPTED', 'This operation does not accept this kind of credential');
  return mayWrite(principal, access.write) ? null : writeRefusal(access.write, profileWriter);
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
