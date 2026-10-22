# Before release: operator steps not done yet

`make release web` and `make release server` print the open items for their target here, just
before they ask to deploy. One item per line, starting with `- `. Delete an item once it's done, and
record the date where the item says.

## server

- MUT-360's Terraform (Stripe secrets, job token, Scheduler) is merged: the release creates the empty Stripe secrets and mounts `MUTABA3A_JOB_TOKEN`. Not blocking: Stripe stays off until `stripe_enabled = true`. Apply and turn it on per `server/DEPLOYMENT.md` §6e.
- MUT-148's error reporting is merged but off: the release changes nothing until `sentry_enabled = true`. First apply the Sentry stack (`server/DEPLOYMENT.md` §1.5, org `barmajiyat-ltd`), then set `sentry_enabled = true` in `production.tfvars` and release. The smoke must print `PASS  Error reporting matches the release — on vs on`; then run the §1.5 step 8 `sentry:smoke` once and record the date in INFRA's "Error reporting" Status row.

## web

- MUT-387 moves the Malafat OAuth client identity to `https://mtb3a.com/.well-known/oauth-client.json`. After this release, check the live document: `curl -sI` on that URL returns 200, `content-type: application/json` and no `location`, and `curl -s` on it piped to `jq -r .client_id` prints the same URL. Then, in Malafat, list `oauth_clients` rows with `client_id = 'https://mutaba3a.app/.well-known/oauth-client.json'` in each tenant schema and report the counts before deleting any. Delete this item and record the date on MUT-387.
