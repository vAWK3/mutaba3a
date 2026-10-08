# Money v1 — Repository audit (MUT + MAL)

- **Date:** 2026-10-08
- **Input:** the approved "MUT/MAL Money v1" joint plan (sections 1–19), section 18.1 "Mandatory repository audit"
- **Repos audited:** `elMokhtbr/Mutaba3a/mini-crm` at `9c10354` (v0.0.63); `Barmajiyat/Malafat/dev/web/crm-platform` at current main
- **Feeds:** MUT-32 (architecture decision), MUT-26 (extraction feasibility), MAL-869/870/871 (CRM-side spikes), MAL-939 (epic)
- **Status:** findings complete; one decision required before Milestone 1 can be proposed

---

## 1. Headline finding

**The plan assumes a Mutaba3a that does not exist.** It describes Mutaba3a as a hosted, organization-scoped financial API that Malafat calls with an API key. The repository is a single-user, local-first desktop/PWA app with **no server, no HTTP API, no organizations, no API keys**, and two Active ADRs that forbid exactly that (ADR-005 "No Server Backend", ADR-013 "Local-Only Sync"). The only HTTP endpoint in the product is the opt-in LAN peer-to-peer sync server inside the desktop binary.

The plan is therefore **Option B** of epic MUT-25 ("standalone Cloud Run service with its own DB; CRM as API client"), which MUT-25 and MUT-32 record as *not* the standing recommendation. The standing recommendation is **Option A**: a shared money-core package with a Dexie adapter on the desktop and a Prisma adapter plus tables in Malafat's per-tenant Postgres, with op-log sync over the OAuth server Malafat already runs. MUT-28 (the OAuth client spike) is implemented and unit-tested specifically to make Option A cheap. MUT-32 is still open: nobody has chosen.

The plan said it was "approved product direction, pending technical repository audit". This is that audit, and it says the architecture section needs to be decided, not assumed.

Everything else in the plan — the financial rules, the Malafat UX, the security rules, the testing and milestone discipline — survives either option. What changes is *where the ledger runs* and *how Malafat reaches it*.

---

## 2. Mutaba3a: what exists, what is reusable, what is missing

### 2.1 Architecture

| Fact | Evidence |
|---|---|
| Pure local-first. No server, no functions, no backend SDK | `netlify.toml` is redirects + SPA fallback; `vite.config.ts` denylists `/api/` "for future-proofing"; no server deps in `package.json` |
| Only outbound calls: Frankfurter FX, GitHub releases, OAuth discovery/token | `src/lib/fx/fxService.ts:36`, `src/hooks/useLatestRelease.ts`, `src/sync/transport/oauth-client.ts` |
| Tauri Rust side: LAN sync server (axum, port 4242: `/v1/sync/{hello,status,pull,push}`, `/v1/pair/*`), mDNS, pairing, bundle crypto, OAuth loopback listener. **No Rust command touches ledger data** | `src-tauri/src/sync/*.rs` |
| Data lives in IndexedDB (Dexie v19) in the webview | `src/db/database.ts` |
| ADR-005 and ADR-013 Active; ADR-023 explicitly does not supersede them; MUT-30 owns the override | `.claude/DECISIONS.md:652-700` |
| No CI pipeline beyond a Windows build on release; `CI_CD.md` documents workflows that do not exist (MUT-33); Rust tests had never run until MUT-28 (TD-016) | `.github/workflows/build-windows.yml` |

### 2.2 Domain model vs. the plan's section 3–9

