# Mutaba3a release entry points.
#
#   make release web      Netlify frontend  (bump → gates → commit → push main → tag web-v<x>)
#   make release server   Cloud Run API + hosted portal (bump → gates → deploy.sh → tag api-v<x>)
#   make release full     web, then server — each gated and confirmed on its own
#
# All three run scripts/preflight.sh first: clean tree on main, nothing unmerged, no
# stray worktrees, in sync with origin, the right node, and the tools and
# secrets that target needs. A failed check stops the release before anything
# is built, committed, pushed or rolled.
#
# Run `make doctor` any time for a read-only report of the same checks.
#
# GitHub Actions CI (web, server, contracts) runs only when started: `make ci`
# (ADR-153). Each release target shows the last CI result before it asks to
# deploy (scripts/ci-reminder.sh) and ends by reminding you to start CI on what
# it pushed.
#
# Operator steps still owed before a release (an infra change to approve, a
# tfvars value to set) live in docs/operations/before-release.md. Each release
# target prints its open items before it asks to deploy
# (scripts/before-release.sh). Delete an item there once it's done. The server
# target also lists the restore drill when the pilot runbook's §10 has none
# from the last 60 days.

SHELL      := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help

RELEASE_BRANCH ?= main
ENVIRONMENT    ?= production
NODE_MAJOR_REQUIRED ?= 22

# Operator config for the server deploy (GCP_PROJECT_ID, TF_STATE_BUCKET, …).
# Git-ignored; template at deploy.env.example. Plain KEY=value lines, no quotes.
# A value passed on the make command line wins over the file.
DEPLOY_ENV := deploy.env
ifneq ($(wildcard $(DEPLOY_ENV)),)
  include $(DEPLOY_ENV)
endif

# Where the server deploy is pointed. Precedence: make command line, then the
# environment, then deploy.env, then — so a first-time operator needs no setup
# at all — what terraform already recorded:
#   project  ← project_id in <environment>.tfvars
#   bucket   ← the backend bucket of the last `terraform init`
# preflight re-derives both independently and fails on a mismatch, so these
# defaults can never silently point a release at the wrong project. (make
# rollback-server runs no preflight: check GCP_PROJECT_ID and TF_STATE_BUCKET,
# which it prints, before you confirm.)
TF_DIR       := server/infrastructure/terraform
# MUT-487 (ADR-232): until the cutover, config/gcp.json says `"cutover": "pending"` and every server command acts
# on the old project as LEGACY_STACK=1 would; LEGACY_STACK=0 on the command line still wins. C3 (DEPLOYMENT.md §6d)
# sets it to "done". server/scripts/lib/legacy-stack.sh reads the same key for deploy.sh and preflight.
GCP_CUTOVER  := $(shell sed -n 's/.*"cutover"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' config/gcp.json 2>/dev/null | head -1)
ifeq ($(GCP_CUTOVER),pending)
LEGACY_STACK ?= 1
endif
# MUT-487 (AM5, AM8): LEGACY_STACK=1 acts on the old project from legacy.tfvars; each project keeps its own
# terraform data dir (.terraform-<project>, deploy.sh's TF_DATA_DIR), so the bucket is read from that one.
# Before legacy.tfvars exists (scripts/legacy-tfvars.sh makes it from production.tfvars on the first server
# command) the project comes from production.tfvars, and the bucket from the data dir every release used before
# the move, .terraform.
ifeq ($(LEGACY_STACK),1)
TFVARS_FILE  := $(firstword $(wildcard $(TF_DIR)/legacy.tfvars) $(TF_DIR)/$(ENVIRONMENT).tfvars)
else
TFVARS_FILE  := $(TF_DIR)/$(ENVIRONMENT).tfvars
endif

GCP_PROJECT_ID  ?= $(shell sed -n 's/^project_id[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' $(TFVARS_FILE) 2>/dev/null | head -1)
ifeq ($(LEGACY_STACK),1)
TFSTATE_FILE := $(firstword $(wildcard $(TF_DIR)/.terraform-$(GCP_PROJECT_ID)/terraform.tfstate) $(TF_DIR)/.terraform/terraform.tfstate)
else
TFSTATE_FILE := $(TF_DIR)/.terraform-$(GCP_PROJECT_ID)/terraform.tfstate
endif
TF_STATE_BUCKET ?= $(shell sed -n 's/.*"bucket"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' $(TFSTATE_FILE) 2>/dev/null | head -1)

