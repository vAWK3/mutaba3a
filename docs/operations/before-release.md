# Before release: operator steps not done yet

`make release web` and `make release server` print the open items for their target here, just
before they ask to deploy. One item per line, starting with `- `. Delete an item once it's done, and
record the date where the item says.

## server

- **BLOCKING — MUT-112 step 0 is committed (`config/hosts.json`: `mtb3a.com`, stage `proxy`, 2026-10-21) but the front-door stack is not applied.** Until `server/infrastructure/frontdoor` is applied (`server/DEPLOYMENT.md` §5a step 1), this release's Terraform plan fails reading the `mutaba3a-api-front-door-token` secret. Apply step 1 first, or release from a branch with `domain: null`. Delete this line once step 1 is applied.
- MUT-360's Terraform (Stripe secrets, job token, Scheduler) is merged: the release creates the empty Stripe secrets and mounts `MUTABA3A_JOB_TOKEN`. Not blocking: Stripe stays off until `stripe_enabled = true`. Apply and turn it on per `server/DEPLOYMENT.md` §6e.

## web