| Plan concept | Mutaba3a today | Reusable? |
|---|---|---|
| Organization / tenant | None. `BusinessProfile`/`profileId` is a local multi-identity switch; optional on Client/Project/Transaction | No |
| Customer | `Client {id,name,email,phone,notes,profileId,archivedAt}` | Shape yes; no `externalReference` anywhere |
| Project with one currency | `Project {id,name,clientId?,field?,notes?}` — **no currency on Project**; currency is per Transaction | Partially |
| Fee agreement (FIXED/RECURRING), supplements | None linked to the ledger. `Engagement` is a PDF-generation input with a `PaymentScheduleItem` (on_signing/on_milestone/on_completion/monthly) that creates nothing | Concepts only |
| Installments, triggers, "posted obligation" | None | No |
| Recurring retainer with billing day, EOM terms, effective-dated amendments, proration | `RetainerAgreement` (monthly/quarterly, `paymentDay` 1–28, draft/active/paused/ended) generating `ProjectedIncome` projections 12 months ahead; **no receivables, no payment terms, no amendments, no proration**; due-state refresh runs only when the Retainers page mounts; UTC `todayISO()` bug (TD-014) | Schedule generator and dedup-by-period are a starting point |
| Scheduler (idempotent, org-scoped, recoverable) | None. No cron, no worker, no Rust timer | No |
| VAT on posted obligations (basis, treatment, effective-dated rate) | Document-level only: `calculateDocumentTotals` with `vatEnabled`, `taxRate`, per-item `taxExempt`; `BusinessType` `exempt/authorized/company/lawyer/none` | The treatment taxonomy maps cleanly; the math is one `Math.round` per document |
| Payment (amount, currency, date, method, reference, attachment) | `PaymentRecord {transactionId, amountMinor, paidAt, notes}` — **no currency, no method, no reference, no attachment**; belongs to exactly one transaction | Concept yes |
| Allocation of one payment across receivables | **None.** 1:1 only. Retainer matching adds whole transactions, non-atomically | No |
| Allocation suggestions | Retainer match scoring (currency 30 / client 30 / amount 25 / date 15) | Idea only |
| Reversal (idempotent, preserves original) | **None.** Soft delete, `Document.voided`, `credit_note` documents | No |
| Idempotency keys | **None.** UUIDs minted inside repos; callers cannot supply them. Only op-log apply dedup | Op-log dedup is relevant to sync, not to API writes |
| Status model (Outstanding / Partially Paid / Overdue / Paid in Full; retainer Up to Date / Settled) | `PaymentStatus` unpaid/partial/paid computed; overdue via `src/lib/dates.ts` (ADR-022) — but computed three different ways across pages (MUT-17, in progress) | Overdue helper yes |
| Attachments on project/payment | Expense `Receipt` as base64 in IndexedDB; archived PDFs via Tauri fs. Nothing on income or payments | No |
| Audit trail | Op-log fed by only a subset of mutations (transaction create/update, client create and document create bypass it); `moneyEventVersions` table exists and is unused | Partial |
| Decimal-safe money | Integer minor units (ADR-009), `/100` hard-coded, `Math.round(parseFloat(x)*100)` parsing, no rounding-mode helper, no per-currency exponent | Representation yes; parsing must not be reused |
| Multi-currency discipline | Closed union `USD/ILS/EUR`; per-currency totals, never summed (ADR-004) | Yes, the discipline |
| i18n | `en`/`ar` only; no Hebrew | Not needed server-side |

### 2.3 Quality signals relevant to reuse

- ~2,000 vitest tests, ~65% coverage (TD-001); fake-indexeddb; 101 test files. Domain tests exist for aggregations, partial payments, payment records, dates, FX, document totals, sync (HLC, ops engine).
- Known defects in the exact area the plan touches: overpayment is allowed and asserted by tests (contradicts MUT-1 D2); `recordPaymentForRequest` sets `paid` without a PaymentRecord; two UTC `todayISO()` copies; three tests fail west of UTC.
- `src/db/repository.ts` (48k LOC per MUT-26) filters whole tables in JS — correct for one freelancer, **not usable multi-tenant** on a server.
- MUT-2 (strip to the core: delete ~13k LOC of dead surface) and MUT-1 (client accounting core, approved 2026-10-08) are the active roadmap. MUT-25 states extraction is blocked by MUT-10/11/17.

**Verdict on reuse:** the *disciplines* (minor units, per-currency, local-calendar overdue, op-log/HLC) and a few pure modules (`src/db/aggregations.ts`, `src/lib/dates.ts`, `src/lib/fx/`, document VAT math, retainer schedule generation) are portable. **Every financial object the plan defines — agreement, installment, posted receivable, allocation, reversal, idempotent operation, effective-dated VAT rate, attachment — has to be built new.** That is true under Option A and Option B alike.

---

## 3. Malafat: what exists (summary of the UX-phase audit, same date)

