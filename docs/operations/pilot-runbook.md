# Pilot operator runbook (MUT-327)

How to run hosted Mutaba3a for the pilot's 10 paying users (epic MUT-322): onboarding, password
resets, moving data in, restores, incidents, support and offboarding. Every step has the exact
commands. The restore drill is in §8, and its results go in §10.

Where else to look:

- `server/DEPLOYMENT.md` covers deploys, Terraform and day-2 commands.
- `.claude/INFRA.md` records what runs where.
- `docs/commercial/pilot-offer.md` lists what the pilot promises.

This runbook doesn't repeat those; it links to them.

> **⚠ Basel decides** marks a value nobody has set yet. The text next to it is a proposal. Replace it, then delete the marker.

- [0. Before you start](#0-before-you-start)
- [1. Onboard a user](#1-onboard-a-user)
- [2. Reset a password](#2-reset-a-password)
- [3. Move a free-app user's data](#3-move-a-free-app-users-data)
- [4. Restore: one profile or the whole database](#4-restore-one-profile-or-the-whole-database)
- [5. Respond to an incident](#5-respond-to-an-incident)
- [6. Support](#6-support)
- [7. Offboard a user](#7-offboard-a-user)
- [8. The restore drill](#8-the-restore-drill)
- [9. Walk log](#9-walk-log)
- [10. Drill results](#10-drill-results)

---

## 0. Before you start

Every command runs from `server/` on your machine, under Node 22. Nothing runs inside GCP.

**Tools:**

- `gcloud`, `cloud-sql-proxy`, `terraform`, `psql`, `jq`. See DEPLOYMENT.md §1.2.
- **Postgres 16 client tools** for a whole-database dump and restore (§4.3). Install them with
  `brew install postgresql@16`; they live in `/opt/homebrew/opt/postgresql@16/bin/`.
  - Production runs Postgres 16. A newer `pg_dump` (Homebrew's libpq is 18) writes
    `SET transaction_timeout`, and Postgres 16 rejects it. The 2026-10-20 walk hit exactly this.
  - `psql` itself can be any version.

Set these once per shell:

```bash
cd server
export GCP_PROJECT_ID=malafat-production
export TF_STATE_BUCKET=<project>-terraform-state           # or put it in server/.env.prod (see .env.prod.example)
export URL=$(cd infrastructure/terraform && terraform init -reconfigure -input=false \
  -backend-config="bucket=$TF_STATE_BUCKET" -backend-config="prefix=mutaba3a-api/production" >/dev/null \
  && terraform output -raw service_url)
export MUTABA3A_ADMIN_TOKEN=$(gcloud secrets versions access latest --secret=mutaba3a-api-admin-token --project=$GCP_PROJECT_ID)
```

Rules that hold on every step:

- **Secrets stay out of chat, tickets and the repo.** That covers setup links, the admin token,
  database URLs and any export file.
- **Use your private offboarding log.** It's a file or note outside this repo, never committed. It
  holds each user's email, request date, grace-period end and purge line.
- **Every change goes through the admin API or a script,** so the audit trail records it. Hand
  `UPDATE`s in `npm run db:psql` are a last resort, and you note them in the log.

## 1. Onboard a user

Accounts are operator-issued during the pilot (ADR-037, ADR-088). Nobody but the person ever knows
their password.

### 1.1 Create the account

```bash
npm run provision:user -- --url "$URL" --email nour@example.com --name "Nour Haddad" \
  --currency ILS --timezone Asia/Jerusalem --locale ar
```

- The account gets one **personal** profile. With `--organization-id <uuid>` it also joins an
  operator firm profile, and currency and timezone then default to the firm's.
- `--locale` is `ar` (the default) or `en`. Use the language the person wrote to you in.
- Output: the user id, the personal profile id, and a **setup link, shown once**. It's valid for
  72 hours; `--valid-hours 1–720` changes that.

### 1.2 Send the setup link

1. Send the link by itself, over a channel only the person reads. A direct email from your own
   address is the pilot's channel.
   - The link is a one-time password-setting link. Don't paste it next to the email address in a
     group chat.
   - The token sits after `#`, so it never reaches server logs.
2. The person opens it, ticks the terms, and picks a password (12–128 characters). That signs out
   every session and records `user.password_set` and `user.terms_accepted`.
3. **Check they did it.** TD-147: the operator has no "has set a password" flag.

   ```bash
   curl -s "$URL/admin/v1/organizations/<personal profile id>/audit" -H "x-admin-token: $MUTABA3A_ADMIN_TOKEN" \
     | jq '.events[] | select(.action == "user.password_set") | .createdAt'
   ```

4. **Link expired or lost?** Issue a new one with §2's command. Issuing a link cancels any earlier
   unused one.

Until the link is used, signing in fails exactly like a wrong password. A link that has been used,
has expired, or was replaced by a newer one gives a distinct state on the setup page.

### 1.3 Profiles

- The person adds their own **Business** profiles in the portal: Manage profiles, then Add. Each
  person owns at most 6 profiles.
- The operator only acts on operator firm profiles:
  - give access with `npm run grant:user -- --url "$URL" --email <email> --organization-id <uuid>`;
  - take it away with `npm run revoke:user -- --url "$URL" --email <email> --organization-id <uuid>`.
- A personal profile is never shared, given an API key or bound to Malafat.

### 1.4 Firm features (once MUT-300 is merged and released)

MUT-300 isn't on `main` yet, so these commands don't exist in a release. They come from its branch
(`feature/mut-300-firm-flag`).

The owner taps "Request firm features" on an owned Business profile. Then:

```bash
npm run firm:requests -- --url "$URL"                                        # pending requests, oldest first
npm run firm:enable   -- --url "$URL" --organization-id <uuid>                # owned Business profile: on, in place
npm run firm:enable   -- --url "$URL" --organization-id <uuid> --owner a@x.com,b@x.com   # operator firm: name its owners
npm run firm:decline  -- --url "$URL" --organization-id <uuid>                # not for the pilot: the owner sees the offer again
npm run firm:disable  -- --url "$URL" --organization-id <uuid>
```

Each change is audited (`firm.enabled`, `firm.disabled`, `firm.request_declined`). Walk this
section once MUT-300 lands (§9).

### 1.5 After onboarding

- **Cover them while billing isn't wired yet (MUT-358).** The pre-billing backfill only covered people who
  existed when it ran. Anyone created after it has no billing coverage. Nothing enforces that yet, but
  MUT-361 will turn such an account read-only. So grant every new pilot user now:

  ```bash
  npm run billing:grant -- --url "$URL" --email <email> --tier FREELANCER --reason "pilot P01"
  ```

- Create their Stripe subscription by hand (pilot-offer §5), in this order, so MUT-360's webhook links it with
  no step from you:

  1. On the Stripe **Customer**, set metadata `mutaba3a_user_id` = their user id (from `npm run users:…` or the
     admin listing). For a firm, also set `mutaba3a_organization_id` = the firm's profile id on the
     **Subscription**. It only counts if they own that profile, or if it's an operator firm.
  2. Create the subscription with a catalogue price (lookup keys `freelancer_founder_monthly_ils` …).
  3. Check the subscription covers them without the grant. Only then revoke it:

  ```bash
  npm run billing:status  -- --url "$URL" --email <email>               # read this before any revoke
  npm run billing:grants  -- --url "$URL" --email <email> --active      # the grant's id
  npm run billing:revoke  -- --url "$URL" --grant-id <uuid>
  ```

  `billing:status` prints their Stripe customer(s) and mirrored subscriptions, then each profile they own twice:
  as `/v1/me` reports it, and with operator grants left out. Revoke only when the "without grants" line shows
  `ACTIVE STRIPE`. `/v1/me` can't prove the mirror worked: it shows `OPERATOR` while a grant exists, and it's the
  person's own session only.

  If you forgot the metadata, set it and run `npm run billing:reconcile -- --url "$URL"`, or link by hand:
  `npm run billing:link -- --url "$URL" --customer cus_… --email <email> --currency ILS`. A link you made by hand
  always wins over metadata (MUT-360 D5). `billing:unlinked` lists Stripe customers the server has seen but can't
  match to anyone, including a returning payer who ended up with a second Stripe customer.
- Add the person to the weekly pilot review (`docs/commercial/pilot-reviews.md`).

### 1.6 Add a partner to a Business profile (MUT-373, ADR-163)

When a pilot user asks to share a Business profile they created with a partner (the portal's "write to us"
link sends the profile's name), both need their own account first (§1). Then:

```bash
npm run grant:user -- --url "$URL" --email <partner email> --organization-id <profile id> --role owner
```

- It prints a note in English and Arabic: send it to both partners. Each keeps their own personal profile, private.
- At most 3 owners per profile, the creator included (409 `OWNER_LIMIT`). Only an owned **Business** profile can
  be shared (`PERSONAL_PROFILE`, `NOT_BUSINESS`, `NOT_CO_OWNABLE` otherwise), and only with an active account
  (`USER_DISABLED`: enable it first).
- Each partner re-dates only the entries they recorded themselves; everything else (record, settle, clients,
  expenses, rename) is shared.
- If `pre-roll` stops a deploy over a stray membership you meant as a partner, the same command confirms it.
- The creator removes a partner, or a partner leaves, from the portal's Owners section. `revoke:user` works too.
- The creator can't leave (TD-194). To hand a profile over, ask Basel: there is no transfer command yet.
- Billing still follows the creator (TD-193): the partner's own subscription doesn't cover the shared profile.

### 1.7 Turn on the Stripe sync (MUT-360, ADR-165; once, in this order)

Do each step only when the one before it checks out. Nothing changes for anyone until step 5.

1. **Catalogue.** Each Product has metadata `tier` = `freelancer` or `firm`, backfilled on Products that already
   exist. A subscription whose product has no tier is never mirrored (`UNKNOWN_TIER`). Prices carry the lookup keys
   `freelancer_founder_{monthly|yearly}_{ils|usd}` and `firm_founder_…`.
2. **Existing pilot customers.** Set `mutaba3a_user_id` on every pilot Customer and `mutaba3a_organization_id`
   on every firm's Subscription (§1.5).
3. **Keys.** Create a **restricted key** with read access to Customers, Subscriptions, Products, Prices, Checkout
   Sessions, Invoices and Events. Add it to Secret Manager (`server/DEPLOYMENT.md` §6e).
4. **Webhook endpoint.** In the Mutaba3a Stripe account, add the endpoint `https://<api host>/v1/billing/stripe/webhook`
   with exactly these 9 events (`HANDLED_EVENT_TYPES` in `server/src/billing/stripe/sync.ts`):
   `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`,
   `invoice.paid`, `invoice.payment_failed`, `customer.updated`. Set **its API version to `2026-09-30.endive`**
   (`STRIPE_API_VERSION` in `gateway.ts`), so its payloads match what the server reads. Then add the endpoint's
   signing secret (`whsec_…`) to Secret Manager (§6e). Until step 5 the endpoint answers 503 and Stripe queues
   retries; that is expected, so do step 5 right after this one.
5. **Turn it on.** Set `stripe_enabled = true` and apply (`server/DEPLOYMENT.md` §6e). Then run one reconcile and
   read the summary:

   ```bash
   npm run billing:reconcile -- --url "$URL"
   ```

   `errors` must be empty, or each one explained: `UNKNOWN_TIER` (product metadata), `UNKNOWN_ORG` /
   `FIRM_WITHOUT_ORG` (subscription metadata), `ORG_NOT_OWNED_BY_PAYER` (`mutaba3a_organization_id` names a
   profile the payer doesn't own: the subscription covers nothing until it's fixed), `CUSTOMER_LINKED_ELSEWHERE`
   (metadata names someone other than the person you linked), `TIME_BUDGET` (the run stopped early to stay inside
   its deadline: run it again). If Stripe can't be listed at all (a bad or under-scoped key), `billing:reconcile`
   exits non-zero with `RECONCILE_FAILED` and nothing was reconciled: fix the key (`server/DEPLOYMENT.md` §6e
   step 2) and run it again.
6. **Verify.** For every pilot user, before any revoke:

   ```bash
   npm run billing:status -- --url "$URL" --email <email>
   ```

   It prints their Stripe customer(s) and mirrored subscriptions, then each profile they own twice: as `/v1/me`
   reports it, and with operator grants left out. Each profile you expect them to pay for shows `ACTIVE STRIPE` on
   its "without grants" line. `billing:unlinked` lists nobody you know. (`/v1/me` shows `OPERATOR` while the grant
   exists, and is the person's own session only, so it can't prove the mirror worked.)
7. **Grants.** Only now revoke the `pre-billing` grants, one person at a time, and only where the "without grants"
   line shows `ACTIVE STRIPE`. Run `billing:status` again after each. A grant revoked before the subscription
   covers them drops that person to their trial or read-only.
8. **Afterwards.** The nightly job (03:30 Asia/Jerusalem) repairs anything a webhook missed. A failed run, and
   anything the webhook or the reconcile can't mirror, emails the alert channel (`server/DEPLOYMENT.md` §6e,
   "Alerts").

**Test-mode checks (Basel).** In test mode, check whether the UK account can charge in ILS and whether ILS can
settle as ILS. Add a USD bank account for USD settlement.

## 2. Reset a password

There's no "forgot password" form (ADR-037). The person emails support (§6), and you reply with a
new setup link.

**Normal reset.** Their current password keeps working until they use the link:

```bash
npm run rotate:password -- --url "$URL" --email nour@example.com
```

**Suspected takeover.** The password stops working now and every web and phone session is signed
out:

```bash
npm run rotate:password -- --url "$URL" --email nour@example.com --lock
```

- Send the printed link as in §1.2.
- Using the link signs out every session either way.
- A disabled account can't use a link. Run `npm run enable:user …` first, then issue the link.
  Disabling also cancels any open links.
- **Only sign them out:** `npm run revoke:sessions -- --url "$URL" --email <email>`.

## 3. Move a free-app user's data

/hosted and pilot-offer §4 promise: *"We'll move them into your hosted account with you, by hand.
Nothing to type again."*

**There's no tool for this yet.** MUT-290 (in Backlog) is the in-app, one-time move on sign-in.
Nothing on the server imports a records file into a hosted profile. Until MUT-290 ships:

1. **⚠ Basel decides:**
   - either prioritise MUT-290 before the first free-app user moves in;
   - or soften the promise to "we'll move them with you", dropping "nothing to type again" (TD-191).
2. Meanwhile, the honest procedure:
   1. The person keeps their free-app data where it is. Nothing is lost by waiting.
   2. They make a copy for safety:
      - in the free web app: Settings › Your data › **Back up now**, plus Export receipts ›
        **Download ZIP**;
      - in the portal's signed-out mode: **Download my records**, the `.zip` with `records.json`
        and `receipts/` (MUT-286/287).
   3. Book a screen-share. They re-enter their clients and open receivables in the portal (or the
      phone) with you, into the profile you agree on.
   4. Then they compare the totals on the free app's Overview with the portal's Money summary for
      the same month. Note the check in the offboarding log's onboarding line.
3. Never ask for their records file by email to type it in yourself. It's their financial data, and
   the pilot promises it doesn't travel.

## 4. Restore: one profile or the whole database

**First decide what broke.**

| Situation | Do |
|---|---|
| One person deleted or changed their own records by mistake | §4.2, one profile. Nobody else loses anything |
| A bad release or migration corrupted many profiles, or the database is lost | §4.3, the whole database |
| Only a receipt file is missing | §4.4 |

What you have:

- 14 daily automated backups, taken at 03:00 UTC.
- 7 days of point-in-time recovery (PITR), down to the second.
- The backups hold rows, not receipt files. A deleted receipt's file stays restorable for 14 days,
  as long as the oldest backup (§4.4).
- **Which instance:** `mutaba3a-pg` until the MUT-381 cutover, `mutaba3a-pg2` after it
  (DEPLOYMENT.md §6d). Set it once before the commands below:

  ```bash
  (cd server/infrastructure/terraform && terraform init -reconfigure -backend-config="bucket=$TF_STATE_BUCKET" -backend-config="prefix=mutaba3a-api/production" >/dev/null)
  INSTANCE=$(cd server/infrastructure/terraform && terraform output -raw cloud_sql_instance_name)
  : "${INSTANCE:?terraform output failed: fix the init above before running anything below}"
  ```

**Find the moment.** The profile's audit trail shows when the mistake happened:

```bash
curl -s "$URL/admin/v1/organizations/<profile id>/audit" -H "x-admin-token: $MUTABA3A_ADMIN_TOKEN" \
  | jq -r '.events | sort_by(.createdAt) | reverse | .[] | "\(.createdAt) \(.action) \(.entityType) \(.entityId)"' | head -50
```

Pick a time just **before** it, in UTC (`2026-11-03T09:14:00.000Z`).

### 4.1 Make a restored copy (the first step of both §4.2 and §4.3)

The copy is a scratch instance with the drill's naming, so `scripts/restore-drill.sh teardown`
deletes it. It costs roughly $0.10–0.20 an hour; delete it the same day.

```bash
COPY=mutaba3a-pg-drill-$(date -u +%Y%m%dt%H%M%S)-p
AT=2026-11-03T09:14:00.000Z                                  # just before the mistake, within the last 7 days
gcloud sql instances clone "$INSTANCE" "$COPY" --point-in-time="$AT" --project=$GCP_PROJECT_ID
gcloud sql instances patch "$COPY" --no-deletion-protection --no-backup --no-enable-point-in-time-recovery \
  --update-labels=purpose=restore-drill --project=$GCP_PROJECT_ID --quiet
PW=$(openssl rand -hex 24)
gcloud sql users set-password mutaba3a_api --instance="$COPY" --password="$PW" --project=$GCP_PROJECT_ID --quiet   # the copy only
cloud-sql-proxy "$GCP_PROJECT_ID:me-west1:$COPY" --port 5452 --quiet &
export SOURCE_DATABASE_URL="postgresql://mutaba3a_api:$PW@127.0.0.1:5452/mutaba3a"
```

**Older than 7 days?** Restore a daily backup into a fresh instance instead, as the drill does:

- `gcloud sql backups list --instance="$INSTANCE" --project=$GCP_PROJECT_ID` to pick the backup;
- `gcloud sql instances create "$COPY" …` with the flags in `scripts/restore-drill.sh`, `restore_backup`;
- `gcloud sql backups restore <id> --restore-instance="$COPY" --backup-instance="$INSTANCE" --project=$GCP_PROJECT_ID`. Once the
  source is `mutaba3a-pg2`, create `$COPY` with
  `--disk-encryption-key=projects/$GCP_PROJECT_ID/locations/me-west1/keyRings/mutaba3a/cryptoKeys/mutaba3a-data`
  so the copy stays under the key.

Check the copy before using it:

```bash
psql "$SOURCE_DATABASE_URL" -c "SELECT max(\"createdAt\") FROM audit_events"      # just before $AT
psql "$SOURCE_DATABASE_URL" -c "SELECT count(*) FROM _prisma_migrations"            # compare with production's
```

### 4.2 Restore one profile

`scripts/profile-rows.sh restore` puts **one profile's records** back as the copy has them, in one
transaction on production.

**What's kept as live has it.** It never rolls back access:

- `api_keys`, `memberships`, `integrations` and `idempotency_keys` stay as they are now;
- `audit_events` only grow: rows missing from live are added back, none are removed;
- a `SYSTEM` event `organization.restored` records the restore.

**What's lost.** Everything else the person recorded in that profile after `$AT`. Tell them before
you start (§5.3 template).

1. **Ask the person to stop using the profile** until you write back. The restore locks the
   profile's row, but an app open on their phone could save an entry right after.
2. **If production has run a migration since `$AT`,** bring the copy up to date first. This is the
   copy only, never production:
   `DATABASE_URL="$SOURCE_DATABASE_URL" npx prisma migrate deploy`. The script refuses a schema
   mismatch and names the tables.
3. **Rehearse.** This runs everything and rolls back:

   ```bash
   npm run db:run -- scripts/profile-rows.sh restore --organization-id <profile id> --label "PITR $AT" --dry-run
   ```

   Read the table: "live now" vs "copy", row counts per table.
4. **Restore.** Type the profile id when asked:

   ```bash
   npm run db:run -- scripts/profile-rows.sh restore --organization-id <profile id> --label "PITR $AT"
   ```

5. **Check receipts.** The script lists receipts that came back. For each one, see §4.4.
6. **Re-check access by hand.** Look at who's a member, and any API key or Malafat binding changed
   since `$AT`, against what the person expects.
7. **Delete the copy:**

   ```bash
   kill %1
   scripts/restore-drill.sh teardown --project $GCP_PROJECT_ID --name "$COPY"
   ```

   Then tell the person it's done (§5.3).

### 4.3 Restore the whole database

**Everyone** loses what they recorded after the restore point. Treat it as an S1 incident (§5).
First:

```bash
gcloud sql backups create --instance="$INSTANCE" --project=$GCP_PROJECT_ID --description="before restore $(date -u +%FT%RZ)"   # the undo point
gcloud scheduler jobs pause mutaba3a-stripe-reconcile --location=me-west1 --project=$GCP_PROJECT_ID                         # once Stripe is on (§1.7); NOT_FOUND = off, go on
gcloud run services update mutaba3a-api --region=me-west1 --project=$GCP_PROJECT_ID --ingress=internal                       # stop portal, phone and Malafat traffic
```

Pause the nightly Stripe reconcile first: Cloud Scheduler counts as internal traffic, so it still reaches a closed
API and would write while you restore.

The next `./scripts/deploy.sh` sets ingress back to Terraform's `INGRESS_TRAFFIC_ALL` anyway, unless
`production.tfvars` sets `api_ingress = "INGRESS_TRAFFIC_INTERNAL_ONLY"` for as long as the restore takes.

**A. Last night's backup, in place.** Fastest. The instance restarts, and everything after the
backup is lost.

```bash
gcloud sql backups list --instance="$INSTANCE" --project=$GCP_PROJECT_ID --filter="type=AUTOMATED AND status=SUCCESSFUL" --limit=3
gcloud sql backups restore <backup id> --restore-instance="$INSTANCE" --backup-instance="$INSTANCE" --project=$GCP_PROJECT_ID
```

**B. A point in time.** Copy it back with Postgres 16 tools:

1. Make the copy at `$AT` (§4.1) and check it.
2. Start the production proxy with `npm run db:proxy` in a second terminal. It prints the URL;
   export it as `PROD_URL`.
3. Then run:

   ```bash
   PG16=/opt/homebrew/opt/postgresql@16/bin
   $PG16/pg_dump --format=custom --no-owner --no-privileges --file=/tmp/mutaba3a-restore.dump "$SOURCE_DATABASE_URL"
   $PG16/pg_restore --clean --if-exists --no-owner --no-privileges --single-transaction --exit-on-error --dbname="$PROD_URL" /tmp/mutaba3a-restore.dump
   rm -P /tmp/mutaba3a-restore.dump
   ```

   - It's one transaction: a failure leaves production as it was.
   - Walked locally on 2026-10-20 (§9): `--clean` over a database with the same schema restored
     every table, migrations included.

**After either:**

1. **Migrations.** The restore point may predate a migration:
   `npm run db:migrate:status`, then `npm run db:migrate` if anything is pending.
2. **Database password.** If it was rotated after the restore point, the restored instance has the
   old one, and `/ready` fails. Rotate again with DEPLOYMENT.md §6: `-replace=random_password.db`,
   then deploy.
3. **Purges.** **Re-run every purge since the restore point.** A restored database brings back
   every account purged after it (§7.3). Re-run `purge-user` for each purge-log line dated after
   the restore point. This is the one way a restore could break the deletion promise.
4. **Reopen and check:**
   `gcloud run services update mutaba3a-api --region=me-west1 --project=$GCP_PROJECT_ID --ingress=all`,
   then `npm run smoke -- --url "$URL"`.
5. **Stripe** (once §1.7 is done). Stripe won't redeliver an event it already got a 200 for, so whatever the
   webhook mirrored after the restore point is gone until you replay it:

   ```bash
   gcloud scheduler jobs resume mutaba3a-stripe-reconcile --location=me-west1 --project=$GCP_PROJECT_ID
   npm run billing:reconcile -- --url "$URL"
   ```

   Then re-apply every `billing:link` and every `billing:grant` / `billing:revoke` made after the restore point:
   the `billing.account_linked`, `billing.grant_created` and `billing.grant_revoked` audit events, and your ops
   notes. The restore took those rows back too, so read them from the undo-point backup (a §4.1 copy) if your
   notes are thin. Then `billing:status` (§1.7 step 6) for each person touched.
6. **Receipts.** See §4.4.
7. **Tell everyone** (§5.3), and record the incident (§5.5).

### 4.4 Receipt files

Deleting a receipt deletes its object, and the database backups hold rows, not files. A restored
receipt row can therefore point at a file that was deleted after that backup.

The attachments bucket keeps deleted objects restorable (soft delete) for **14 days**, as long as the
oldest daily backup, so a restore in §4.2 or §4.3 can still find its files if you restore them the
same day (TD-190, DEPLOYMENT.md §6c). Until §6c is applied the bucket keeps GCS's default of 7 days. The drill prints
the bucket's actual window.

```bash
B=$GCP_PROJECT_ID-mutaba3a-attachments
gcloud storage objects describe "gs://$B/<storageKey>"                   # still there?
gcloud storage ls --soft-deleted "gs://$B/<storageKey>"                   # deleted but restorable? note its generation
gcloud storage restore "gs://$B/<storageKey>#<generation>"
```

After a §4.2 or §4.3 restore, do this for each restored receipt whose file is missing.

**Past the window, the file is gone.** Tell the person, and ask them to upload it again if they still
have it.

## 5. Respond to an incident

### 5.1 How you find out

- **Uptime alerts (MUT-328):** `/health`, `/ready` and the portal from six regions. An alert pages
  Basel by **email + SMS** after 2 failed rounds, about 10 minutes. Cloud SQL disk and CPU send
  warnings.
  - This only works once DEPLOYMENT.md §6b is applied and its drill has passed. Until then, nothing
    pages anyone.
  - What each alert means: DEPLOYMENT.md §6b "When an alert fires".
- **Sentry (MUT-146):** server and portal errors, once the EU org is applied (INFRA.md).
- **A user's email** (§6).

### 5.2 Severity, who is told, how fast

**⚠ Basel decides** all three columns. The proposal:

| Severity | Examples | Acknowledge | Tell |
|---|---|---|---|
| **S1** | Data lost or exposed to the wrong person; service down for more than 30 min; a whole-database restore | 30 min while awake | Every pilot user: within **2 hours** of knowing, then when it's resolved. A personal-data breach: also the authorities (below) |
| **S2** | One user's data wrong or lost (§4.2); portal or phone broken for some users; down for under 30 min | Same day | The affected users, same day |
| **S3** | Something looks wrong but no data or access is affected | Next working day | Whoever reported it, within the support promise (§6) |

**Personal-data breach** (someone saw data that isn't theirs; a leaked token or export):

- The seller is Barmajiyat Ltd (UK). UK GDPR asks you to notify the ICO within **72 hours** of
  becoming aware, unless the breach is unlikely to risk anyone's rights.
- The data lives in Israel (`me-west1`), so Israel's Privacy Protection (Data Security) Regulations
  may also require a report to the Privacy Protection Authority.
- **⚠ Basel decides with counsel** which of these apply, and who files.

Contain first:

- rotate the session pepper (DEPLOYMENT.md §6, signs everyone out);
- `rotate:password --lock` the account;
- revoke the API key.

### 5.3 What to say

Plain email from the support inbox, in the person's language. EN draft (the AR version mirrors it):

> **Subject:** Mutaba3a: [what happened], [date]
> On [date, time and zone], [what happened, in one sentence]. [What it means for you: what was lost
> or exposed, or "nothing of yours was affected"]. We [what we did]. [What you need to do, or
> "Nothing needs doing on your side"]. We'll write again by [time] / This is resolved.

- For a one-profile restore, say first which entries after `$AT` will need re-entering.
- Never put a setup link or any record in an incident email.

### 5.4 Steps

1. **Acknowledge.** Note the time you knew.
2. **Contain:**
   - a release caused it: roll back with `IMAGE_TAG=<old sha> ./scripts/deploy.sh`. After the MUT-381
     cutover never shift Cloud Run traffic to a revision from before it: those mount only `mutaba3a-pg`
     and fail every request (DEPLOYMENT.md §6d);
   - access is at risk: lock or rotate (above);
   - writes are corrupting data: close ingress (§4.3);
   - after the MUT-381 cutover, the database or receipts fail with a KMS or "key" error: a version of
     `mutaba3a-data` was disabled or scheduled for destruction. Re-enable it, or cancel the destroy,
     which is possible for 30 days (`gcloud kms keys versions list --key=mutaba3a-data --keyring=mutaba3a --location=me-west1`).
     Never disable a version yourself: Cloud SQL doesn't re-encrypt on rotation (ADR-164). The same goes
     for the Cloud SQL and Cloud Storage agents' grants on the key (`terraform apply` restores them). The
     `mutaba3a-data key version changed` alert pages on any of these; its log filter has not been tried
     against a live audit entry yet, so test it once in a scratch project (disable and re-enable a
     non-primary version) before relying on it.
3. **Restore** if data was lost (§4).
4. **Tell** people (§5.2, §5.3).
5. **Record** it (§5.5) within 2 days, with the cause and the fix (a ticket).

### 5.5 Incident log

| Date (UTC) | Severity | What happened | Users told (when) | Fixed by | Ticket |
|---|---|---|---|---|---|
| | | | | | |

## 6. Support

- **Channel:** email only.
  - The inbox is **info@malafat.app**, named in the terms (`src/content/legal/terms/2026-10-19.*.json`)
    and pilot-offer §4.
  - There's no WhatsApp and no phone (Basel, 2026-10-19).
  - **⚠ Basel decides:** keep the shared Malafat inbox, or move Mutaba3a to its own address once the
    domain lands (MUT-326). Either way the terms text and this line must match.
- **Promise:** a reply within **2 working days** (pilot-offer §4, the terms).
  - **⚠ Basel decides** the working days: Sunday–Thursday (Israel) or Monday–Friday (UK).
- **Triage routine:**
  1. **Each working morning,** read the inbox, and Netlify Forms › `hosted-request` (new /hosted
     requests, and their Spam folder weekly; INFRA.md §1).
  2. **Label each email:** account (§1, §2), data (§3, §4), billing (Stripe), bug (open a MUT Bug
     with steps, never the user's data), close account (§7), or feedback (pilot review).
  3. **Reply within the promise,** even if only "we're on it, here's when". An S1 or S2 goes to §5
     straight away.
  4. **Friday:** go through the open threads in the weekly pilot review.
- **Identity:** act only on email from the account's own address. A password reset or a deletion
  asked from another address waits for a reply from the account's address.

## 7. Offboard a user

Basel's decision (2026-10-19, MUT-327 and MUT-333):

1. The person exports their records first.
2. Then a **30-day** grace period.
3. Then a hard delete.
4. Backups age out **14 days** after that.

The operator does all of this by hand until MUT-333 ships "Close my account". A lapsed payment never
starts deletion: the account goes read-only instead.

### 7.1 Day 0: the request, and the export

1. **Confirm the request** from the account's own address (§6). Note the date in the offboarding log.
2. **The export.** MUT-325 (signed-in "Download my records") is merged to `main` (2026-10-20) but
   not released yet; it goes out with the next server release (MUT-329).
   - **Once it's live,** the person downloads it themselves from Settings › Your data, per profile
     they own. It's the same records file as local mode, receipts included, and it's audited
     `records.exported`.
   - **Until then,** you export for them, per profile they own:

     ```bash
     npm run db:run -- scripts/profile-rows.sh export --organization-id <profile id> --out ~/offboarding/<date>-<profile id> \
       --bucket $GCP_PROJECT_ID-mutaba3a-attachments
     cd ~/offboarding/<date>-<profile id> && mkdir -p receipts && sh receipts.txt && cd - && \
       zip -r -e ~/offboarding/<date>-<profile id>.zip ~/offboarding/<date>-<profile id>     # asks for a password
     ```

     - The export is one CSV per table, the profile row, and the receipt files.
     - Send the zip one way and its password another: email, then SMS.
     - Delete both local copies once they confirm receipt.
     - **⚠ Basel decides:** whether this CSV export is enough, or anyone leaving before the
       release waits for MUT-325's records file.
3. **Cancel their Stripe subscription** at the period's end, in the dashboard (pilot-offer §5). In the same visit,
   delete the metadata that links them: `mutaba3a_user_id` on the Customer, and `mutaba3a_organization_id` on each
   of their Subscriptions. Otherwise the nightly reconcile keeps mirroring a person you are about to purge.

### 7.2 Day 0: start the grace period

```bash
npm run disable:user -- --url "$URL" --email <email>      # can't sign in; open setup links cancelled
```

Write the grace-period end (day 0 + 30) in the offboarding log.

**They change their mind within 30 days?** Run `npm run enable:user -- --url "$URL" --email <email>`;
nothing was deleted.

### 7.3 Day 30: the hard delete

1. **Shared profiles first.** For each operator firm profile they're a member of but don't own:

   ```bash
   npm run revoke:user -- --url "$URL" --email <email> --organization-id <firm id>
   ```

   That's audited on the firm's own trail.

   **Co-owners (MUT-373).** `purge-user` also refuses:
   - a person who **created** a profile that still has co-owners — remove each co-owner first (`revoke:user`
     on that profile), or hand the profile over (no command yet, TD-194);
   - a co-owner who **recorded anything** on someone else's shared profile, even after leaving it
     (`expenses.createdByUserId` and friends are Restrict). Stop and ask: MUT-333 decides whether those records
     move to the creator or the person is anonymized.
2. **Rehearse the purge.** This runs it all and rolls back:

   ```bash
   USER_ID=$(curl -fsS "$URL/admin/v1/users?email=<email>" -H "x-admin-token: $MUTABA3A_ADMIN_TOKEN" | jq -r ".users[0].id")
   npm run db:run -- scripts/profile-rows.sh purge-user --user-id "$USER_ID" --bucket $GCP_PROJECT_ID-mutaba3a-attachments --dry-run
   ```

   It refuses, and names the reason:
   - while they're still a member of a profile they don't own (step 1);
   - while rows in someone else's profile still point at them, such as an expense they entered in a
     firm. That case is MUT-333's decision: **stop and ask Basel**.
3. **Purge.** Type the user id when asked:

   ```bash
   npm run db:run -- scripts/profile-rows.sh purge-user --user-id "$USER_ID" --bucket $GCP_PROJECT_ID-mutaba3a-attachments
   ```

   - It deletes, in one transaction:
     - every row of each profile they own (personal and Business), and the profiles;
     - their sessions, setup links, terms acceptances, inbox and idempotency rows;
     - their `user.terms_accepted` audit rows on any profile;
     - the user.
   - Audit rows on other profiles that name their id stay as the tombstone. The script counts them.
4. **Delete the files:** run the `gcloud storage rm --recursive 'gs://…/org/<id>/'` lines it printed.
5. **Record it.** Copy its "Offboarding log line" into the offboarding log. §4.3 needs that line if
   the database is ever restored to an earlier point.
6. **Other services:**
   - **PostHog:** if they opted in, delete the person in project 304889.
   - **Netlify Forms:** delete their `/hosted` request, if any (INFRA.md §1 retention).
   - **Stripe:** keeps invoices as the tax law requires.

### 7.4 Day 44: backups have aged out

The last daily backup that held them expires 14 days after the purge. PITR logs go after 7, and the
receipt files deleted in §7.3 step 4 leave the bucket's soft delete after 14 (DEPLOYMENT.md §6c).
Reply to the person that deletion is complete, if they asked to be told.

## 8. The restore drill

`server/scripts/restore-drill.sh` proves the backups restore, without changing production. In one
run it:

1. restores last night's automated backup into a scratch instance;
2. clones a second scratch instance at a point in time 1 hour ago;
3. checks both read-only: every table's row count, migrations applied, the newest audit event, and
   that a known receipt's file opens from the bucket;
4. prints the timings;
5. deletes both instances.

- **Cost:** about $0.20–0.40 for an hour of two `db-g1-small` instances. It asks before each one.
- **Safety:**
  - Every command that creates, changes or deletes something refuses any name but
    `mutaba3a-pg-drill-<stamp>-b|p`.
  - The scratch copies get their own throwaway password, so the drill never reads production's.
  - `--dry-run` prints the whole sequence and calls nothing.
- **Which instance (MUT-381):** without `--instance` it drills the one the API serves from, read from
  terraform state (`TF_STATE_BUCKET`): `mutaba3a-pg2` after the CMEK cutover. A copy of a CMEK
  instance is created under the same key.

**Run it (Basel):**

```bash
cd server
scripts/restore-drill.sh --project $GCP_PROJECT_ID --dry-run          # read the sequence first
scripts/restore-drill.sh --project $GCP_PROJECT_ID --receipt-id <a receipt you know opens in the portal>
```

1. **Pick the receipt** from your own test profile in the portal. Open it once there, and note its
   id from the expense drawer or `npm run db:psql`. Without `--receipt-id` the drill takes the newest
   receipt in each copy.
2. **Expect** 10–20 minutes for the instance creation, the restore and the clone each. The checks
   take seconds.
3. **Paste** the "Drill results" table it prints, the receipt lines and the audit comparison into §10.
4. **If it fails or you stop it,** the exit trap deletes what it made. Check with
   `scripts/restore-drill.sh teardown --project $GCP_PROJECT_ID`, which lists every leftover
   `mutaba3a-pg-drill-*` instance and asks before deleting each.
5. **If the receipt check fails** with "object missing", the file was deleted after that backup.
   Restore it per §4.4, and check that the window the drill printed is `1209600` (14 days). Anything
   shorter means DEPLOYMENT.md §6c isn't applied.

Run the drill again after any change to backups or the database tier, and before the pilot opens
beyond 10 users.

## 9. Walk log

AC2: each step walked once on staging or a scratch database. There's no staging (ADR-026).

**2026-10-20 walk, by Claude (MUT-327).** It used:

- the shared local API on `:8787`, running local `main`;
- the `mutaba3a-test-pg` container's `mutaba3a_dev`, with one throwaway account
  `pilot-runbook-walk@mutaba3a.test`, purged at the end;
- copies of that database;
- the drill script and the restore and purge tool, also covered by tests
  (`server/src/scripts/__tests__/restore-drill.test.ts`, `profile-rows.test.ts`).

| Step | Walked | Where | Result |
|---|---|---|---|
| §1.1 `provision:user` | ✅ | local API | Personal profile; link printed once, valid 72 h |
| §1.2 link check, sign-in refused before setup, set password, link reused, sign in | ✅ | local API | Check valid; sign-in 401 before setup; set 200; sign-in 201 |
| §1.3 owner adds a Business profile, records expenses | ✅ | local API | 201s |
| §1.4 firm switch | ❌ | not on `main` (MUT-300) | Walk once MUT-300 merges |
| §2 `rotate:password` | ✅ | local API | Old password 201 until the link was used, then 401; old session 401 |
| §2 `rotate:password --lock` | ✅ | local API | Session and password 401 at once; link restores access |
| §3 free-app move | ❌ | no tool (MUT-290) | Procedure only; ⚠ decision open |
| §4.1 clone or backup into a scratch instance | ⚠ dry run only | needs production | The drill's dry run prints the exact sequence |
| §4.2 restore one profile (dry run, then for real) | ✅ | dev copy → dev | Deleted expense came back; dry run changed nothing; `organization.restored` audited; 7 s |
| §4.3 B whole database, `pg_dump` + `pg_restore --single-transaction` | ✅ | dev copy → new database, and `--clean` over a populated one | Every count matched (users 12, organizations 24, expenses 523, audit 4160, migrations 30); 1–2 s. **Found:** pg_dump 18 output fails on Postgres 16; use v16 tools (§0) |
| §4.3 A backup restore in place; ingress close/reopen | ❌ | needs production | Commands from gcloud docs; not run |
| §4.4 soft-deleted receipt restore | ❌ | needs the bucket | Not run; the drill reads the window |
| §5 incident response | — | a routine, not a procedure | Becomes real once §6b's alert drill passes |
| §6 support | — | a routine | — |
| §7.1 export | ✅ | dev | 26 CSV files and `receipts.txt`; no `api_keys` |
| §7.2 `disable:user` | ✅ | local API | Sign-in 401 |
| §7.3 `purge-user` (dry run, then for real) | ✅ | dev | 2 profiles and every row gone; nothing else touched; bucket lines printed |
| §8 restore drill | ⚠ dry run + shellcheck | needs production | **Basel runs it**, results in §10 |

## 10. Drill results

Filled in by Basel after running §8 against production backups (AC1).

| | |
|---|---|
| Date (UTC) | |
| Operator | |
| Backup restored (id, window start) | |
| Point in time restored | |
| gcloud / Cloud SQL versions | |

| Step | Seconds |
|---|---:|
| Create scratch instance (backup) | |
| Restore last night's backup | |
| Checks on the backup copy | |
| Point-in-time clone (60 min ago) | |
| Checks on the PITR copy | |
| Whole drill (before teardown) | |
| Teardown | |

| Check | Backup copy | PITR copy |
|---|---|---|
| Tables / migrations applied | | |
| Newest audit event | | |
| `audit_events` (PITR ≥ backup) | | |
| Receipt opens (id, type, bytes) | | |
| Bucket soft-delete window | | |

Problems found and tickets opened:

-

## 10. Retire a currency (MUT-388, ADR-166)

The database doesn't refuse a currency the API no longer supports: a row stored while it was supported reads back
with a blank amount. So a server release that drops a currency (MUT-388 dropped AED, SAR, QAR, BHD and OMR) runs this
gate **before and after** `make release server`. Before, so you know; after, because the old API accepts the codes
until the new one is live.

1. Count (read-only). Exit 0 means nothing to do; exit 3 prints table, column, code, profile and rows:

   ```bash
   npm run db:run -- scripts/currency-rows.sh count
   ```

2. Rows on **your own test or operator profiles** go. Rehearse, then do it:

   ```bash
   npm run db:run -- scripts/currency-rows.sh delete-test-profiles --organization-id <uuid>[,<uuid>…] --dry-run
   npm run db:run -- scripts/currency-rows.sh delete-test-profiles --organization-id <uuid>[,<uuid>…]
   ```

   A test profile whose own currency is a removed one is printed, not deleted: change it in the portal
   (Settings › Profiles).
3. A row on **anyone else's profile** stops the release. Basel decides what happens to it; note it in the log.
4. After the release, count again. It must exit 0 (or list only rows Basel has decided to keep).

