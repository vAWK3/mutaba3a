# MUT-472 — the API refuses the placeholder secrets from server/.env.example

Ticket: MUT-472 (Bug, relates MUT-463). Decision: ADR-211.

## Problem and acceptance criteria

`server/.env.example` ships `MUTABA3A_ADMIN_TOKEN=replace-with-32-plus-ryandom-characters-from-secret-manager`
(and the same kind of value for `SESSION_TOKEN_PEPPER` and, commented out, `OAUTH_DERIVE_KEY`). Each is longer
than 32 characters, so `z.string().min(32)` accepts it. Copy the example, run `npm --prefix server run dev`, and
`/admin/v1/*` answers to a token anyone can read in the repo. `.env` files from before MUT-463 listen on every
interface, so the network can reach it.

Done when:
- boot fails with a message naming `MUTABA3A_ADMIN_TOKEN` when it is the placeholder;
- the same holds for every secret: `SESSION_TOKEN_PEPPER`, `FRONT_DOOR_TOKEN`, `MUTABA3A_JOB_TOKEN`, `OAUTH_DERIVE_KEY`;
- a real secret of 32+ characters still boots, and the existing config tests stay green;
- the QA harnesses (`qa/support/*-live.mjs`) and the server-ci smoke test are confirmed not to use a placeholder.

## Solution

`server/src/config.ts`: one helper builds the schema of every 32-character secret, replacing the five copies of
`z.string().min(32, '<NAME> must be at least 32 characters')`:

```ts
const PLACEHOLDER_SECRET = /^replace-with-/i;
function secret(name: string) {
  return z.string()
    .min(32, `${name} must be at least 32 characters`)
    .refine((v) => !PLACEHOLDER_SECRET.test(v), `${name} is the placeholder from server/.env.example; put a real secret here (openssl rand -hex 32)`);
}
```

The refusal goes through the existing zod issue list, so `loadConfig` reports it as
`  MUTABA3A_ADMIN_TOKEN: MUTABA3A_ADMIN_TOKEN is the placeholder …` next to any other problem, and the error type
(`ConfigError`) stays the same. The match is on the `replace-with-` prefix, so the misspelled `ryandom` value and any
placeholder added later are covered without listing exact strings.

Docs: `server/README.md` "Run locally" gets the step that puts real secrets in the copied `.env`; the
`.env.example` comments say the server refuses the placeholder. The example values themselves stay as they are.

## Out of scope (decided with Basel, 2026-10-27)

- Refusing the committed QA admin tokens when `HOST` isn't loopback: no. Server config would have to list test
  fixtures, MUT-463 already pins the harnesses to 127.0.0.1, and the CI smoke container must bind every interface.
- The `HOST` default (MUT-463), rotating real secrets, changing the example values.

## Reuse, impact, cost

- Reuses the zod schema and `ConfigError` path; no new module. Production secrets are Terraform-generated random
  values, never `replace-with-…`. QA tokens (`qa-portal-*-admin-token-…`), the CI smoke token (`ci-only-token-…`)
  and the server test fixtures (`'x'.repeat(32)`) don't match.
- A developer whose `.env` still holds the placeholder now gets a boot error telling them what to change: that's the point.
- No API contract, i18n, portal, phone or infra change. No runtime cost (boot-time check).
- Conflict risk with the unmerged MUT-463 branch: both touch `config.ts` and `config.test.ts` in different places.

## Tests (TDD, `server/src/__tests__/config.test.ts`)

New `describe('loadConfig — placeholder secrets (MUT-472)')`:
1. `it.each` over the five secret names: the `.env.example` placeholder is refused with a `ConfigError` naming the variable.
2. The exact admin-token string from `.env.example` (read from the file, so the test follows the example) is refused.
3. The prefix match is case-insensitive (`Replace-With-…`).
4. A real 32+ character value that only contains `replace-with` later on still boots.

Command: `npm --prefix server test -- src/__tests__/config.test.ts`, then the server CI gates
(`typecheck`, `lint`, `openapi:check`, full `test`) through the heavy queue.

## QA scenarios

None user-visible: this is a boot-time refusal for developers and operators, covered by the unit tests above.
`release-qa lint` must still report no new unmapped files.