export RELEASE_BRANCH ENVIRONMENT NODE_MAJOR_REQUIRED
# MUT-523: each project's region from config/gcp.json (europe-west1 for mtb3a-production, me-west1 for
# malafat-production while LEGACY_STACK=1); deploy.sh and preflight refuse a GCP_REGION or tfvars region that disagrees.
GCP_REGION ?= $(shell bash -c 'source server/scripts/lib/legacy-stack.sh && gcp_region_of config/gcp.json "$$1" "$$2"' _ '$(ENVIRONMENT)' '$(GCP_PROJECT_ID)' 2>/dev/null)
# MUT-523: who server commands act as, per checkout (deploy.env), never machine-wide. Both or neither; deploy.sh,
# project-move.sh, restore-drill.sh and preflight check them (server/scripts/lib/gcp-identity.sh). Exported here as
# gcloud's and the client libraries' own variables too, so every recipe below (db:migrate:status, provision) agrees.
ifneq ($(strip $(GCP_ACCOUNT)),)
export CLOUDSDK_CORE_ACCOUNT := $(GCP_ACCOUNT)
endif
ifneq ($(strip $(GCP_ADC_FILE)),)
export GOOGLE_APPLICATION_CREDENTIALS := $(patsubst ~/%,$(HOME)/%,$(GCP_ADC_FILE))
endif

export GCP_PROJECT_ID TF_STATE_BUCKET GCP_REGION ARTIFACT_REPO LEGACY_STACK GCP_ACCOUNT GCP_ADC_FILE
export IMAGE_TAG PROXY_PORT AUTO_APPROVE
# MUT-155: the portal's PostHog key reaches `npm run build:hosted` inside deploy.sh
export MUTABA3A_POSTHOG_KEY
# MUT-149: and the portal's Sentry DSN. The upload token is not exported here: release-server passes it to deploy.sh only
export MUTABA3A_SENTRY_DSN
# MUT-368: the portal's Turnstile site key (public), for build:hosted; deploy.sh refuses a test key once mail is on
export MUTABA3A_TURNSTILE_SITE_KEY
# Where release-server finds the source-map upload token when SENTRY_AUTH_TOKEN isn't set (release-kit Keychain rule).
# Looked up only when the portal has a DSN: with no DSN the build needs no token.
SENTRY_TOKEN_KEYCHAIN_SERVICE := release-kit
SENTRY_TOKEN_KEYCHAIN_ACCOUNT := barmajiyat/SENTRY_AUTH_TOKEN

