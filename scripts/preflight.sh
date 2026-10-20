#!/usr/bin/env bash
#
# Release preflight — everything that must be true before a deploy.
#
#   scripts/preflight.sh web      # Netlify frontend (push to main)
#   scripts/preflight.sh server   # Cloud Run API + hosted portal
#
# Every check prints a line; nothing is silently skipped. The script exits 1
# if any check FAILs, 0 if the worst is a WARN. It changes nothing on disk and
# touches the network only to `git fetch`, to ask gcloud who you are, and (server)
# to read the public site's terms manifest.
#
# Escape hatches (set to 1 to downgrade a FAIL to a WARN without asking), for
# the cases where you know better than the check. Left unset, each of these
# asks interactively whether to continue or stop instead of hard-failing:
#   ALLOW_DIRTY        uncommitted changes in the working tree
#   ALLOW_UNMERGED     local branches not merged into the release branch
#   ALLOW_WORKTREES    extra git worktrees still checked out
#   ALLOW_NODE_MAJOR   a node major other than the supported one
#   SKIP_REMOTE        do not contact origin (offline)
#   SKIP_TERMS_CHECK   server: do not check the terms are live (an emergency fix that keeps the version)
#
# Other knobs:
#   RELEASE_BRANCH     branch a release must come from (default: main)
#   ENVIRONMENT        server terraform environment   (default: production)

set -uo pipefail

MODE="${1:-}"
case "$MODE" in
  web|server) ;;
  *) echo "usage: $0 <web|server>" >&2; exit 2 ;;
esac

RELEASE_BRANCH="${RELEASE_BRANCH:-main}"
ENVIRONMENT="${ENVIRONMENT:-production}"
NODE_MAJOR_REQUIRED="${NODE_MAJOR_REQUIRED:-22}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'
CYAN=$'\033[0;36m'; DIM=$'\033[2m'; BOLD=$'\033[1m'; NC=$'\033[0m'

FAILS=0
WARNS=0

ok()   { printf '  %s✓%s %s\n' "$GREEN" "$NC" "$1"; }
warn() { printf '  %s!%s %s\n' "$YELLOW" "$NC" "$1"; WARNS=$((WARNS + 1)); }
bad()  { printf '  %s✗%s %s\n' "$RED" "$NC" "$1"; FAILS=$((FAILS + 1)); }
hint() { printf '      %s%s%s\n' "$DIM" "$1" "$NC"; }
head_() { printf '\n%s%s%s\n' "$BOLD" "$1" "$NC"; }

# fail_or_warn <override-var-name> <message> — FAIL unless the override is set.
fail_or_warn() {
  local var="$1" msg="$2"
  if [[ "$(eval "echo \${$var:-0}")" == "1" ]]; then
    warn "$msg ${DIM}($var=1)${NC}"
  else
    bad "$msg"
  fi
}

# fail_or_confirm <override-var-name> <question> <warn-msg> <fail-msg> — WARN
# if the override is set; otherwise ask interactively whether to continue,
# and FAIL if the answer is no (or there is no terminal to ask).
fail_or_confirm() {
  local var="$1" question="$2" warn_msg="$3" fail_msg="$4"
  if [[ "$(eval "echo \${$var:-0}")" == "1" ]]; then
    warn "$warn_msg ${DIM}($var=1)${NC}"
  elif "$REPO_ROOT/scripts/confirm.sh" "$question"; then
    warn "$warn_msg (confirmed to continue)"
  else
    bad "$fail_msg"
  fi
}

have() { command -v "$1" >/dev/null 2>&1; }

printf '%s%s preflight %s%s\n' "$BOLD" "$CYAN" "$MODE" "$NC"

# ---------------------------------------------------------------------------
# Toolchain
# ---------------------------------------------------------------------------
head_ "Toolchain"

if have node; then
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
  if [[ "$NODE_MAJOR" == "$NODE_MAJOR_REQUIRED" ]]; then
    ok "node $(node -v)"
  else
    fail_or_warn ALLOW_NODE_MAJOR "node $(node -v) — this repo builds and tests on node ${NODE_MAJOR_REQUIRED}"
    hint "nvm use ${NODE_MAJOR_REQUIRED}   (a newer major breaks the jsdom/localStorage suites — TD-054)"
  fi
else
  bad "node is not installed"
fi

have npm && ok "npm $(npm -v)" || bad "npm is not installed"
have git && ok "git $(git --version | awk '{print $3}')" || bad "git is not installed"

