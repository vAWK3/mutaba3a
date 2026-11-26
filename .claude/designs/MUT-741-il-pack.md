# MUT-741: Israel as the first jurisdiction pack (behaviour-preserving) — PLAN (2026-11-26)

**Status:** plan for approval. Nothing built. Parent: epic MUT-738, `jurisdiction-packs.md` (ADR-287). Needs MUT-740 (merged to local main `c5b4c7a6`, In Review). ADR-287 is still *Proposed*; building this is what makes it Accepted.

## 1. Where the Israel rules are read today (the whole list)

| Rule | Lives in | Read by |
|---|---|---|
| Document codes 300/305/320/330/400, `IssuedDocType` | `issuing/types.ts` `DOC_TYPE_CODES` | uniform-file export + report, both stores (sort), retention file names |
| Dealer types (LICENSED, EXEMPT, COMPANY, NONPROFIT), "exempt may issue receipts and payment requests only" | `types.ts`, `compose.ts` `assertWhoMayIssue` | compose, documents-due, schemas |
| ILS only | `types.ts` `ISSUING_CURRENCIES`; `'ILS'` literals in `routes/issuing.ts` (505-512, 888-890), `routes/documents-due.ts` (123-258), `documents-due.ts` (234), `uniform-file/export.ts` (`LEADING_CURRENCY`), `allocation-number.ts` | compose, due list, issue routes |
| Dated VAT table 17% → 18% | `issuing/vat-rate.ts` | `compose.ts` only |
| Tax-ID check digit | `israel/tax-id.ts` | routes/issuing, customers, business-lookup |
| Allocation number: thresholds, 9 digits, `needsAllocation`, allocator, manual allocator | `israel/allocation-number.ts`, `israel/tax-authority/service.ts` | routes/issuing, serializers, `expenses/compose.ts`, `receipts/extract/merge.ts`, memory store CHECK |
| Tax Authority client, token box, reminders, registry lookup | `israel/tax-authority/*`, `israel/registry.ts` | `index.ts`, `app.ts`, `routes/tax-authority*.ts`, `auth/two-factor.ts` |
| 7-year retention | `issuing/retention.ts` | sweep, operator listing, both stores |
| Uniform file (מבנה אחיד) | `issuing/uniform-file/*` | issuing routes |
| `ISSUING_CORE_VERSION` | `issuing/version.ts` | issue route, uniform file |

## 2. Design