C_BOLD  := \033[1m
C_DIM   := \033[2m
C_GREEN := \033[0;32m
C_CYAN  := \033[0;36m
C_YEL   := \033[1;33m
C_OFF   := \033[0m

# `make release web` / `make release server`: swallow the second word so make
# does not try to build a target called "web".
ifeq (release,$(firstword $(MAKECMDGOALS)))
  RELEASE_ARGS := $(wordlist 2,$(words $(MAKECMDGOALS)),$(MAKECMDGOALS))
  ifneq ($(RELEASE_ARGS),)
    $(eval $(RELEASE_ARGS):;@:)
  endif
endif
ifeq (ci,$(firstword $(MAKECMDGOALS)))
  CI_ARGS := $(wordlist 2,$(words $(MAKECMDGOALS)),$(MAKECMDGOALS))
  ifneq ($(CI_ARGS),)
    $(eval $(CI_ARGS):;@:)
  endif
endif
ifeq (create,$(firstword $(MAKECMDGOALS)))
  CREATE_ARGS := $(wordlist 2,$(words $(MAKECMDGOALS)),$(MAKECMDGOALS))
  ifneq ($(CREATE_ARGS),)
    $(eval $(CREATE_ARGS):;@:)
  endif
endif

# Printed at the end of each release: CI no longer starts on push.
CI_REMINDER = printf '\n$(C_YEL)Reminder: CI runs only when started. Run it on what you just pushed: make ci %s$(C_OFF)\n\n'

.PHONY: help release release-web release-server release-full rollback-server ci create \
        preflight-web preflight-server doctor \
        check-web check-server check check-e2e qa-view \
        bump-web bump-server \
        migrate-status clean-dist

# ---------------------------------------------------------------------------

help:
	@printf '$(C_BOLD)Mutaba3a — release$(C_OFF)\n\n'
	@printf '  $(C_GREEN)make release web$(C_OFF)       deploy the frontend to Netlify (push to $(RELEASE_BRANCH))\n'
	@printf '  $(C_GREEN)make release server$(C_OFF)    deploy the API + hosted portal to Cloud Run ($(ENVIRONMENT))\n'
	@printf '  $(C_GREEN)make release full$(C_OFF)      web, then server — each gated and confirmed on its own\n'
	@printf '  $(C_DIM)  after a terms bump: make release web, wait for Netlify, then make release server$(C_OFF)\n'
	@printf '  $(C_GREEN)make rollback-server SHA=<sha|api-vX.Y.Z>$(C_OFF)   roll the API + portal back to that commit'"'"'s image (no build, no migration)\n'
	@printf '\n$(C_BOLD)Accounts$(C_OFF) $(C_DIM)(live admin API of $(ENVIRONMENT); prompts, then confirms)$(C_OFF)\n'
	@printf '  $(C_GREEN)make create user$(C_OFF)       a person with their personal profile (optionally joining an existing firm)\n'
	@printf '  $(C_GREEN)make create business$(C_OFF)   a new firm, then its first person (personal profile + the firm'"'"'s)\n'
	@printf '\n$(C_BOLD)GitHub Actions CI$(C_OFF) $(C_DIM)(manual only)$(C_OFF)\n'
	@printf '  make ci [web|server|contracts|all]   start CI on origin/$(RELEASE_BRANCH) (default: all)\n'
	@printf '\n$(C_BOLD)Checks only — change nothing$(C_OFF)\n'
	@printf '  make doctor            run every preflight check for both targets\n'
	@printf '  make preflight-web     release-readiness for the web target\n'
	@printf '  make preflight-server  release-readiness for the server target\n'
	@printf '  make check-web         lint + typecheck + unit tests + bundle guard\n'
	@printf '  make check-server      lint + typecheck + tests + openapi + build\n'
	@printf '  make check             both of the above\n'
	@printf '  make check-e2e         release-qa core-tier specs (not part of a release)\n'
	@printf '  make qa-view           open the latest release-qa report\n'
	@printf '  make migrate-status    pending prisma migrations against $(ENVIRONMENT)\n'
	@printf '\n$(C_BOLD)Pieces$(C_OFF)\n'
	@printf '  make bump-web          choose patch/minor/major for the app version\n'
	@printf '  make bump-server       choose patch/minor/major for the API version\n'
	@printf '  make clean-dist        remove dist-web/ dist-hosted/\n'
	@printf '\n$(C_BOLD)Overrides$(C_OFF) $(C_DIM)(prefix any target)$(C_OFF)\n'
	@printf '  ALLOW_DIRTY=1 ALLOW_UNMERGED=1 ALLOW_WORKTREES=1 ALLOW_NODE_MAJOR=1\n'
	@printf '  SKIP_REMOTE=1          offline: do not contact origin or GCP\n'
	@printf '  SKIP_TERMS_CHECK=1     server: skip the terms-are-live check (an emergency fix that keeps the terms version)\n'
	@printf '  LEGACY_STACK=1         server: act on the OLD project (forwarder, rollback of the move, teardown; MUT-487).\n'
	@printf '                         On by default until the cutover (config/gcp.json "cutover": "pending"); LEGACY_STACK=0 overrides\n'
	@printf '  SKIP_INGRESS_GUARD=1   server: skip the closed-service release guard (a restore or project move holds it closed)\n'
	@printf '  SKIP_STRIPE_GUARD=1    server: skip the Stripe release guard (MUT-360; on by default)\n'
	@printf '  ALLOW_MIN_BUILD_CHANGE=IOS_MIN_BUILD,…  server: let this release change those phone minimum builds (MUT-471)\n'
	@printf '  SKIP_MIN_BUILD_GUARD=1 server: skip the min-build release guard (only when it cannot read terraform or Cloud Run)\n'
	@printf '  BUMP=patch|minor|major|keep    skip the version prompt\n'
	@printf '  AUTO=1                 skip the final "deploy now?" confirmation\n'
	@printf '  RELEASE_BRANCH=  ENVIRONMENT=  GCP_PROJECT_ID=  TF_STATE_BUCKET=\n'
	@printf '\n$(C_DIM)node $(NODE_MAJOR_REQUIRED) is required for the gates: nvm use $(NODE_MAJOR_REQUIRED)$(C_OFF)\n\n'

release:
	@case '$(RELEASE_ARGS)' in \
	  web)    $(MAKE) --no-print-directory release-web ;; \
	  server) $(MAKE) --no-print-directory release-server ;; \
	  full)   $(MAKE) --no-print-directory release-full ;; \
	  '')     printf 'usage: make release web | make release server | make release full\n' >&2; exit 2 ;; \
	  *)      printf 'unknown release target "%s" — expected web, server, or full\n' '$(RELEASE_ARGS)' >&2; exit 2 ;; \
	esac

# ---------------------------------------------------------------------------
# Accounts — operator-issued, no signup (ADR-037, TD-018). Both flows are
# server/scripts/provision-account.sh: it reads the admin token from Secret
# Manager into the environment only, defaults the URL from config/hosts.json,
# asks for the rest, shows a summary and confirms before calling the live API.
# GCP_PROJECT_ID comes from the same place the server release gets it.
# ---------------------------------------------------------------------------

create:
	@case '$(CREATE_ARGS)' in \
	  user|business) ;; \
	  '')  printf 'usage: make create user | make create business\n' >&2; exit 2 ;; \
	  *)   printf 'unknown create target "%s" — expected user or business\n' '$(CREATE_ARGS)' >&2; exit 2 ;; \
	esac; \
	[ -n "$${GCP_PROJECT_ID}" ] || { printf 'GCP_PROJECT_ID is unknown: set it in deploy.env or on the command line\n' >&2; exit 1; }; \
	cd server && GCP_PROJECT_ID="$${GCP_PROJECT_ID}" ./scripts/provision-account.sh '$(CREATE_ARGS)'