# Installed dependencies vs the lockfile. npm stamps node_modules/.package-lock.json
# on every install, so a lockfile newer than the stamp means node_modules is
# stale — which surfaces later as a missing binary halfway through the gates.
check_deps() {
  local dir="$1" label="$2"
  if [[ ! -d "$dir/node_modules" ]]; then
    bad "$label dependencies are not installed"
    hint "(cd $dir && npm ci)"
  elif [[ ! -f "$dir/node_modules/.package-lock.json" ]]; then
    warn "$label node_modules has no install stamp — cannot tell if it is current"
  elif [[ "$dir/package-lock.json" -nt "$dir/node_modules/.package-lock.json" ]]; then
    bad "$label dependencies are stale (package-lock.json is newer than node_modules)"
    hint "(cd $dir && npm ci)"
  else
    ok "$label dependencies in sync with package-lock.json"
  fi
}
check_deps "." "root"
if [[ "$MODE" == "server" ]]; then check_deps "server" "server"; fi

# ---------------------------------------------------------------------------
# Git hygiene — the same for both deploy targets
# ---------------------------------------------------------------------------
head_ "Repository"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  bad "not a git work tree"
else
  # A half-finished merge/rebase would ship conflict markers.
  GIT_DIR_ABS="$(git rev-parse --git-dir)"
  IN_PROGRESS=""
  [[ -e "$GIT_DIR_ABS/MERGE_HEAD"       ]] && IN_PROGRESS="merge"
  [[ -d "$GIT_DIR_ABS/rebase-merge"     ]] && IN_PROGRESS="rebase"
  [[ -d "$GIT_DIR_ABS/rebase-apply"     ]] && IN_PROGRESS="rebase"
  [[ -e "$GIT_DIR_ABS/CHERRY_PICK_HEAD" ]] && IN_PROGRESS="cherry-pick"
  [[ -e "$GIT_DIR_ABS/BISECT_LOG"       ]] && IN_PROGRESS="bisect"
  if [[ -n "$IN_PROGRESS" ]]; then
    bad "a $IN_PROGRESS is in progress — finish or abort it first"
    hint "git $IN_PROGRESS --abort"
  else
    ok "no merge/rebase in progress"
  fi

  # Unresolved conflicts, even without MERGE_HEAD.
  CONFLICTS="$(git diff --name-only --diff-filter=U)"
  if [[ -n "$CONFLICTS" ]]; then
    bad "unresolved conflicts in $(printf '%s\n' "$CONFLICTS" | wc -l | tr -d ' ') file(s)"
    printf '%s\n' "$CONFLICTS" | sed 's/^/        /' | head -10
  else
    ok "no conflicted files"
  fi

  BRANCH="$(git rev-parse --abbrev-ref HEAD)"
  if [[ "$BRANCH" == "$RELEASE_BRANCH" ]]; then
    ok "on $RELEASE_BRANCH"
  else
    bad "on '$BRANCH' — releases are cut from '$RELEASE_BRANCH'"
    hint "git switch $RELEASE_BRANCH    (or RELEASE_BRANCH=$BRANCH to override)"
  fi

  DIRTY="$(git status --porcelain)"
  if [[ -z "$DIRTY" ]]; then
    ok "working tree clean"
  else
    DIRTY_COUNT="$(printf '%s\n' "$DIRTY" | wc -l | tr -d ' ')"
    printf '%s\n' "$DIRTY" | sed 's/^/        /' | head -10
    [[ "$(printf '%s\n' "$DIRTY" | wc -l)" -gt 10 ]] && hint "… and more; run: git status --short"
    hint "the image tag / release commit must name exactly what you deploy"
    fail_or_confirm ALLOW_DIRTY \
      "Continue the release with $DIRTY_COUNT uncommitted change(s) in the working tree?" \
      "working tree has $DIRTY_COUNT uncommitted change(s)" \
      "working tree has $DIRTY_COUNT uncommitted change(s)"
  fi

  # Unmerged work: branches whose commits are not in the release branch.
  UNMERGED="$(git branch --no-merged "$RELEASE_BRANCH" --format='%(refname:short)' 2>/dev/null | grep -v "^$RELEASE_BRANCH\$" || true)"
  if [[ -z "$UNMERGED" ]]; then
    ok "every local branch is merged into $RELEASE_BRANCH"
  else
    printf '  %s!%s %s\n' "$YELLOW" "$NC" "local branch(es) not merged into $RELEASE_BRANCH:"
    printf '%s\n' "$UNMERGED" | sed 's/^/        /'
    hint "land them, or delete them, or set ALLOW_UNMERGED=1 if they are deliberately parked"
    fail_or_confirm ALLOW_UNMERGED \
      "Continue the release with these branch(es) unmerged?" \
      "local branch(es) not merged into $RELEASE_BRANCH" \
      "local branch(es) not merged into $RELEASE_BRANCH"
  fi

  # Extra worktrees usually mean an epic is mid-flight (one worktree per epic).
  WT_COUNT="$(git worktree list --porcelain | grep -c '^worktree ' || true)"
  if [[ "$WT_COUNT" -le 1 ]]; then
    ok "no extra worktrees"
  else
    printf '  %s!%s %s\n' "$YELLOW" "$NC" "$((WT_COUNT - 1)) extra worktree(s) still checked out:"
    git worktree list | tail -n +2 | sed 's/^/        /'
    hint "git worktree remove <path>   (work parked there is not in this release)"
    fail_or_confirm ALLOW_WORKTREES \
      "Continue the release with these worktree(s) still checked out?" \
      "$((WT_COUNT - 1)) extra worktree(s) still checked out" \
      "$((WT_COUNT - 1)) extra worktree(s) still checked out"
  fi

  # origin: the release commit has to be reachable by everyone else.
  if [[ "${SKIP_REMOTE:-0}" == "1" ]]; then
    warn "origin not checked (SKIP_REMOTE=1)"
  elif ! git remote get-url origin >/dev/null 2>&1; then
    bad "no git remote 'origin'"
  elif ! git fetch --quiet origin "$RELEASE_BRANCH" 2>/dev/null; then
    bad "cannot reach origin — check your network and credentials"
  else
    BEHIND="$(git rev-list --count "HEAD..origin/$RELEASE_BRANCH" 2>/dev/null || echo 0)"
    AHEAD="$(git rev-list --count "origin/$RELEASE_BRANCH..HEAD" 2>/dev/null || echo 0)"
    if [[ "$BEHIND" -gt 0 ]]; then
      bad "$BEHIND commit(s) behind origin/$RELEASE_BRANCH"
      hint "git pull --ff-only origin $RELEASE_BRANCH"
    elif [[ "$AHEAD" -gt 0 ]]; then
      ok "$AHEAD local commit(s) ahead of origin/$RELEASE_BRANCH (they will be pushed)"
    else
      ok "in sync with origin/$RELEASE_BRANCH"
    fi
  fi
