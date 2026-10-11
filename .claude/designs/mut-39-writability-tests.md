# MUT-39 — profile source and server-enforced writability (test plan)

Companion to `hosted-portal.md` §5 (the matrix block), ADR-037 decisions 2, 7 and 8, and the MUT-39 re-cut. Written before implementation. Paths are under `server/`.

## What MUT-38 already delivered

- The profile source model, `GET /v1/me` with `source`, `writerOfRecord` and `access`, and the `X-Mutaba3a-Profile` membership check.
- Session effective scopes, taken from `WRITABILITY_MATRIX`.
- System-actor lazy posting on `GET /v1/summaries/organization`.

## What MUT-39 adds

1. **`READ_ONLY_PROFILE` (403).** A session reaching a key-only route that requires `<domain>:write` on a row whose writer of record is `MALAFAT` gets `403 READ_ONLY_PROFILE { domain, writerOfRecord }`.
   - `writerOfRecord` is `MALAFAT` when the session's named profile is a member organization with a CONNECTED Malafat integration. Otherwise it is `null`, so the error never reveals anything about a non-member organization.
   - Other key-only routes keep `PRINCIPAL_NOT_ACCEPTED`.
   - Each route's required scopes come from tagged `requireScope` middleware found in `app.routes`, so no route needs a second declaration.
2. **The store guard, below the routes.**
   - `STORE_ACCESS` classifies every `LedgerStore` repository method as `read`, `control`, `operator` or `{ write: Domain }`. Its mapped type makes a new store method fail to compile until it is classified.
   - `operator` covers provisioning: organizations, keys and users created, passwords and statuses set, memberships granted and revoked, and all of a user's sessions revoked. Only `/admin` and the scripts do these, and they carry no guard; under any guard these methods are refused with `PRINCIPAL_NOT_ACCEPTED`.
   - `requestScopedStore(base)` is what every route factory receives. Each repository call consults the request's guard through Hono's `contextStorage`/`tryGetContext`.
   - A session's guard allows writes only where its matrix column is `read-write`; an API key's guard uses its own column. A refused write throws `READ_ONLY_PROFILE` on a `MALAFAT` row and `PRINCIPAL_NOT_ACCEPTED` otherwise. The session's guard carries the selected profile's writer of record (`null` on the two identity routes, which name no profile).
   - `/admin/*`, health, and the public sign-in carry no guard.
   - `unguarded(store)` is the one escape hatch, used only for lazy posting by a session. It is called only from `lazyPostingOf(c, store)` in `auth/middleware.ts`, which returns the actor and the store together. A test pins both sets of call sites.
3. **The matrix is the contract.**
   - The const gains the brief's `routes` text.
   - A drift test parses the brief's block and fails if any cell differs.
   - Generated route tests derive every `/v1` operation's expected outcome per principal from the matrix plus the route's scopes and declared `security`.
   - A consistency check holds: no route opens to a principal beyond what that principal's matrix column grants.

**Deviations from the brief, recorded there (§5, "As built"):**
- Handlers keep their factory-captured `store`. It is the request-scoped proxy rather than a `c.var.store`. The proxy reaches every call, including helpers that receive the store as a parameter, so "no route can opt out" holds without editing 58 handlers.
- The `operator` class.
- `lazyPostingOf` replaces `postingActorOf` + `unguarded` at the call sites.

## Unit: `src/auth/__tests__/store-guard.test.ts`

**`STORE_ACCESS` covers the runtime store:** every function-valued property of each repository on a real `MemoryLedgerStore` is classified, nothing is classified that doesn't exist, and `ping` is excluded. The `operator` set is pinned by name.

**Expenses row (no store methods until MUT-42):** `storeRefusal` lets a session write expenses on a Malafat-fed profile and refuses the API key with `PRINCIPAL_NOT_ACCEPTED`.