# ---------------------------------------------------------------------------
# CI — the workflows run only when started (workflow_dispatch), on the pushed
# $(RELEASE_BRANCH), so push first.
# ---------------------------------------------------------------------------

ci:
	@case '$(CI_ARGS)' in \
	  web|server|contracts) set -- '$(CI_ARGS)' ;; \
	  all|'') set -- web server contracts ;; \
	  *) printf 'unknown CI target "%s" — expected web, server, contracts, or all\n' '$(CI_ARGS)' >&2; exit 2 ;; \
	esac; \
	for wf in "$$@"; do \
	  gh workflow run "$$wf-ci.yml" --ref $(RELEASE_BRANCH); \
	  printf '$(C_GREEN)✓ %s CI started on %s$(C_OFF)\n' "$$wf" '$(RELEASE_BRANCH)'; \
	done; \
	printf '$(C_DIM)Follow it: gh run list --limit 5, or gh run watch$(C_OFF)\n'

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------

preflight-web:
	@scripts/preflight.sh web

preflight-server:
	@server/scripts/legacy-tfvars.sh
	@scripts/preflight.sh server

doctor:
	@scripts/preflight.sh web || true
	@server/scripts/legacy-tfvars.sh || true
	@scripts/preflight.sh server || true

# ---------------------------------------------------------------------------
# Gates — CLAUDE.md phase 4. Nothing ships that has not passed these.
# ---------------------------------------------------------------------------

