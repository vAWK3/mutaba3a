# MUT-347 — Terms release guard: the environment's own site, and the image's terms on rollback

Epic MUT-322. From the MUT-324 /review pass 1. Relates MUT-324 and MUT-326 (hosts.json: the domain is one input).

## Where things are (read 2026-10-25, HEAD 8804d724)

- `server/src/scripts/check-terms-live.ts`: imports `CURRENT_TERMS` from `../legal.js` (working tree), fetches
  `<origin>/legal/terms-versions.json` and compares the version plus the en/ar sha256. `publicOrigin(env)` has no
  default (MUT-326).
- `server/package.json:37` `terms:check-live`: `MUTABA3A_PUBLIC_ORIGIN="${MUTABA3A_PUBLIC_ORIGIN:-$(npm --prefix .. run --silent hosts -- get landingOrigin)}"`. It
  never passes `--env`, so the hosts CLI always resolves **production**.
- Callers:
  - `scripts/preflight.sh:374-386` (`make release server`);
  - `server/scripts/deploy.sh:106-110`.
  - Both have `ENVIRONMENT` (default production; the Makefile exports it). Neither passes it on.
- **Staging doesn't exist**:
  - only `production.tfvars`;
  - `config/hosts.json` has only `"production"`;
  - `DEPLOYMENT.md:9` says so.
- **Rollback today doesn't roll back.**
  - `DEPLOYMENT.md` §6 says "Roll back the service | `IMAGE_TAG=<old sha> ./scripts/deploy.sh`".
  - But deploy.sh always runs `build:hosted` and `docker build` from the **working tree** (`:160-180`), tags it `<old sha>` and pushes it, which overwrites that tag in Artifact Registry.
  - A dirty tree is allowed when `IMAGE_TAG` is set (`:98`).
  - So a "rollback" deploys today's code under an old label, and runs `prisma migrate deploy` for today's migrations.
  - The terms check reading the working tree is "right" only because the build is the working tree too.
- `IMAGE_TAG` has two meanings today: "tag a fresh build of a dirty tree" (`:98`) and "roll back" (docs).

## Plan

### Part 1: the environment's own site (ticket AC 1)

- `server/package.json` `terms:check-live` passes `--env "${ENVIRONMENT:-production}"` to `hosts get landingOrigin`. Same
  for `email:check` (`mailDomain`, same pattern at line 34), which has the same bug.
- With no staging entry, `ENVIRONMENT=staging` fails loudly: `config/hosts.json: no "staging" environment`. That's correct: when staging is added, its hosts entry is the one input.
- Test (`scripts/__tests__/legal-terms.test.ts`, extend the existing npm-script assertion): the script text contains
  `--env "${ENVIRONMENT:-production}"`, and `hosts get landingOrigin --env production` equals `HOSTS.landingOrigin`.

### Part 2: rollback (ticket AC 2, plus the finding above)

**D1 decided (Basel, 2026-10-25): A, a real rollback.** Options considered:

- **A (recommended): a real rollback.** A new `ROLLBACK_TO=<sha> ./scripts/deploy.sh` (and a `make rollback-server SHA=`):
  1. Requires the image `mutaba3a-api:<sha>` to already exist (`gcloud artifacts docker images describe`).
  2. Skips the bundle, the docker build, the push and `prisma migrate` (migrations are forward-only, and the schema is already ahead).
  3. Runs the terms check against **that sha's terms**: `git show <sha>:server/src/legal.ts` → parse `CURRENT_TERMS`.
     - If the sha predates MUT-324 (no CURRENT_TERMS), or isn't in the clone: refuse unless `SKIP_TERMS_CHECK=1`, with the reason printed.
     - An older version is still listed in `terms-versions.json` (the list is append-only), so a rollback normally passes.
  4. Runs `terraform apply -var image_tag=<sha>` only.
  5. Leaves `IMAGE_TAG` as "tag for a fresh build". Docs: DEPLOYMENT.md §6 rollback row, and `.claude/INFRA.md:152` (still names the Netlify default).
- **B: ticket only.** When `IMAGE_TAG` is set, read the terms from `git show $IMAGE_TAG:…`. This is wrong while deploy.sh still builds the working tree: it would check old terms against a new image. It needs A's build skip to mean anything.
- **C: refuse.** deploy.sh refuses `IMAGE_TAG` equal to an existing registry tag (no overwrite), and DEPLOYMENT.md documents rollback as `terraform apply -var image_tag=<sha>` run by hand. The smallest change, but the operator path has no terms check and no image-exists check.

Shared helper (for A or B): `termsAtCommit(sha)` in `check-terms-live.ts` (`git show` + a strict regex on the
`CURRENT_TERMS` literal; refuse if the shape changes). The CLI takes `--commit <sha>`. Tests in
`server/src/__tests__/check-terms-live.test.ts` use an injected `gitShow`: a current-shape literal, a pre-MUT-324 file (null), a
sha missing from the clone (error), and a malformed literal (error).

### Tests

- Unit tests as above. They're pure and need no network.
- Structural tests in `legal-terms.test.ts`, same style as today. Under A:
  - the deploy.sh rollback branch contains `terms:check-live -- --commit` and no `docker build`;
  - `make rollback-server` exists;
  - DEPLOYMENT.md's rollback row names it.