fi

# ---------------------------------------------------------------------------
# Target-specific: configuration and secrets
# ---------------------------------------------------------------------------
if [[ "$MODE" == "web" ]]; then
  head_ "Web deploy (Netlify, builds from $RELEASE_BRANCH)"

  if [[ -f netlify.toml ]]; then
    if grep -q 'publish *= *"dist-web"' netlify.toml && grep -q 'command *= *"npm run build:web"' netlify.toml; then
      ok "netlify.toml publishes dist-web via npm run build:web"
    else
      bad "netlify.toml does not build dist-web with npm run build:web"
    fi
  else
    bad "netlify.toml is missing — Netlify would not know what to build"
  fi

  # The browser bundle takes no secrets; that is a deliberate decision, so
  # assert it rather than leaving it unsaid.
  if [[ -f .env ]] && grep -qE '^[[:space:]]*VITE_' .env 2>/dev/null; then
    warn ".env defines VITE_* vars — those are baked into the public bundle"
    hint "the web build is documented as needing no env vars (.env.example)"
  else
    ok "no frontend secrets required (download config is fetched at runtime)"
  fi

  if [[ "${SKIP_REMOTE:-0}" != "1" ]]; then
    if git ls-remote --exit-code origin HEAD >/dev/null 2>&1; then
      ok "push credentials for origin work"
    else
      bad "cannot authenticate against origin — the web deploy is a push to $RELEASE_BRANCH"
    fi
  fi
fi

