# Before release: operator steps not done yet

`make release web` and `make release server` print the open items for their target here, just
before they ask to deploy. One item per line, starting with `- `. Delete an item once it's done, and
record the date where the item says.

## server

- TD-190: the attachments bucket keeps deleted receipt files 14 days (`soft_delete_policy`), not applied. This release's `terraform apply` (deploy.sh step 4) will show `google_storage_bucket.attachments` updated in place, `retention_duration_seconds` 604800 -> 1209600: approve it. Or apply it alone first: server/DEPLOYMENT.md §6c. Then record the date in .claude/INFRA.md §2 and delete this line.
- MUT-328: uptime checks and alerts, not applied (.claude/INFRA.md §2, 2026-10-20). Put alert_email and alert_sms_number in production.tfvars first, or the plan adds only the checks and no alerts. Then verify the SMS channel and run the drill: server/DEPLOYMENT.md §6b.

## web