check-web:
	@printf '\n$(C_CYAN)▶ lint$(C_OFF)\n';               npm run --silent lint
	@printf '\n$(C_CYAN)▶ typecheck$(C_OFF)\n';          npm run --silent typecheck
	@printf '\n$(C_CYAN)▶ unit tests$(C_OFF)\n';         npm run --silent test:run
	@printf '\n$(C_CYAN)▶ hosted api types$(C_OFF)\n';   npm run --silent hosted:types:check
	@printf '\n$(C_CYAN)▶ builds + bundle guard$(C_OFF)\n'; npm run --silent test:bundles
	@printf '\n$(C_GREEN)✓ web gates passed$(C_OFF)\n'

check-server:
	@printf '\n$(C_CYAN)▶ lint$(C_OFF)\n';          cd server && npm run --silent lint
	@printf '\n$(C_CYAN)▶ typecheck$(C_OFF)\n';     cd server && npm run --silent typecheck
	@printf '\n$(C_CYAN)▶ tests$(C_OFF)\n';         cd server && npm run --silent test
	@printf '\n$(C_CYAN)▶ openapi in sync$(C_OFF)\n'; cd server && npm run --silent openapi:check
	@printf '\n$(C_CYAN)▶ build$(C_OFF)\n';         cd server && npm run --silent build
	@printf '\n$(C_GREEN)✓ server gates passed$(C_OFF)\n'

check: check-web check-server

# release-qa (MUT-97, companion to Malafat's MAL-1007): isolated worktree +
# its own dev server, recorded video, review page. Not part of a release: it
# needs browsers installed, and a flaky browser should not be able to block a
# deploy whose unit and bundle gates are green. Run it deliberately.
# See qa/qa.config.mjs and ~/Work/tools/release-qa/SKILL.md.
check-e2e:
	@release-qa release --no-open

# Review page for release-qa (qa/runs/<slug>/): served in the background on this repo's own
# port, with a Run & record button per feature. Run `release-qa release` to refresh it.
qa-view:
	@release-qa serve --detach

migrate-status:
	@cd server && TF_STATE_BUCKET=$${TF_STATE_BUCKET:?set TF_STATE_BUCKET} npm run --silent db:migrate:status

# ---------------------------------------------------------------------------
# Version
# ---------------------------------------------------------------------------

bump-web:
	@scripts/bump-version.sh web

bump-server:
	@scripts/bump-version.sh server

# ---------------------------------------------------------------------------
# release web — Netlify builds whatever lands on $(RELEASE_BRANCH), so the
# deploy *is* the push. Gates run before the bump so a failure leaves the
# version untouched; the build runs after, with the new version baked in.
# ---------------------------------------------------------------------------