- Manual (Basel): one real rollback drill to the previous api tag and back (fits the MUT-327 drill day).

## NOT in scope
- Creating a staging environment.
- Server-side enforcement of terms acceptance (TD-180).

## Eng review: outside voice (Claude Plan subagent; codex not installed), folded in

The reviewer verified that `main.tf:100` has no `immutable_tags` and no `cleanup_policies` (old images are kept, and tags can be overwritten).
These findings are **required work** to make D1's "real rollback" true. A rollback that ships today's infra or breaks reads isn't one.

1. **Infra-drift gate (Critical).**
   - `terraform apply -var image_tag=<sha>` would also apply HEAD's main.tf and tfvars. HEAD 8804d724 is already ahead of the deployed api-v0.7.1.
   - Rollback reads the deployed tag from the live service (`SERVICE_VERSION`), then `terraform plan -detailed-exitcode -var image_tag=<deployed>`. Non-empty: refuse ("your checkout's infra differs from what is deployed").
   - Rollback refuses a dirty tree.
2. **Database-backed migration gate (Critical).**
   - Start the proxy. Diff `_prisma_migrations` (the source of truth) against `git ls-tree <sha> server/prisma/migrations`. List what is rolled past; require typed confirmation.
   - Each "Roll back past MUT-…" row in DEPLOYMENT.md (:869-874) becomes a runnable count query that blocks when > 0.
   - Add the missing rows: MUT-333 (`mut333_account_closure` nullable creator columns → P2032 on the old client), MUT-115 (passkeys), MUT-367 (`PENDING_REVIEW` enum).
3. **No overwrite, one branch (Critical + High, the simpler design).**
   - deploy.sh **reuses an image that already exists** for the tag: skip bundle, build and push. That covers the idempotent re-run and the rollback alike.
   - It **refuses to push over an existing tag**.
   - `docker build` adds `org.opencontainers.image.revision=<full sha>` and a `dirty` label. The rollback compares the label to the sha; unlabeled old images get a warning.
   - `ROLLBACK_TO` then adds only: sha ≠ HEAD, skip migrate and pre-roll, gates 1 and 2.
   - Update every place that teaches `IMAGE_TAG=<old sha>`: DEPLOYMENT.md :849, :1068, :1227; pilot-runbook :567; deploy.sh :227.
4. **Step matrix for the rollback, written down in deploy.sh and DEPLOYMENT.md.**
   - **Runs:** the 4 `guard_release` guards (cmek, stripe, sentry, mailer; sentry sets SENTRY_ENABLED for smoke), then the terms check against the sha, terraform apply and smoke.
   - **Skips:** `guard_turnstile_site_key`, `need docker` / `docker info`, `npm ci`, bundle check, Sentry token checks, migrate, pre-roll.
   - **Post-roll repairs:** decided and documented (default: skip, since HEAD's repairs don't belong to the old code).
   - **Smoke `--expect-error-reporting`:** skipped for images from before MUT-148.
5. **Resolving the sha.**
   - `ROLLBACK_TO` accepts `api-vX.Y.Z` or a full or short sha. `git fetch --tags origin`, resolve to a commit, then find the registry tag by prefix in `gcloud artifacts docker tags list`.
   - Refuse when `IMAGE_TAG` and `ROLLBACK_TO` are both set (the Makefile exports IMAGE_TAG).
6. **Terms check on rollback.**
   - Strict parser for the CURRENT_TERMS literal shape used since 949e71d5.
   - A sha before api-v0.6.0 has no CURRENT_TERMS: refuse with an "expected; pass SKIP_TERMS_CHECK=1" message.
7. **Docs.**
   - The portal (dist-hosted) rolls back with the image.
   - Phone builds that need newer endpoints may break.
   - A future registry cleanup policy must keep api-v* tags (note it next to the resource).
   - Keep cmek-cutover.sh's wording consistent.
8. **`--env`.** Use a dedicated `MUTABA3A_ENVIRONMENT` passed by deploy.sh and preflight.sh from their `ENVIRONMENT`, not the generic `ENVIRONMENT`. A failing `hosts get` prints its own error and stops, with no misleading "origin not set".

**Tests (replacing the structural-only list).**
- **Unit, injected `gitShow` / `exec`:** `termsAtCommit`, the migration diff, sha resolution.
- **Structural (legal-terms / tag-release style):**
  - the rollback branch has no `docker build`, `npm ci` or `guard_turnstile_site_key`;
  - the drift `plan -detailed-exitcode` gate and the migration gate are present;
  - deploy.sh refuses to push an existing tag;
  - `tag-release.test.ts:237` (IMAGE_TAG/dirty) updated.
- **Manual drill (Basel, MUT-327 day):** roll back to the previous api tag, then forward again.

Size note: this is now a medium ticket, mostly in deploy.sh, DEPLOYMENT.md and one new `scripts/lib/rollback.sh`. It's independent of 346, 375 and 382.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| Outside Review | in-host Claude Plan subagent (codex not installed) | Independent 2nd opinion | 1 | unavailable (in-host fallback completed) | 13 findings, 3 critical; all folded in as required work |
| Eng Review | `/plan-eng-review` (condensed) | Architecture & tests | 1 | issues_open | rollback bug found in exploration; D1 decided A |

- **VERDICT:** ready to implement via /eng-build MUT-347.

NO UNRESOLVED DECISIONS
