# Money v1 — Milestone 1 implementation proposal and report

- **Date:** 2026-10-08 · **Artifact 3 of 3** · **Architecture:** Option B (ADR-024/025)
- **M1 goal (plan §16):** MUT — API foundation, organization isolation, credentials. MAL — secure connection settings. **Exit criterion: a Partner can connect securely.**

## 1. Mutaba3a side — done

| Deliverable | Where | Status |
|---|---|---|
| Service package | `server/` (`@mutaba3a/api`) | ✅ builds (`npm run build` → `dist/`), type-checks, lints |
| Control-plane schema + migration | `server/prisma/schema.prisma`, `prisma/migrations/20261008093850_m1_control_tables` | ✅ applied to the local test database |
| API-key auth, scopes, environment split, revocation, expiry | `server/src/auth/*` | ✅ |
| Rate limiting (per key) | `server/src/rate-limit.ts` | ✅ in-process (TD-017) |
| Idempotency middleware + table | `server/src/idempotency.ts` | ✅ |
| Audit (append-only) | `audit_events` via `LedgerStore.audit` | ✅ |
| Error envelope + codes | `server/src/errors.ts` | ✅ |
| Routes: health/ready, `/v1/integration`, bind, disconnect, admin provisioning | `server/src/routes/*` | ✅ |
| OpenAPI 3.1 contract, generate + check | `server/openapi/openapi.yaml` | ✅ 802 lines, `openapi:check` passes |
| Provisioning CLI | `server/src/scripts/provision.ts` | ✅ |
| Dockerfile (multi-stage, non-root, healthcheck) | `server/Dockerfile` | ✅ written; image build not yet run in CI (TD-019) |
| Tests | 59 across 6 files; Postgres contract suite via `npm run test:db` | ✅ all green locally |
| ADR override (MUT-30) and architecture ADR (MUT-32) | `.claude/DECISIONS.md` ADR-024/025 | ✅ |
| Knowledge files | CHANGELOG, TECH_DEBT (TD-017/018/019), TEST_PLAN, SYSTEM_OVERVIEW | ✅ |

### Deployment (operator; nothing here is executed by the agent)

Shipped 2026-10-08, after the M1 code landed on `main` (ADR-026):

| Artifact | Where |
|---|---|
| Terraform: Cloud SQL 16, secrets (generated), service account + IAM, Artifact Registry, service, uptime check — production only | `server/infrastructure/terraform/` |
| Rollout script, all on the operator's machine: local docker build + push → `prisma migrate deploy` via Cloud SQL Auth Proxy → apply → smoke | `server/scripts/deploy.sh` |
| Smoke test (M1 exit criterion against a live deployment) | `server/src/smoke.ts`, `npm run smoke` |
| CI (TD-019) | `.github/workflows/server-ci.yml` |
| Dockerfile: single runtime image; migrations run from `server/` on the operator's machine, never in the image | `server/Dockerfile` |
| Runbook: prerequisites → staging → proof → first firm → Malafat wiring → production → day 2 | `server/DEPLOYMENT.md` |
| Malafat: `MUTABA3A_API_URL` mounted from `malafat-web-mutaba3a-api-url`, release gate + release step | `web/crm-platform/scripts/{release,check-required-secrets,release-steps}.ts` |

The earlier seven-step list (Cloud SQL by hand, secrets by hand, a Terraform
module "not written in M1") is superseded by the table above.

## 2. Malafat side — implemented 2026-10-08 (same session)

All rows below landed in `web/crm-platform` (see its `.claude/CHANGELOG.md` entry
"Money v1 Milestone 1" and ADR-150). Verification: 108 new/updated tests green
(client 17, service 14, routes 22, i18n 6, nav 49), `pnpm openapi:generate`,
`check:api-contract` and `i18n:check` as recorded in the final report. The
Mutaba3a service gained `POST /v1/api-keys/self/revoke` so rotation can retire
the previous key (60 tests).

