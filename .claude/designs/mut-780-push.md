# MUT-780: Phone push reminders for the accountant desk (epic MUT-762)

Tracker: Jira, barmajiyat.atlassian.net, MUT via atlassian-barmajiyat. Status In Progress (set by the coordinator). Follows MUT-773 (phone desk, merged) and MUT-767 (unclaimed sweep, merged). No open blockers. MUT-782 (VAT period reminders, another session) may reuse the send path; MUT-784 not touched.

Decisions: ADR-350 (transport), ADR-351 (device tokens), ADR-352 (reminder push and tap). Plan covers both repos: this one (server) and `mutaba3a-flutter` (phone, branch `feature/mut-780-push`).

## Problem and acceptance criteria

The accountant's reminders reach him only by mail. A phone push on the days the unclaimed-account digest would send brings him back to the desk.

1. An accountant with push allowed gets the reminder on the phone; tapping it opens that customer on the desk.
2. A refused permission changes nothing else.
3. Signing out removes the device token.
4. Tests on the server; release QA on iOS.

Keys stay in Secret Manager (server) and gitignored config (phone). None in either repo.

## Proposed solution

```
phone (firebase_messaging, options from dart-defines)
  ask permission after the first customer is added ──► FCM token (iOS: FCM over APNs; Android: FCM)
  POST /v1/push-devices {platform, token, environment}   (device session; one row per session)
  DELETE /v1/push-devices (this session)  /  DELETE /v1/device-sessions/current also removes it

server
  PushDeviceRepository (store.pushDevices)   table push_devices
  push/service.ts   PushService.notifyUser(userId, message)  ◄── reusable send path (MUT-782 later)
       │ active devices (session not revoked, not expired) ─► localise (ar/en) ─► PushSender.send
       │ invalid token answers ─► device row removed
  push/fcm-sender.ts   FCM HTTP v1 (service-account JWT via node:crypto, fetch injected)
  push/fake-sender.ts  records messages (tests)
  accountants/unclaimed-sweep.ts   on a day the digest sends: one push to that accountant
```

Sweep hook: the accountant gets one push on exactly the days the digest mail is due (`remindedNow` or `removingSoon > 0`). Counts only in the body, never a name or address (ADR-300 d3). The payload's `customerUserId` names the customer to open: one reminded today, else one going soonest. The phone looks that customer up in its desk list.

## API contract

- `POST /v1/push-devices` (device session or cookie, not an API key): `{ platform: 'ios'|'android', token: string(1..4096), environment?: 'production'|'sandbox' }`. 204. Replaces this session's row and any other row holding the same token (a handed-over phone moves to the new account). 404 `NOT_FOUND` while push is not configured on the server (the phone treats it as "off"). 422 on a bad body. Idempotent.
- `DELETE /v1/push-devices`: removes this session's token. 204 always (also when none).
- `DELETE /v1/device-sessions/current` removes the session's token in the same step; sessions revoked any other way (password change, operator, passkey removed) leave rows that never receive a push (the send query joins live sessions) and the next send prunes them.
- No GET: the token is never read back to a client.
- Error states: FCM 404/UNREGISTERED/INVALID_ARGUMENT on the token removes the row; 5xx or timeouts keep it and count `failed`; a send failure never fails the sweep.

## Data

`push_devices(id uuid pk, userId fk users cascade, sessionId fk sessions cascade unique, platform, token varchar(4096) unique, environment, createdAt, updatedAt)`, index on `userId`. Purge catalog: `push_devices.userId` = delete. Migration `20261128150000_mut780_push_devices`.

## Reuse analysis

