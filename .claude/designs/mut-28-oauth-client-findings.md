# MUT-28 — Mutaba3a as an OAuth 2.1 client of *.malafat.app

**Status:** client implemented and unit-tested; staging verification outstanding
**Date:** 2026-10-05
**Epic:** MUT-25 · **Feeds:** MUT-32 (architecture decision), MAL-870 (scopes + gating)

---

## Verdict

**The protocol is reusable as-is. The authorization *policy* is not.**

Malafat's OAuth server already does everything a desktop client needs —
including, to its credit, anticipating one. `isAcceptableRedirectUri`
(`domain/cimd-url.ts:197-212`) permits `http://localhost` and `http://127.0.0.1`
with the comment *"native and desktop clients legitimately use a loopback http
redirect"*, and `client-trust.ts:71-76` renders the port so a consent screen
reads honestly as `127.0.0.1:14100`. Public clients with PKCE and
`tokenEndpointAuthMethod: "none"` are the documented normal case.

So Mutaba3a needs no new auth protocol, and no CRM change to the redirect path.

What it *does* need is three policy decisions that belong to Malafat, listed
under "Gaps" below. The ticket's framing — "avoid building auth entirely" —
should read **"avoid building the auth protocol entirely."**

---

## What is proven, and how

Everything below is covered by tests that run in CI without a network or a live
tenant. 79 new assertions across 5 files; `cargo test --lib` 24 passed,
`vitest` 2024 passed.

| Claim | Evidence |
|---|---|
| We compute the PKCE challenge the way the server verifies it | RFC 7636 Appendix B test vector, `oauth-pkce.test.ts` |
| `plain` downgrade is unrepresentable | not implemented; asserted absent |
| The CIMD document satisfies the server's own validation rules | `cimd-document.test.ts` re-states `cimd-url.ts` and checks the shipped artifact |
| The document ships to where Netlify serves it | `npm run build:web` → `dist-web/.well-known/oauth-client.json` (verified, not assumed) |
| Registered ports and bound ports cannot drift | test cross-checks `OAUTH_LOOPBACK_PORTS` against the published document |
| The listener is unreachable off-machine | binds `127.0.0.1` only; `oauth_callback.rs` tests |
| A replayed redirect cannot inject a second code | single-shot latch; `serves_only_one_callback` |
| An abandoned sign-in releases its port | `releases_the_port_after_a_timeout` |
| `state` is compared before any error is believed | `parseCallbackParams`; two tests including a forged-error case |
| A rotated refresh token is adopted and persisted immediately | `oauth-client.test.ts`, `oauth-flow.test.ts` |
| Revocation clears a token and nothing else | `oauth-flow.test.ts`; module cannot import `db` |
| Listener is bound before the authorize URL is built | ordering assertion in `oauth-flow.test.ts` |

## What still needs a staging tenant

Not blockers for the architecture decision, but AC1–AC3 are not *closed* until
these run. None are code changes; all need a provisioned tenant and a deploy,
which this spike could not do.

1. **Publish the CIMD document** to `https://mutaba3a.app/.well-known/oauth-client.json`
   and confirm Malafat's SSRF-guarded fetcher accepts it. The content-type trap
   is designed out (see Decisions) but only a live fetch proves it.
2. **Walk the flow** against a staging tenant: authorize → consent → code →
   token. Confirm the consent screen shows "Mutaba3a" and the loopback host.
3. **Confirm the grant appears in Settings**, revoke it, and confirm the desktop
   degrades to local-only with every transaction intact.
4. **Flip the MCP toggle** for the staging tenant — see Gap 1; without it every
   token resolution returns `firm_disabled` and nothing works.

---

## Gaps in the server for a non-MCP client (AC5)

### Gap 1 — the firm-level MCP gate blocks a money client, and reusing it is wrong

`resolve-oauth-context.ts:109-112` checks `isMcpEnabledForFirm(tenant.id)`
**before any token lookup**, fails closed, defaults NO. The switch means *"has
this firm's admin permitted lawyers to connect an external AI client over
MCP?"*

A money client is not an AI client. Asking a firm to enable AI access in order
to turn on their accounting integration is semantically wrong and will read as
a dark pattern. **This is the single largest blocker to the integration, and it
is a Malafat decision** — recorded on MAL-870 with three options and a
recommendation (a separate gate, because a firm switching money access off is
making a confidentiality decision that must not be coupled to whether their
invoice cleared).

### Gap 2 — no money scopes exist, and adding them is a product decision

`domain/scopes.ts` is a closed five-scope vocabulary with exactly one write
scope, and its header says so explicitly: *"Only ONE write scope exists… Adding
a write scope here is a product decision, not a refactor."* Mutaba3a writes.