| Area | Finding |
|---|---|
| Money domain | None. 59 Prisma schema files, no Invoice/Payment/Receivable/Transaction. `OfficeSetting.currency` (default ILS), `defaultHourlyRates` in cents. **Matters have no currency** |
| Multi-tenancy | Schema-per-tenant Postgres; `TenantEncryptionKey` (KMS KEK + wrapped DEK, `32-encryption.prisma`); residency rules; `pnpm db:update_tenants` migration burden |
| OAuth 2.1 server | Per-tenant, CIMD + PKCE + rotating refresh + revocable grants (`47-oauth.prisma`, `features/oauth/`). Scope vocabulary is a closed, published five-scope contract with one write scope; the firm-level **MCP gate blocks any non-AI client** (`resolve-oauth-context.ts:109`). Money scopes and a separate money gate are MAL-870's open decisions |
| Bearer auth paths | Two unrelated ones: `getSessionWithBearer` (Outlook add-in, no scopes, ~20 routes) and `resolveOAuthContext` (scopes, uncached). Money API must use the latter and check scopes per route |
| Tenant API-key UI | None in `apps/web`; the control panel's lead-capture key is stored in plaintext in Firestore and has no rotate |
| Add-on entitlement | `tenant.activeAddOns` + addon gatekeeper is the only gating mechanism; plan-level feature flags were removed |
| Role model | `PARTNER / OFFICE_ADMIN / ASSOCIATE / INTERN`; Partner-only checks are inline `session.role !== "PARTNER"`; RBAC order session → read-only → role → matter access |
| Feature gates | `GATE_CONFIGS` with `roles: ["PARTNER"]` precedent; `FeatureGatePage` / `RoleRestrictedPage` |
| Nav | Single nav model (MAL-589/592), no role field; tools resolved server-side |
| UI kit | No money input/formatter/stat tile/status badge; hand-rolled 3-step wizards; `ConfirmDialog`; `DataTable` |
| i18n | en/ar/he, namespaces per feature, parity tests, `DirectionProvider`, Western digits |
| Contract | OpenAPI-first (ADR-033): every `apps/web` route needs a `route.spec.ts`; Flutter client is generated from it |
| Jira | Epic MAL-939 created 2026-10-08 with MAL-869 (schema placement), MAL-870 (add-on + scopes), MAL-871 (who renders the UI), MAL-150 (rewritten scope pending). UX brief for the Money section published the same day |

---

## 4. The two options, measured against the plan's own rules

| Plan rule | Option A — money core in Malafat's tenant schema, Mutaba3a desktop syncs via OAuth | Option B — hosted Mutaba3a service, Malafat as API-key client (the plan as written) |
|---|---|---|
| MUT-1 single financial source of truth | One ledger per firm, in the firm's tenant schema, run by the money-core package | One ledger per org, in a second service |
| MUT-2 Mutaba3a works independently | Yes: desktop stays local-first; sync is opt-in (MUT-30 override still required) | Yes, but the hosted service is a *new product* with its own accounts, hosting and privacy posture, contradicting the product's "data never leaves the device" promise unless carefully positioned |
| MUT-3 every op scoped to an org | Tenant schema isolation already enforced by `runWithTenantAsync` | Must be built: orgs, API keys, scopes, rate limits, isolation tests |
| MUT-4/5 auditable, decimal-safe | Same code either way | Same |
| MAL-1 no parallel ledger in Malafat | **Rewrite needed:** Malafat *hosts* the ledger but its UI never computes; the money-core domain package is the only calculator. The rule's intent (one ledger, one calculator) holds | Holds literally |
| MAL-2 no local calculation | Holds: UI renders API results; the API runs the domain package | Holds |
| MAL-3 Partner-only | Same | Same |
| MAL-4 credentials never reach clients | **Simpler:** there is no Mutaba3a credential. Desktop access is an OAuth grant the user sees in Settings › Connected apps | Needs encrypted key vault, rotation UI, masking (UX brief D13) |
| MAL-5 Stripe stays separate | Same | Same |
| G7 Mutaba3a product-independent | The money-core package has no Malafat assumptions; Malafat is one adapter | Same |
| G10 production evidence | Encryption and residency inherited from `TenantEncryptionKey`; one deploy pipeline | Must replicate encryption, residency, backups, monitoring, rollback for a second stateful service |
| Operational cost | ~N tables + routes in an existing monorepo; the known `db:update_tenants` burden (MAL-869) | Cloud Run + Cloud SQL + Secret Manager + a second CI/CD, plus cross-service tenancy mapping and consistency |
| What the desktop needs | MUT-27 (server-side op-log transport) + MUT-30 override + durable token store (TD-015) + MAL-870 scopes. **Not required for Malafat's Money to ship**; it is the follow-on that makes the desktop a client of the firm ledger | Same desktop work, plus the desktop must *also* speak the new service's API |
| Timeline risk | Malafat Money v1 can ship with zero Mutaba3a desktop changes | Malafat Money v1 is blocked on standing up and hardening a new service |

