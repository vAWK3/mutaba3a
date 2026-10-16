# MUT-236 — Test plan

Brief: `mut-236-setup-page.md`. TDD: each file below is written red first.

Run: `npm run test:run -- src/hosted` (Node 22), then the full gates. Server line: `npm --prefix server test -- well-known`.

## Unit — `src/hosted/pages/auth/__tests__/setupLink.test.ts`

- `passwordProblem`: '' / 11 chars → tooShort; 12 → null; 128 → null; 129 → tooLong; an emoji counts as 2 (matches zod).
- Drift: `server/openapi/openapi.yaml` `NewPassword` has `minLength: NEW_PASSWORD_POLICY.minLength` and `maxLength: …maxLength`.
- `tokenFromHash` (C1: the router's hash has no `#`): '' → null; whitespace-only → null; ' abc ' → 'abc'.
- `redeemFailure`: 410 with each `details.state` → refused(state); 410 `used` with answerLost → trySignIn (D3); 410 with no/unknown state → refused('invalid'); 422 → policy; 429 → rateLimited(minutes); status 0, 5xx and a non-JSON answer → unreachable, and they mark the answer as lost (a 504 from a proxy can follow a commit, TD-149).

## Component — `src/hosted/pages/auth/__tests__/SetupPage.test.tsx` (stubApi + renderPortal)

1. Valid SETUP link (account locale `en`, nothing chosen): loader says "Checking your link"; the form shows the email, heading "Set your password"; the location has no hash after mount; check body was `{ token }`.
2. Account locale `ar`, nothing chosen → heading in Arabic, `document.documentElement.dir === 'rtl'`; with a stored choice `en` → stays English.
3. RESET purpose → "Choose a new password" and the sign-out-everywhere line.
4. Fields (D2): a visible read-only input `autocomplete="username"` with the email value, no hidden field; password input `autocomplete="new-password"`, `dir="ltr"`, `aria-describedby` includes the rule text.
5. 11 chars → inline "Use at least 12 characters.", focus on the field, no POST /v1/account-setup; 129 chars → tooLong.
6. Happy path: redeem body `{ token, password }` → sign-in body `{ email, password }` → lands on `/p/<id>`.
7. Submit disabled and `aria-busy` while the redeem is pending (`never`); a second click sends nothing.
8. Each of expired / used / superseded / invalid → its heading, no password field; used → a "Go to sign in" link to `/sign-in`.
9. No fragment → the "incomplete" message, and no request at all.
10. Check 422 → invalid message.
11. Check network failure → unreachable + Try again; Try again re-checks and shows the form.
12. Check 429 → minutes message.
13. Redeem network failure → banner, form kept; retry gets 410 used → the page signs in with the typed password (D3) and lands on `/p/<id>`.
13b. Same, but that sign-in answers 401 → "Your password is probably saved" + sign-in link.
13c. A 410 used on the first attempt (no lost answer) → the plain "used" card, and no sign-in request.
14. Redeem 410 expired (form open, link expired meanwhile) → expired message, no form.
15. Redeem ok, sign-in fails → "Your password is saved" + sign-in link.
15b. (A1) After the form shows, a window focus event 31 s later sends no second check.
16. Every rendered state's text has no banned self-service wording (the `auth-states` `BANNED` regex).

## Session — `src/hosted/session/__tests__/auth-states.test.tsx` (or SetupPage.test)

17. A sign-out broadcast from another tab while on `/setup` keeps the page on `/setup`.

## Existing suites that must stay green

- `BootScreens.test.tsx` (CheckingSession default label unchanged), `auth-states.test.tsx` (sign-in rate-limit minutes after the `retryMinutes` move), `parity.test.ts`.
- `scripts/__tests__/check-bundles.test.ts` and the real `check-bundles` in `npm run build`.

## Server — `server/src/__tests__/well-known-routes.test.ts`

18. The AASA `applinks` paths match no `/setup` path.

## Release-QA — `qa/specs/portal/setup.spec.ts`

One test per scenario in brief §8, tagged `@portal.setup.<id>`, each user-visible action in `step(...)`, run once green on a preview build.
