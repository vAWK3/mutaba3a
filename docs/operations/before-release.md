# Before release: operator steps not done yet

`make release web` and `make release server` print the open items for their target here, just
before they ask to deploy. One item per line, starting with `- `. Delete an item once it's done, and
record the date where the item says.

## server

- MUT-360's Terraform (Stripe secrets, job token, Scheduler) is merged: the release creates the empty Stripe secrets and mounts `MUTABA3A_JOB_TOKEN`. Not blocking: Stripe stays off until `stripe_enabled = true`. Apply and turn it on per `server/DEPLOYMENT.md` §6e.
- MUT-362's Settings › Billing is merged but inert: without GA prices in Stripe it says "Subscriptions open soon". Not blocking. Before selling: widen the restricted Stripe key (Write on Customers, Checkout Sessions, Customer portal; `server/DEPLOYMENT.md` §6e step 2), configure the Customer Portal and add the four `freelancer_list_*` prices (`docs/operations/pilot-runbook.md` §1.7 steps 3a–3b), and fill `consumerCountries` in `server/src/billing/billing-countries.json` from MUT-355's answers (it ships empty: every buyer needs a business tax ID until then).
- MUT-148's error reporting is merged but off: the release changes nothing until `sentry_enabled = true`. First apply the Sentry stack (`server/DEPLOYMENT.md` §1.5, org `barmajiyat-ltd`), then set `sentry_enabled = true` in `production.tfvars` and release. The smoke must print `PASS  Error reporting matches the release — on vs on`; then run the §1.5 step 8 `sentry:smoke` once and record the date in INFRA's "Error reporting" Status row.

## web

- MUT-387 moves the Malafat OAuth client identity to `https://mtb3a.com/.well-known/oauth-client.json`. `make release web` now waits for the live document and checks it (`npm run release:oauth-client`); it must print ✓. Then, in Malafat, list `oauth_clients` rows with `client_id = 'https://mutaba3a.app/.well-known/oauth-client.json'` in each tenant schema and report the counts before deleting any. Delete this item and record the date on MUT-387.