release-web: preflight-web
	@printf '\n$(C_BOLD)Gates$(C_OFF)\n'
	@npm run --silent lint
	@npm run --silent typecheck
	@npm run --silent test:run
	@npm run --silent hosted:types:check
	@printf '$(C_GREEN)✓ lint, typecheck, unit tests, api types$(C_OFF)\n'
	@scripts/bump-version.sh web
	@version=$$(node -p "require('./package.json').version"); \
	if ! npm run --silent release:notes -- "$$version"; then \
	  printf '\n$(C_YEL)Write what v%s changes for people in release-notes.json (en + ar), then re-run — the release commit includes it.$(C_OFF)\n' "$$version"; \
	  printf '$(C_DIM)Undo the bump with: git checkout -- package.json package-lock.json$(C_OFF)\n'; \
	  exit 1; \
	fi; \
	printf '\n$(C_BOLD)Building v%s$(C_OFF)\n' "$$version"; \
	if ! npm run --silent test:bundles; then \
	  printf '\n$(C_YEL)Build failed after the version bump. Nothing was committed.$(C_OFF)\n'; \
	  printf '$(C_DIM)Undo the bump with: git checkout -- package.json package-lock.json$(C_OFF)\n'; \
	  exit 1; \
	fi; \
	printf '\n$(C_BOLD)About to deploy the web app$(C_OFF)\n'; \
	printf '  version   %s\n' "$$version"; \
	printf '  branch    %s → origin (Netlify builds it)\n' '$(RELEASE_BRANCH)'; \
	printf '  commits   %s ahead of origin, plus the version bump\n' \
	  "$$(git rev-list --count origin/$(RELEASE_BRANCH)..HEAD 2>/dev/null || echo '?')"; \
	scripts/ci-reminder.sh web; \
	scripts/before-release.sh web; \
	if ! scripts/confirm.sh 'Push to $(RELEASE_BRANCH) and let Netlify deploy it?'; then \
	  printf '$(C_YEL)The version bump is still in your working tree — undo it or re-run.$(C_OFF)\n'; \
	  exit 0; \
	fi; \
	git add package.json package-lock.json release-notes.json; \
	git diff --cached --quiet || git commit -m "release: web v$$version"; \
	git push origin $(RELEASE_BRANCH); \
	scripts/tag-release.sh web "$$version" --push; \
	printf '\n$(C_GREEN)✓ v%s pushed to %s — Netlify is building$(C_OFF)\n' "$$version" '$(RELEASE_BRANCH)'; \
	printf '$(C_DIM)Watch the build, then hard-reload the site and confirm the version in Settings.$(C_OFF)\n'; \
	printf '\n$(C_BOLD)Live OAuth client document (MUT-387)$(C_OFF)\n'; \
	oauth_ok=1; npm run --silent release:oauth-client || oauth_ok=0; \
	$(CI_REMINDER) web; \
	if [ "$$oauth_ok" = 0 ]; then \
	  printf '$(C_YEL)v%s is pushed, but the live OAuth client document is wrong (above). Re-check with: OAUTH_CLIENT_WAIT_SECONDS=0 npm run release:oauth-client$(C_OFF)\n' "$$version"; \
	  exit 1; \
	fi

# ---------------------------------------------------------------------------
# release server — server/scripts/deploy.sh owns the rollout (image, migrate,
# terraform apply, smoke). This target is the gate in front of it: checks,
# version, a commit that names what ships, and the push that makes the
# deployed sha reachable by anyone else. deploy.sh refuses a dirty tree, so
# the preflight fails on one and the tree is checked again right before the
# version commit: a pushed `release: api vX` must never deploy nothing.
# ---------------------------------------------------------------------------