**Session guard, for each classified method:**
- `read` and `control` pass; `operator` is refused with `PRINCIPAL_NOT_ACCEPTED`.
- `{ write: d }` passes if and only if `d` is `read-write` in the session column.
- Otherwise it throws `READ_ONLY_PROFILE` (with `domain` and the guard's writer of record) when the row's writer of record is `MALAFAT`, and `PRINCIPAL_NOT_ACCEPTED` otherwise.

**API-key guard:** the same rule over the `apiKey` column.

**Proxy:**
- Inside a request whose guard refuses, a write throws before reaching the store; nothing is written.
- Provisioning through the proxy is refused under an API key's guard.
- `unguarded(proxy)` reaches the base.
- Outside any request, calls pass straight through.
- Non-repository properties (`ping`) work.

## Matrix drift: `src/__tests__/writability-drift.test.ts`

- Parses the rows between the markers in `../.claude/designs/hosted-portal.md` and compares every column with `WRITABILITY_MATRIX`.
- The local column reads `device` on every row.
- Ten rows; each domain appears once.

## Generated route tests: `src/__tests__/writability-routes.test.ts`

The setup has three organizations: A with a CONNECTED Malafat integration, B without one, and C with one but no membership. One user is a member of A and B. The base store is wrapped in a recorder, so assertions can look at every repository call that reached it.

**For every `/v1` operation with tagged scopes:**
- Each scope's domain is a matrix row.
- If the operation declares `session`, the session column grants all its scopes. If it declares `apiKey`, the `apiKey` column does.
- If it doesn't declare `session`, a session call naming A is expected to give `READ_ONLY_PROFILE { domain, writerOfRecord: 'MALAFAT' }` or `PRINCIPAL_NOT_ACCEPTED`, as the matrix decides. The same call naming B gives `writerOfRecord: null` where applicable, and so does one naming C: a non-member's writer of record is never revealed. No write-classified store method is called.
- Every session-declared list operation answers 200.

**Per-entity cases the AC asks for (A's real ids, nothing written):**
- Agreement create (income) → `READ_ONLY_PROFILE` with domain `agreements`.
- Installment trigger (income) → `agreements`.
- Receivable credit → `payments`.
- Payment record → `payments`.
- Customer create → `customers`.

**Call sites (comment lines excluded):** `unguarded(` appears only in `auth/middleware.ts`. `lazyPostingOf(` appears three times in `summaries.ts`, twice in `agreements.ts`, and once each in `receivables.ts` and `retainers.ts`.

**Lazy posting for every session-reachable lazy-posting route (on a Malafat-fed profile, so the guard is at its strictest):**
- Covered: summaries (organization, customer, project), receivables list, agreements list and get, and retainer charges.
- A DATE installment and a retainer's first month fall due. Each route is read twice and posts what is due once: `installment.posted` (except the charges route) and `retainer.charged`, each with actor `SYSTEM`. No `USER` row exists other than `user.signed_in`.
- No other session read writes anything.

**No figures leak across profiles:**
- With two memberships, `GET /v1/customers` with header A returns only A's customers, and with header B only B's. The other's customer id answers 404.
- A spy on the base store's `customers.list` shows the organization id equal to the header on every call.
- For every session read, the other profile's organization id appears in no argument of any store call.

## Contract and gates

- `ERROR_CODES` gains `READ_ONLY_PROFILE` (403). `openapi.yaml` is regenerated, and the API version moves to `1.10.0-mut39`.
- `route-security.test.ts` expects `READ_ONLY_PROFILE` (with `writerOfRecord: null`; that organization has no integration) on key-only write routes in `MALAFAT` domains. It also expects every key-reachable operation to have tagged scopes.
- Server gates: lint, typecheck, `npm test`, `npm run test:db`, `openapi:check`.

## Mutation checks (run once, reverted)

- With layers 1 and 2 switched off for sessions, the per-entity cases fail. The requests are refused by validation or `keyAuth` instead.
- Lazy posting through the guarded store makes all eight lazy-posting cases fail with 403, including MUT-38's. This shows the guard sits beneath every read route.

## Result (2026-10-11)

- `npm test`: 924 passed, 9 skipped. `npm run test:db`: 978 passed.
- lint, typecheck, build and `openapi:check` pass.