| Deliverable | Where | Notes |
|---|---|---|
| `MoneyIntegration` model (per-tenant) | `packages/db/prisma/schema/53-money-integration.prisma` + migration + `release-steps.ts` entry | encrypted key (field-encryption service, unconditional like message bodies), masked label, organization id/name/slug, scopes, missing scopes, status, lastSuccessAt, lastErrorCode, connectedByUserId, connectedAt, disconnectedAt. One row per tenant |
| Mutaba3a server-side client | `apps/web/src/features/money/application/mutaba3a-client.ts` | `AbortSignal.timeout`, `X-Request-Id`, never logs the key; maps every error code to `MoneyConnectionError` reasons |
| Connection service | `features/money/application/connection-service.ts` | validate → bind (Idempotency-Key = tenant id + attempt) → store encrypted; rotate = validate new → bind with new key → revoke old via disconnect only if org matches → swap; disconnect = call disconnect, delete key, keep audit row; test = GET /v1/integration |
| Routes + specs | `apps/web/src/app/api/admin/money/integration/route.ts` (GET/POST/DELETE), `…/rotate/route.ts`, `…/test/route.ts`, each with `route.spec.ts` | `requireApiWriteAccess` for writes, `requireApiSession` for GET, `session.role !== "PARTNER"` → `apiError(InsufficientRole, …, 403)`, `parseRequestBody` |
| Gate | `gate-config.ts` `money` with `roles: ["PARTNER"]`; `featureGate.json` strings | add-on entitlement deferred to MAL-870 |
| Nav | `NavNode.roles?: UserRole[]`; `money` node in `work` after `time`; sidebar/more filtering; nav tests' counts updated; `sidebar.json` strings | |
| Settings hub link | `settingsLinks` `money` with gate | |
| Pages | `/admin/money/settings` (connection page per UX brief D13), `/admin/money` (overview with not-connected / connected-empty states) | `FeatureGatePage gate="money"` |
| i18n | `packages/core/src/i18n/messages/{en,ar,he}/money.json` + `request.ts` registration + parity test | |
| Tests | route tests (role matrix, error mapping, never-echo-the-key), service tests with a mocked fetch, i18n parity, nav tests | |
| Knowledge | CHANGELOG, DECISIONS (ADR), COMPONENT_REGISTRY, RBAC_MATRIX row, TEST_PLAN; `pnpm openapi:generate` | |

## 3. Acceptance criteria for M1 (plan §16.2) and their status

| Criterion | MUT | MAL |
|---|---|---|
| Implementation merged | ✅ `main` (committed by the product owner 2026-10-08) | ✅ `main` |
| OpenAPI updated | ✅ `server/openapi/openapi.yaml` | ✅ `openapi/openapi.yaml` regenerated |
| Contract tests pass | ✅ route + store contract, in CI | ✅ 108 tests |
| Migrations validated | ✅ locally + CI; against Cloud SQL by `deploy.sh` through the proxy (operator) | ✅ `release-steps.ts` carries the tenant step |
| Authorization tests pass | ✅ every 401/403 code, isolation | ✅ role matrix |
| Works against a real test MUT environment | ⏳ `DEPLOYMENT.md` §2–3 (operator) | ⏳ `DEPLOYMENT.md` §5 |
| Errors handled explicitly | ✅ | ✅ closed reason vocabulary |
| No known financial-integrity defect | n/a in M1 (no financial objects yet) | n/a |
| Docs reflect behaviour | ✅ README, ADRs, contract doc, DEPLOYMENT.md | ✅ CHANGELOG, ADR-150, INFRA |

## 4. Risks and open product decisions

1. **Self-serve accounts (TD-018).** The plan says "the Partner obtains an API key from Mutaba3a". Until Mutaba3a has accounts, an operator issues keys. Decide whether M2 includes a minimal Mutaba3a web console or whether operator provisioning is acceptable for the first firms.
2. **Hosting cost and residency.** A second Cloud Run service + Cloud SQL database. Residency must match the firm's CRM region; multi-region later means multiple deployments.
3. **Desktop ↔ hosted service.** ADR-013 still forbids cloud sync for the desktop. The Mutaba3a desktop cannot see a firm's hosted ledger until a further ADR + MUT-27 transport land. Malafat's Money works without it.
4. **Rate limiting across instances (TD-017)** before horizontal scaling.
5. ~~CI (TD-019) for `server/`~~ — resolved 2026-10-08 (`server-ci.yml`).
6. **Domain gaps are the real M2–M6 work:** allocations, reversals, installments, agreements, effective-dated VAT, retainer charges and scheduler all have to be built new (audit §2.2); the desktop contributes disciplines and a few pure modules, not objects.