if [[ "$MODE" == "server" ]]; then
  head_ "Server deploy (Cloud Run, $ENVIRONMENT)"

  have gcloud          && ok "gcloud $(gcloud version 2>/dev/null | awk '/Google Cloud SDK/{print $4}')" \
                       || { bad "gcloud is not installed"; hint "https://cloud.google.com/sdk/docs/install"; }
  have terraform       && ok "terraform $(terraform version -json 2>/dev/null | sed -n 's/.*"terraform_version": *"\([^"]*\)".*/\1/p')" \
                       || { bad "terraform is not installed"; hint "brew install terraform"; }
  have cloud-sql-proxy && ok "cloud-sql-proxy" \
                       || { bad "cloud-sql-proxy is not installed"; hint "brew install cloud-sql-proxy"; }

  if have docker; then
    if docker info >/dev/null 2>&1; then
      ok "docker daemon running"
    else
      bad "docker is installed but the daemon is not running"
      hint "open -a Docker"
    fi
  else
    bad "docker is not installed"
  fi

  head_ "Credentials"
  if have gcloud; then
    ACCOUNT="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | head -1)"
    if [[ -n "$ACCOUNT" ]]; then
      ok "gcloud authenticated as $ACCOUNT"
    else
      bad "no active gcloud account"
      hint "gcloud auth login"
    fi
    # terraform and the proxy both read Application Default Credentials.
    if gcloud auth application-default print-access-token >/dev/null 2>&1; then
      ok "application default credentials present"
    else
      bad "no application default credentials (terraform and cloud-sql-proxy need them)"
      hint "gcloud auth application-default login"
    fi
  fi

  head_ "Configuration"

  TF_DIR="server/infrastructure/terraform"
  TFVARS="${TF_DIR}/${ENVIRONMENT}.tfvars"
  if [[ -f "$TFVARS" ]]; then
    ok "$TFVARS present"
  else
    bad "$TFVARS is missing"
    hint "cp ${TFVARS}.example $TFVARS"
  fi

  for var in GCP_PROJECT_ID TF_STATE_BUCKET; do
    if [[ -n "$(eval "echo \${$var:-}")" ]]; then
      ok "$var=$(eval "echo \$$var")"
    else
      bad "$var is not set and could not be derived"
      hint "cp deploy.env.example deploy.env and fill it in (the Makefile includes it)"
    fi
  done

  # The project you are deploying to and the project terraform manages must be
  # the same one. A mismatch here would build and push into one project while
  # applying infrastructure in another.
  if [[ -f "$TFVARS" && -n "${GCP_PROJECT_ID:-}" ]]; then
    TFVARS_PROJECT="$(sed -n 's/^project_id[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' "$TFVARS" | head -1)"
    if [[ -z "$TFVARS_PROJECT" ]]; then
      warn "$TFVARS does not set project_id"
    elif [[ "$TFVARS_PROJECT" == "$GCP_PROJECT_ID" ]]; then
      ok "GCP_PROJECT_ID matches project_id in $TFVARS"
    else
      bad "GCP_PROJECT_ID ($GCP_PROJECT_ID) != project_id in $TFVARS ($TFVARS_PROJECT)"
      hint "the image would be pushed to one project and the infrastructure applied in another"
    fi
  fi

  # Terraform records the backend it was last initialised against. Pointing at
  # a different bucket means a different state file — a fresh apply that does
  # not know the service, the database or the secrets already exist.
  TFSTATE="${TF_DIR}/.terraform/terraform.tfstate"
  if [[ -f "$TFSTATE" && -n "${TF_STATE_BUCKET:-}" ]]; then
    LAST_BUCKET="$(sed -n 's/.*"bucket"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$TFSTATE" | head -1)"
    if [[ -z "$LAST_BUCKET" || "$LAST_BUCKET" == "$TF_STATE_BUCKET" ]]; then
      ok "state bucket matches the last terraform init"
    else
      warn "TF_STATE_BUCKET ($TF_STATE_BUCKET) differs from the last init ($LAST_BUCKET)"
      hint "intentional only if you are deliberately moving state; otherwise this re-creates everything"
    fi
  fi

  if [[ -n "${TF_STATE_BUCKET:-}" ]] && have gcloud && [[ "${SKIP_REMOTE:-0}" != "1" ]]; then
    if gcloud storage ls "gs://${TF_STATE_BUCKET}" >/dev/null 2>&1; then
      ok "terraform state bucket gs://${TF_STATE_BUCKET} is readable"
    else
      bad "cannot read gs://${TF_STATE_BUCKET} — wrong bucket, wrong project, or no access"
    fi
  fi

  # Runtime secrets live in Secret Manager, generated by terraform. A local
  # server/.env is a development convenience and must never be the source.
  if [[ -f server/.env ]]; then
    ok "server/.env exists (development only — production reads Secret Manager)"
  else
    ok "no server/.env (production secrets come from Secret Manager)"
  fi

  # MUT-324 (D11): web first. The server asks people to accept CURRENT_TERMS, so the public
  # site must already list that exact text. Checked here, before the version bump and push,
  # so a refusal leaves nothing behind (review fix 3). The script prints what is wrong.
  # SKIP_REMOTE doesn't skip it: it reads the public site, not origin or GCP (review pass 2).
  head_ "Terms of service"
  if [[ "${SKIP_TERMS_CHECK:-0}" == "1" ]]; then
    warn "terms not checked ${DIM}(SKIP_TERMS_CHECK=1)${NC}"
  elif TERMS_OUT="$(npm --prefix server run --silent terms:check-live 2>&1)"; then
    ok "${TERMS_OUT#\[terms\] }"
  else
    bad "${TERMS_OUT#\[terms\] }"
    hint "if the version isn't listed yet: make release web, wait for Netlify, then release the server"
  fi
fi

# ---------------------------------------------------------------------------
head_ "Result"
if [[ "$FAILS" -gt 0 ]]; then
  printf '  %s%d check(s) failed%s, %d warning(s). Nothing was deployed.\n\n' "$RED" "$FAILS" "$NC" "$WARNS"
  exit 1
fi
printf '  %sready to release%s (%d warning(s))\n\n' "$GREEN" "$NC" "$WARNS"
exit 0