Draft scope list for MAL-870 (AC4):

| Scope | Why |
|---|---|
| `money:read` | render ledgers, totals, receivables in the CRM and in Mutaba3a |
| `money:write` | the actual point — record income, expenses, payments |
| `clients:read` | already exists; needed to resolve `externalRef` to a client |
| `matters:read` | already exists; needed to resolve `externalRef` to a matter |

Three properties of the existing vocabulary shape this:

- Scopes are **published in the discovery document**, so the list is a versioned
  contract, not config.
- `parseScopeString` fails the **whole** request on an unknown scope rather than
  narrowing. A shipped desktop build asking for a scope an older deployment does
  not know gets a hard failure — **version skew needs a story**.
- `hasScope` is deliberately non-hierarchical: `money:write` will not imply
  `money:read`. Request both; the consent screen shows both.

### Gap 3 — one grant per (client, user) collides with a multi-device desktop app

`OAuthGrant.activeGrantKey` enforces at most one active grant per
(client, user). Refresh tokens rotate, and replay of a superseded one revokes
**the entire grant** (`REFRESH_REUSE`).

A lawyer who runs Mutaba3a on a desktop and a laptop, or restores a machine from
backup, will replay a stale refresh token and lose access **on every device at
once**. This is not hypothetical — it is the normal consequence of the current
model plus a desktop app.

Options, for MUT-32 / MAL-870 to choose between:

- **Per-device client_id** — each install registers separately. Clean isolation,
  but the consent screen then lists "Mutaba3a (MacBook)" entries that accumulate,
  and CIMD client_id is a URL, so this needs a per-install registration story.
- **Per-device grant** — relax `activeGrantKey` to (client, user, device). A
  Malafat schema change, and the one that matches how a desktop app actually
  behaves.
- **Single-device-at-a-time** — document that signing in on a second machine
  signs out the first. Cheapest, and genuinely acceptable for a solo lawyer;
  bad for a firm.

### Gap 4 — custom-domain tenants

The CRM supports custom domains (`domain-provisioning.ts`,
`scripts/add-custom-domain.ts`). Our opener capability is scoped to
`https://*.malafat.app/*`, so a firm on its own domain cannot sign in. Widening
to a bare wildcard is weaker than it looks; the better fix is to validate the
URL in Rust against the issuer returned by discovery, which keeps the allowlist
tight without enumerating domains. Not done here — it is a real design choice,
not a default to pick silently.

---

## Decisions taken

**Loopback ports are fixed and pre-registered.** RFC 8252 wants an ephemeral
port, but Malafat matches `redirect_uris` exactly
(`authorization-request-service.ts:106`), so an ephemeral port fails closed
without redirecting. Four ports (14100–14103) in both loopback spellings are
registered. Four rather than one because a single port lets any process
squatting it block sign-in with no recovery; a test keeps the code and the
published document in step.

**The CIMD document is served from a `.json` path.** Malafat refuses a document
whose content-type is not JSON (`cimd-fetcher.ts:180`), and `netlify.toml`'s SPA
fallback would have served `index.html` as `text/html` for an extensionless
path. Naming it `.json` removes the failure mode rather than papering over it
with a header rule.

**State is compared in TypeScript only.** The Rust listener returns the raw
query unparsed. One implementation of that comparison, not two that can
disagree.

**No durable token storage yet.** `InMemoryTokenStore` loses tokens on restart,
forcing re-auth — the safe failure. A refresh token is a long-lived credential
and belongs in the OS keychain, which needs a Tauri plugin this spike
deliberately did not add. Writing it to IndexedDB or a plain file to "make it
work" would have been the wrong answer quietly adopted. **Production gap,
tracked in TECH_DEBT.**

**Deferred to MUT-30:** the ADR-005 / ADR-013 override. This spike ran against
synthetic data only and shipped no cloud sync, so it stays inside ADR-013's
spirit, but no cloud work should land before that override is written.

---

## Incidental finding

`src-tauri` had **no `[dev-dependencies]` section**, while
`src/sync/persistence.rs:279` has referenced `tempfile::tempdir` since it was
written. The Rust test target therefore never compiled and **14 tests had never
run once**. Declaring `tempfile` was necessary to run any Rust test; all 14 pass.
Worth a bug ticket for CI, which evidently does not run `cargo test`.

---

## Recommendation for MUT-32

This spike removes auth from the cost of Option A. What remains on the Malafat
side is policy (Gaps 1–3), not plumbing — real work, but bounded and mostly
schema-and-decision rather than new subsystems.

Gap 3 is the one that should influence the architecture choice rather than being
left to implementation: if per-device grants need a Malafat schema change, that
is better known before MUT-32 commits.