release-server: preflight-server
	@printf '\n$(C_BOLD)Gates$(C_OFF)\n'
	@cd server && npm run --silent lint
	@cd server && npm run --silent typecheck
	@cd server && npm run --silent test
	@cd server && npm run --silent openapi:check
	@cd server && npm run --silent build
	@printf '$(C_GREEN)✓ lint, typecheck, tests, openapi, build$(C_OFF)\n'
	@scripts/bump-version.sh server
	@version=$$(node -p "require('./server/package.json').version"); \
	bumped=no; git diff --quiet -- server/package.json server/package-lock.json || bumped=yes; \
	printf '\n$(C_BOLD)About to deploy the API + hosted portal$(C_OFF)\n'; \
	printf '  version     %s%s\n' "$$version" "$$([ $$bumped = yes ] && echo ' (new — will be committed)' || true)"; \
	printf '  image tag   %s\n' "$$([ $$bumped = yes ] && echo 'the version commit' || git rev-parse --short HEAD)"; \
	printf '  project     %s\n' "$${GCP_PROJECT_ID}"; \
	printf '  region      %s\n' "$${GCP_REGION:-unset}"; \
	printf '  acting as   %s\n' "$${GCP_ACCOUNT:-the machine'\''s default gcloud account and ADC}"; \
	printf '  environment %s\n' '$(ENVIRONMENT)'; \
	printf '\n$(C_DIM)deploy.sh will: build dist-hosted → push the image → prisma migrate deploy\n  → terraform apply → smoke. Migrations are forward-only.$(C_OFF)\n'; \
	scripts/ci-reminder.sh server; \
	scripts/before-release.sh server; \
	token="$${SENTRY_AUTH_TOKEN:-}"; \
	if [ -n "$${MUTABA3A_SENTRY_DSN:-}" ] && [ -z "$$token" ]; then \
	  token=$$(security find-generic-password -s '$(SENTRY_TOKEN_KEYCHAIN_SERVICE)' -a '$(SENTRY_TOKEN_KEYCHAIN_ACCOUNT)' -w 2>/dev/null || true); \
	  if [ -z "$$token" ]; then \
	    printf '\n$(C_YEL)MUTABA3A_SENTRY_DSN is set but there is no upload token (SENTRY_AUTH_TOKEN, or Keychain %s / %s): the portal would ship unreadable crash stacks. Nothing was committed or pushed.$(C_OFF)\n' '$(SENTRY_TOKEN_KEYCHAIN_SERVICE)' '$(SENTRY_TOKEN_KEYCHAIN_ACCOUNT)'; \
	    if [ $$bumped = yes ]; then printf '$(C_DIM)The version bump is still in your working tree — undo it or re-run.$(C_OFF)\n'; fi; \
	    exit 1; \
	  fi; \
	fi; \
	if ! scripts/confirm.sh 'Deploy to Cloud Run now?'; then \
	  if [ $$bumped = yes ]; then printf '$(C_YEL)The version bump is still in your working tree — undo it or re-run.$(C_OFF)\n'; fi; \
	  exit 0; \
	fi; \
	stray=$$(git status --porcelain | grep -v -E '^ M server/package(-lock)?\.json$$' || true); \
	if [ -n "$$stray" ]; then \
	  printf '\n$(C_YEL)The working tree changed since the preflight — deploy.sh refuses a dirty tree. Nothing was committed or pushed.$(C_OFF)\n'; \
	  printf '%s\n' "$$stray" | sed 's/^/        /'; \
	  if [ $$bumped = yes ]; then printf '$(C_DIM)The version bump is still in your working tree — commit the rest, then re-run.$(C_OFF)\n'; fi; \
	  exit 1; \
	fi; \
	if [ $$bumped = yes ]; then \
	  git add server/package.json server/package-lock.json; \
	  git commit -m "release: api v$$version"; \
	fi; \
	sha=$$(git rev-parse --short HEAD); \
	if [ "$$(git rev-list --count origin/$(RELEASE_BRANCH)..HEAD 2>/dev/null || echo 0)" != "0" ]; then \
	  printf '$(C_CYAN)▶ pushing %s so %s is reachable by everyone else$(C_OFF)\n' '$(RELEASE_BRANCH)' "$$sha"; \
	  git push origin $(RELEASE_BRANCH); \
	fi; \
	(cd server && SENTRY_AUTH_TOKEN="$$token" ./scripts/deploy.sh) && \
	scripts/tag-release.sh api "$$version" --push && \
	$(CI_REMINDER) server

# ---------------------------------------------------------------------------
# release full — web then server, back to back (ADR-102 overrides ADR-043's
# 2026-10-12 server-first addendum). The web build ships the terms text the
# server asks people to accept, and the server preflight refuses a version the
# public site doesn't list yet (MUT-324 D11). After a terms bump, Netlify must
# finish building before the server half passes that check, so release web,
# wait for the build, then release server. The portal ships inside the server
# image, so no frontend here calls an API the release hasn't shipped.
# Each half keeps its own preflight, gates, version bump and confirmation;
# declining one does not block the other.
# ---------------------------------------------------------------------------

release-full: release-web release-server

# ---------------------------------------------------------------------------
# rollback server — MUT-347: roll the API + hosted portal back to the image a
# commit already has in Artifact Registry. deploy.sh's ROLLBACK_TO builds and
# migrates nothing; it refuses a dirty tree, IMAGE_TAG, infrastructure drift
# and a "Roll back past" migration with rows (server/scripts/lib/rollback.sh).
# No preflight: that checks HEAD, and a rollback checks the commit.
# ---------------------------------------------------------------------------

rollback-server:
	@if [ -z '$(SHA)' ]; then printf 'usage: make rollback-server SHA=<sha|api-vX.Y.Z>\n' >&2; exit 2; fi
	@cd server && ROLLBACK_TO='$(SHA)' ./scripts/deploy.sh

# ---------------------------------------------------------------------------

clean-dist:
	@rm -rf dist-web dist-hosted server/dist-hosted
	@printf '$(C_GREEN)✓ build output removed$(C_OFF)\n'