**Recommendation: Option A**, as MUT-25/MUT-32 already recommend. The domain build (section 2.2's "must be built new" column) is identical under both; A removes a second stateful service, a credential vault, and the plan's sections 10.1, 10.4, 12.12 and 13.3 almost entirely, while inheriting Malafat's encryption and residency for privileged client financial data.

### 4.1 What Option A changes in the plan, section by section

| Section | Change |
|---|---|
| 2 Architecture | Replace the two-box diagram with: Malafat backend hosts `packages/money-core` (pure domain) + `packages/money-prisma` (adapter) + money API routes. Mutaba3a desktop is an optional OAuth client that syncs op-logs with the firm ledger (later milestone) |
| 3.1 Organizations | Becomes the tenant. Currency/VAT/account config lives in a per-tenant `MoneySettings` row |
| 10.1 / 10.4 / 12.12 Connecting with an API key, disconnecting | Deleted. Malafat Money works out of the box for an entitled tenant (add-on, MAL-870). "Connect Mutaba3a desktop" is an OAuth grant initiated from the desktop, visible under Connected apps |
| 10.2 External references | Still needed, but now between the firm ledger and the *desktop's* local records, for sync, and between MoneyCustomer ↔ Client / MoneyProject ↔ Matter inside the same schema (plain FKs) |
| 10.3 Import Malafat records into Mutaba3a | Becomes "desktop pulls the firm ledger on first sync"; MUT-31 shallow entity mapping covers labels |
| 11 API contract | Two doors on the same routes: session (Partner) for the web UI, `resolveOAuthContext` with `money:read`/`money:write` for the desktop. OpenAPI stays the single contract (ADR-033) |
| 12.12 Integration settings | Replaced by the existing Connected-apps grant list; the UX brief's D13 collapses to one line |
| 12.13 "Integration unavailable / stale" | Only arises for desktop sync lag, not for the web UI |
| 13.3 Credential management | Collapses to OAuth grant lifecycle, already built and tested on Malafat |
| 14.3 Synchronization model | Web UI: direct reads. Desktop: op-log pull/push (MUT-27) |
| 16 Milestones | M1 becomes "money-core domain package + Prisma tables + Partner gate", not "API foundation + credentials". The desktop sync becomes M7 (after M6), gated by MUT-30 |
| 17 Jira | MUT epic owns `money-core` (domain) and the desktop adapter; MAL epic (MAL-939) owns tables, routes, scopes, UI. MAL-869/870/871 are the right spikes and are now mostly answered by this audit and the UX brief |
| 18.3 Restrictions | Add: "no second stateful service"; "no plaintext credential storage" |

---

## 5. Sequencing under Option A

1. **MUT-30 ADR override** (cheap, a hard gate for any desktop sync): record that cloud sync is opt-in, local-only stays supported, firm data inherits Malafat encryption/residency.
2. **MUT-32 decision + design brief** — this audit plus the UX brief are its inputs.
3. **`packages/money-core`** in the Malafat monorepo (so it ships with the tenant schema and OpenAPI), authored with zero Malafat imports so Mutaba3a can consume it later as a published package (MUT-26's packaging question). Ports from Mutaba3a: minor-unit money type with a real rounding helper and per-currency exponent, `AmountByCurrency` aggregation, ADR-022 date helpers, VAT treatment taxonomy. New: agreements, installments, posted receivables, retainer schedule with EOM terms/proration/amendments, allocations, reversals, idempotent operations, status derivation.
4. **MAL-869** tables in the per-tenant schema, encryption coverage, indexes, `release-steps.ts` entries.
5. Milestones M1–M6 as in the plan, re-labelled per §4.1.
6. **Desktop adoption**: MUT-2 strip-down and MUT-1 first (the desktop's own roadmap), then MUT-27 transport + TD-015 keychain + MAL-870 scopes + MUT-28 staging verification.

Under Option B, steps 3–5 still happen, plus the new service, and step 6 additionally needs the desktop to target the service's API.

---

## 6. Facts the plan must correct regardless of option

- **Malafat matters have no currency**; currency must be chosen when a matter gets a money project (UX brief D8).
- Mutaba3a has **no allocation, reversal, installment, agreement, idempotency or external-reference concept**; "do not rewrite the Mutaba3a ledger" (18.1) should read "port its disciplines; the ledger objects are new".
- Mutaba3a's currency set is a closed `USD/ILS/EUR` union with fixed 2-decimal minor units; the plan's "explicit currency representation" needs a per-currency exponent even if only those three ship.
- Overpayment is currently allowed and tested as allowed on the desktop; the plan's "allocation cannot exceed the outstanding balance" is a new invariant on both sides.
- The desktop has no scheduler; the plan's section 5.4 scheduler belongs to the server side only.
- The MCP firm gate will reject a Mutaba3a money token until MAL-870 adds a separate money gate; the five-scope vocabulary is a published contract and fails closed on unknown scopes, so desktop/server version skew needs a story.
- One active OAuth grant per (client, user) breaks a two-machine lawyer (MUT-28 Gap 3); decide per-device grants before the desktop ships sync.

---

## 7. Decision required

Choose **A** (money core hosted in Malafat's tenant schema; desktop syncs via OAuth) or **B** (new hosted Mutaba3a service; Malafat as API-key client). This audit recommends **A**. The Milestone 1 implementation proposal and the OpenAPI contract draft will be written for the chosen option.