**New module `server/src/jurisdictions/`** (strategy registry, PATTERNS: Strategy; the module's only door is `jurisdictions/index.ts`):
- `pack.ts`: `interface JurisdictionPack` with only what the Israel code reads today (YAGNI; MUT-744's paper packs for ZATCA and JoFotara widen it, MUT-743/742 add the rules read and schema):
  `country`, `version`, `currency` (base + `issuingCurrencies`), `taxId` (`normalize`, `registryOf`), `dealerTypes` + `mayIssue(dealerType, docType)`, `documentTypes` (code, vatBearing, taxDocument per type), `vat` (`rateOn(date)`, `exemptDealerRate`), `clearance` (`required(doc)`, `allocator`, `manualAllocator`, the number's digits and column check), `retentionYears`, `uniformFile` (writer entry), `expenseRules` (allocation threshold for the expense flag).
- `registry.ts`: `packFor(country): JurisdictionPack` (throws for a country with no pack; MUT-740's `assertLive` already stops that earlier), `defaultPack()` = IL.
- `il/`: `git mv` of `israel/*` here (tax-id, allocation-number, registry, tax-authority/*) plus `il/vat.ts` (the dated table), `il/documents.ts` (codes, dealer rule), `il/index.ts` (assembles `IL_PACK`, `version: '1.0.0'`).
- Core stays country-neutral: `compose.ts` takes `pack: Pick<JurisdictionPack,'vat'|'dealerTypes'|'currency'|…>` as an input field of `ComposeInput`; no `standardVatRateOn` or `ISSUING_CURRENCIES` import. `routes/issuing.ts` and `routes/documents-due.ts` resolve `pack = packFor(issuer.country)` once per request and use `pack.currency.base` instead of `'ILS'`.
- Document-type *vocabulary* (`IssuedDocType`, titles) stays in core; the code numbers move to the pack. Stores sort by a core `DOC_TYPE_ORDER` that equals today's code order (300, 305, 320, 330, 400), so no row order changes.

**Moves vs. rewrites:** pure `git mv` plus import rewrites for `israel/*` (history kept); the only logic edits are `compose.ts` taking the pack and the `'ILS'` literals.

## 3. Decisions (recommended option first)

1. **Expense-side and customer-side Israel rules** (allocation flag on expenses, receipt hint, customer/lookup tax-ID check) have no issuer country on the request. *Recommend:* they call `defaultPack()` (IL) now, no extra DB read, behaviour identical; TD item says "resolve per profile when the second pack exists" (MUT-742/743). Alternative: look the issuer up on every customer/expense write (extra read per write, not behaviour-neutral for profiles with no issuer).
2. **AC4 "pack version stamped" without a schema change** (the column is MUT-742; uniform-file and PDF bytes must not change, so `coreVersion` stays `1.0.0`). *Recommend:* stamp `{coreVersion, jurisdiction: 'IL', packVersion}` into the existing issue audit entry now, and the column lands in MUT-742. Alternative: wait for MUT-742 and mark AC4 as met there.
3. **Boundary guard.** *Recommend:* a Vitest guard (`jurisdictions/__tests__/boundary.test.ts`) that fails when any file outside `jurisdictions/` imports `jurisdictions/il/**` (allowlist, each with a reason, shrinking: `index.ts` composition root for the Tax Authority client and token box, `routes/tax-authority*.ts` as Israel-only endpoints, `auth/two-factor.ts` for the token box) and when `'ILS'` appears in `compose.ts`, `routes/issuing.ts`, `routes/documents-due.ts`, `issuing/documents-due.ts`. Alternative: an ESLint `no-restricted-imports` rule (the server already uses one) on the same patterns; the test is easier to allowlist, the lint rule gives editor feedback. Do both if cheap: the lint rule is five lines.

## 4. TDD and test plan

Order: write the guard and contract tests red, move code, green.
1. `jurisdictions/__tests__/il-pack.contract.test.ts`: IL pack fields equal today's values (codes, VAT dates and rates incl. 2024-12-31 → 1700, 2025-01-01 → 1800, thresholds by date, 9 digits, retention 7, exempt dealer rule, ILS only).
2. `registry.test.ts`: `packFor('IL')` ok, unknown country throws, `defaultPack` is IL.
3. Boundary guard as above.
4. Everything existing runs unchanged: server suite, the uniform-file fixture (`routes-uniform-file`), PDF snapshots (`issuing/pdf`), compose tests (now pass the IL pack), tax-authority tests (move with the files; only import paths change), retention tests. Acceptance proof for "no byte changes": those fixtures, run unmodified except for import paths and the `pack` argument.
5. Audit-entry test for decision 2.
Commands: `~/Work/tools/heavy-gate/heavy -l "MUT-741 …" -- npx vitest run --maxWorkers=3 <paths>` (full server suite at the end), `npm --prefix server run typecheck && lint && openapi:check` (no API change expected: `openapi:check` must stay clean, API version unchanged unless the audit field is documented).

## 5. Impact, risk, cost

- Touches ~25 files, almost all import-path moves. No migration, no API or client change, no new infra, no cost. Portal and phone untouched.
- Risk: a missed import or a changed document byte. Mitigation: pure moves, fixtures unchanged, boundary guard, full server suite plus lint and typecheck before landing. QA re-record: none (no user-visible behaviour; the existing issuing flows are untouched, reasoned per the QA rule).
- Rollback: revert the merge; no data involved.
- Needs the shared Prisma client? No schema change, so no `prisma generate` (worktree typecheck can use the shared client as is).

## 6. Scope check against the ticket

AC1 fixtures unchanged: yes. AC2 no Israel rule outside the pack or registry: yes, with the allowlist in decision 3 (Israel-only endpoints and the composition root, named and shrinking). AC3 guard fails on direct core imports: yes. AC4 versions stamped: core version unchanged, pack version `1.0.0` stamped per decision 2. Nothing extra. The ticket does not cover MUT-742's neutral `clearance` plan feature (`taxAuthority` stays as is).

## 7. Eng review (fresh read-only reviewer, 2026-11-26): approve with changes, folded in

Spot-checked against the code: `schemas.ts:5364/5370/5569/4220/4257`, `retention.ts:50` (`Asia/Jerusalem`), `config.ts:108` all confirmed.

**Inventory additions to §1** (each is *pack*, *generic core* or *non-goal*):
- Pack: `schemas.ts` `vatId` `^\d{9}$` (5370) and allocation `^\d{9}$` (4220, 4257) become pack-supplied patterns where the schema can take them; `config.ts` `SOFTWARE_HOUSE_VAT_ID`; uniform-file `nineDigits` (export.ts:124) and house placeholder (:59); `retention.ts` `Asia/Jerusalem` / `israelDateOf` (pack `timezone`); `VAT_BEARING` and `TAX_DOCUMENTS` (under `documentTypes`); the `'ILS'` literals in `routes/documents-due.ts` (123, 130, 234, 239, 246, 252, 257, 258), `issuing/documents-due.ts:234` (`CURRENCY_NOT_ILS`), `compose.ts:135` and its message.
- Non-goal (stated, not silent): `DealerTypeSchema` enum and `z.literal('ILS')` at `schemas.ts:5364/5569` are the **API contract**; they change with MUT-742/743, not here (OpenAPI must stay byte-identical). `receipts/extract/currency.ts` and `fields.ts` (reading a scanned receipt) stay: extraction heuristics, not issuing. Hebrew print strings in `issuing/{labels,copies,pdf}` stay in core files for now and move behind `pack.labels` when a second language set exists (MUT-743/744).
- Memory store `assertAllocationNumberColumn` models a Postgres CHECK: it is schema, not a pack rule; it stays with the store (allowlisted).

**Changes to the design**
1. **AC2, said honestly.** The guard is: no import of `jurisdictions/il/**` outside the pack, the registry and a named, shrinking allowlist; **and** `defaultPack()` may be called only from a second named list (expense, receipt and customer paths), so it cannot spread. The tax-authority deps (client, token box, registry lookup) are exposed through the registry, so `index.ts`, `app.ts` and `auth/two-factor.ts` leave the allowlist; only `routes/tax-authority*.ts` (Israel-only endpoints) stays. This narrows AC2's wording from "no Israel rule outside the pack" to "…outside the pack, registry and a named allowlist"; needs Basel's yes.
2. **AC4, said honestly.** `ISSUING_CORE_VERSION` stays `1.0.0` (it feeds the uniform-file software version, so a bump changes bytes). Pack version `1.0.0` is a pack constant, asserted by a test, and recorded in the issue audit entry (`routes/issuing.ts:417`, only when `created`), also on the cancel and credit paths (997, 1149). The per-document column is MUT-742. No existing test asserts that audit's metadata.
3. **Cycles.** `allocation-number.ts` imports `agreements/compose` at runtime (`validationError`); the registry would sit above it. Add an import-cycle check (madge or ESLint `import/no-cycle`, whichever the repo already has) on `jurisdictions/**` and `issuing/**`, and keep `issuing/jurisdictions.ts` (MUT-740's live list and `assertLive`) as the one "which countries are live" module, referenced by the registry, not duplicated.
4. **Interface.** Add cheap certainties: `timezone`, `taxId` pattern and length. Drop `exemptDealerRate` (use `mayIssue` plus the dealer rule). Mark the allocator fields IL-only and optional. Nothing for ZATCA or JoFotara (MUT-744). Rename Israel's company lookup to `taxId.lookup` so "registry" means only the pack registry.
5. **Tests.** Before moving anything: record golden hashes on the base commit for a fixed fixture set (uniform file, PDF, composed document for all five types plus credit, cancel and an exempt dealer, allocation request payload) and rerun after; confirm the existing fixtures cover those, else add them. `DOC_TYPE_ORDER` test: sorted equals the IL codes sorted. Guard self-test with a fixture that must fail. `compose` tests get the IL pack through the test helper's default, not per-test edits. `openapi:check` clean and `schema.d.ts` unchanged.
6. **Order and split.** Two commits on one branch, merged once (the repo lands by local merge, not PRs): **A** `git mv israel/* → jurisdictions/il/` first, imports, registry, guard with allowlist, golden proof green; **B** the `JurisdictionPack` interface threaded into `compose`, routes, retention and the audit stamp. Each is green on its own, so either can be reverted.

## Business / product impact
- Makes a second country a new pack instead of edits in the core; today every Israel-direct line added (MUT-667, 656, 670, 671, 725-728) is rework later.
- First code step of epic MUT-738 after the issuer country guard; unblocks MUT-742 (schema), MUT-743 (rules read) and MUT-745 (contract suite).
- Zero user-visible change, so low release risk; the cost is one refactor now versus several later.
