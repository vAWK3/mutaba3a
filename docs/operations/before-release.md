# Before release: operator steps not done yet

`make release web` and `make release server` print the open items for their target here, just
before they ask to deploy. One item per line, starting with `- `. Delete an item once it's done, and
record the date where the item says.

## server

- MUT-360's Terraform (Stripe secrets, job token, Scheduler) is merged: the release creates the empty Stripe secrets and mounts `MUTABA3A_JOB_TOKEN`. Not blocking: Stripe stays off until `stripe_enabled = true`. Apply and turn it on per `server/DEPLOYMENT.md` §6e.

## web