`PushService.notifyUser` is the one send path (kind + vars + data; ar/en copy by the person's locale, in `push/messages.ts`). The sweep follows the digest's idempotency (once per UTC day, per accountant). The phone: `PushService` interface in `lib/domain/services`, a fake for tests, `AuthService` sign-out calls the remove. Desk list lookups reuse `accountantCustomersProvider`; navigation reuses `AppRoutes.clientBook`.

## Impact

Store guard class `sessionOnly` for register/remove; `remove by session` and `listActiveForUser` are operator (below the routes). Sign-out path gains one delete. Purge test catalog gains one table. OpenAPI additive. No change to mail, sweep counts or summary shape (one added field `pushed`).

## i18n

Server push copy ar and en (Levantine, minimal). Phone: the permission pre-ask strings ar and en in the arb files. The system permission dialog is the OS's.

## Cost

Pushes: FCM is free. One send per accountant per sweep day at most. One token row per signed-in phone. No analytics events added (contract stays 2.15.0).

## Infra and operator steps

Env: `FCM_PROJECT_ID=mtb3a-barmajiyat` turns push on; the API's Cloud Run service account sends as itself (granted `roles/firebasecloudmessaging.admin` on the Firebase project, cross-project IAM); `FCM_SERVICE_ACCOUNT_JSON` is a fallback for local runs (needs the project id). Unset = push dark (route 404, sweep sends no push). Terraform for the grant and env is TD-380. Phone: dart-defines `FIREBASE_API_KEY`, `FIREBASE_APP_ID_IOS`, `FIREBASE_APP_ID_ANDROID`, `FIREBASE_MESSAGING_SENDER_ID`, `FIREBASE_PROJECT_ID` from the gitignored `.env`/`.env.local`; missing = push off (no crash). iOS: Push Notifications capability and the APNs auth key uploaded to Firebase. Exact steps in `docs/operations/before-release.md`.

## Risks and edge cases

- Several devices per person: one row per session, all get the push.
- Token rotation: the phone re-registers on `onTokenRefresh` and at each launch; the unique session key replaces the old token.
- Handed-over phone: same token under a new session moves to the new person.
- Refused or provisional permission: nothing is registered, nothing else changes; the app asks once after the first customer, never again on its own.
- Account closure purge removes rows (catalog test).
- Quiet hours: none per person; the push goes only from the daily job, whose schedule is the control (ADR-351).
- APNs sandbox vs production: FCM resolves it from the app's build, so the `environment` field is stored for diagnostics only.

## Test plan (TDD)

Server: store contract (memory + prisma): upsert replaces by session and by token, active list excludes revoked/expired sessions, remove by session, purge. Routes: register 204/404 dark/422/401, API key refused, remove, sign-out removes. Service: localises ar/en, prunes invalid tokens, keeps on failure, no devices = no call. FCM sender: request shape, token cache, error mapping (fake fetch). Sweep: push on digest days only, not otherwise, once a day, failure doesn't fail the run, payload has no name. Config: pair rule. Commands: `npm --prefix server test -- push`, then the full checks listed in the ticket.
Phone: unit tests for the push coordinator (asks after first customer, once; denied registers nothing; sign-out removes; token refresh re-registers; tap payload to route), widget test for the pre-ask. `flutter analyze`, `flutter test --concurrency=2`.

## QA scenarios (release QA, iOS, web has no push)

1. **Allow push after the first customer** (`ios.client-books.push-allow`): sign in as an approved accountant with no customers, add the first customer, see the notification ask, tap Allow. Outcome: the ask closes, the desk shows the new customer, the device token is registered (fake push gateway receives register).
2. **Refuse push** (`ios.client-books.push-refuse`): same, tap Not now. Outcome: the desk is unchanged, nothing is registered, the ask does not return on the next launch.
3. **Tap a reminder opens the customer** (`ios.client-books.push-open-customer`): simulated notification payload `{kind: 'unclaimed_digest', customerUserId}` delivered while the app runs and from cold start. Outcome: that customer's page is open on the desk.
4. **Sign out removes the token** (`ios.client-books.push-signout`): after allowing, sign out. Outcome: the server's remove was called and no token is held.

Real delivery needs keys and a device and is manual (operator checklist).

## Business / product impact

- The accountant comes back to customers who have not claimed their accounts instead of waiting for a mail he may not read; fewer accounts expire unpaid at day 60.
- Part of the accountant channel (epic MUT-762); the send path is the first one VAT reminders (MUT-782) can use.
- Low risk: dark until keys are set, free to run, one added table.
