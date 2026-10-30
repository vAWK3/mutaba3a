variable "project_id" {
  description = "GCP project that hosts the MTB3A API. Production: mtb3a-production from the MUT-487 move (config/gcp.json, ADR-232); malafat-production only in legacy.tfvars (the forwarder, a rollback of the move, the teardown)."
  type        = string
}

variable "region" {
  description = "Region for every resource (the database and its backups, Cloud Run, the registry, the bucket, the secrets' replicas, Scheduler and Cloud Tasks). No default (MUT-523): each project's tfvars names its own, the one config/gcp.json gives it, and deploy.sh refuses a mismatch. ADR-024 as amended by ADR-232: data residency follows the project's region."
  type        = string
}

variable "environment" {
  description = "production (the only environment for now) issues and accepts `live` API keys; a future staging would issue `test` keys (config.API_KEY_ENVIRONMENT). Keys can never cross environments."
  type        = string
  default     = "production"
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production."
  }
}

variable "image_tag" {
  description = "Tag of the mutaba3a-api image to run (the short git SHA that scripts/deploy.sh built and pushed from your Docker daemon). Also reported as SERVICE_VERSION."
  type        = string
}

variable "artifact_repository" {
  description = "Artifact Registry repository name that holds the image."
  type        = string
  default     = "mutaba3a"
}

variable "db_tier" {
  description = "Cloud SQL machine tier. MUT-511 (ADR-233): mtb3a-production runs db-f1-micro (shared CPU, about 0.6 GB, no SLA) until MUT-512's triggers (the CPU and memory alerts in monitoring.tf); moving up a tier is a restart of a few minutes. The default, db-g1-small, is what malafat-production ran."
  type        = string
  default     = "db-g1-small"
}

variable "db_availability" {
  description = "REGIONAL (HA, two zones) or ZONAL. MUT-511 (ADR-233): mtb3a-production runs ZONAL; a zone outage is survived by restoring the latest backup or PITR into another zone (pilot runbook §4.5). malafat-production ran REGIONAL."
  type        = string
  default     = "REGIONAL"
  validation {
    condition     = contains(["REGIONAL", "ZONAL"], var.db_availability)
    error_message = "db_availability must be REGIONAL or ZONAL."
  }
}

variable "db_backup_enabled" {
  description = "Automated backups with point-in-time recovery. Required for production (ADR-024: firm data must be backed up)."
  type        = bool
  default     = true
}

variable "oauth_enabled" {
  description = "MUT-434 (ADR-197): mounts OAUTH_DERIVE_KEY (generated here) into Cloud Run, turning on OAuth for MCP agents (/oauth/*, the OAuth discovery documents, /mcp), and creates the nightly OAuth cleanup job. false (default) = those routes answer 503. Agents still need the per-user agent_access flag (MUT-433)."
  type        = bool
  default     = false
}

variable "stripe_enabled" {
  description = "MUT-360: mounts the Stripe secrets (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET) into Cloud Run and creates the nightly reconcile Cloud Scheduler job. false (default) = the secrets exist empty and the Stripe routes answer 503. Turn it on only after both secrets hold a version (DEPLOYMENT.md §6e), or the new revision fails to start."
  type        = bool
  default     = false
}

variable "mailer" {
  description = "MUT-359 (ADR-159 §5): noop (default) sends no mail; resend mounts the Resend secrets (RESEND_API_KEY, RESEND_WEBHOOK_SECRET) and sends from no-reply@<domain> in config/hosts.json. Turn it on only after both secrets hold a version, the domain is verified in Resend and `npm --prefix server run email:check -- --api` passes (DEPLOYMENT.md §6f). log and memory are development-only and refused in production, so they aren't offered here."
  type        = string
  default     = "noop"
  validation {
    condition     = contains(["noop", "resend"], var.mailer)
    error_message = "mailer must be noop or resend (log and memory are for local development only)."
  }
}

variable "self_signup_enabled" {
  description = "MUT-366 (ADR-159): opens POST /v1/signups (SELF_SIGNUP_ENABLED). Needs mailer = \"resend\" and the Turnstile secret's version. Basel turns it on at GA, after billing and account closing are live (docs/operations/before-release.md)."
  type        = bool
  default     = false
}

variable "mail_reply_to" {
  description = "MUT-359 (D6): where replies to MTB3A mail go (MAIL_REPLY_TO). Required with mailer = \"resend\". MUT-382 (B2): info@mtb3a.com, the address the policy, the terms and the apps name."
  type        = string
  default     = null
}

variable "mail_daily_cap" {
  description = "MUT-359 (D18): mails the API sends in any 24 h (MAIL_DAILY_CAP); 10 % is kept for recovery mail. Required with mailer = \"resend\", and below the Barmajiyat Resend plan's daily limit, which Malafat shares (the free plan allows 100 a day across both)."
  type        = number
  default     = null
  validation {
    condition     = var.mail_daily_cap == null || try(var.mail_daily_cap >= 1 && floor(var.mail_daily_cap) == var.mail_daily_cap, false)
    error_message = "mail_daily_cap must be a whole number of at least 1."
  }
}

variable "operator_alert_email" {
  description = "MUT-359: where the API mails the operator (MUT-367's signup review digest), as OPERATOR_ALERT_EMAIL. null (default) = unset."
  type        = string
  default     = null
}

variable "sentry_enabled" {
  description = "MUT-148 (ADR-091): reads the api DSN from the Sentry stack's state, stores it in Secret Manager and mounts SENTRY_DSN into Cloud Run. false (default) = no error reports. Turn it on only after DEPLOYMENT.md §1.5 has applied server/infrastructure/sentry, or the plan fails reading its state. Once on, deploy.sh refuses a release whose tfvars turns it off (SKIP_SENTRY_GUARD=1 skips that)."
  type        = bool
  default     = false
}

variable "receipts_library_enabled" {
  description = "MUT-255/389: sets RECEIPTS_LIBRARY=true on Cloud Run, which mounts the receipts library (/v1/receipts*) and makes deleting an expense keep its receipts To review. false (default) = the API behaves as before MUT-255. Turn it on when MUT-260 (portal) or MUT-258 (phone) ships, and don't turn it back off: To-review receipts would stay stored but unseen (DEPLOYMENT.md)."
  type        = bool
  default     = false
}

variable "mcp_inbox_writes_enabled" {
  description = "MUT-436 (review D3/D5): sets MCP_INBOX_WRITES=true, so a person's own Claude may add expenses to their inbox (captureSource 'mcp'). false (default) = add_expense offers profiles only. Turn on only after the phone release that decodes an unknown capture source is live AND the iOS/Android minimum build is raised to it (docs/operations/before-release.md); an older phone build fails to load an inbox holding an 'mcp' entry."
  type        = bool
  default     = false
}

variable "billing_gate_enabled" {
  description = "MUT-361 (ADR-181): the lapse gate. true (default) leaves BILLING_GATE unset, and the API enforces it: a READ_ONLY profile refuses session writes and a LOCKED one everything but the records export. false sets BILLING_GATE=false, the operator's kill switch (a pilot person `npm run billing:uncovered` lists still waits for a grant). Nothing is ever deleted either way."
  type        = bool
  default     = true
}

variable "ios_min_build" {
  description = "MUT-293 / MUT-457: the lowest iPhone build (CFBundleVersion, the X-App-Build header) still served; older builds are told to update. null (default) = iPhones are never gated. Builds before MUT-457 restart at 1 per version (1–7 repeat), so the first useful floor is 8, the first build after MUT-457, and it makes every older iPhone update: raise it only to a build already live in the App Store (DEPLOYMENT.md \"Raise the minimum app build\")."
  type        = number
  default     = null
  validation {
    condition     = var.ios_min_build == null || try(var.ios_min_build >= 1 && floor(var.ios_min_build) == var.ios_min_build, false)
    error_message = "ios_min_build must be a whole number of at least 1."
  }
}

variable "android_min_build" {
  description = "MUT-293 / MUT-457: the lowest Android versionCode still served. null (default) = Android is never gated. Raise it only to a versionCode already live on Play."
  type        = number
  default     = null
  validation {
    condition     = var.android_min_build == null || try(var.android_min_build >= 1 && floor(var.android_min_build) == var.android_min_build, false)
    error_message = "android_min_build must be a whole number of at least 1."
  }
}

variable "ios_recommended_build" {
  description = "MUT-293 / MUT-457: iPhone builds below this (but at or above ios_min_build) get a soft \"update available\" nudge. Needs ios_min_build, and must be at least it (the precondition on google_cloud_run_v2_service.api). null (default) = no nudge."
  type        = number
  default     = null
  validation {
    condition     = var.ios_recommended_build == null || try(var.ios_recommended_build >= 1 && floor(var.ios_recommended_build) == var.ios_recommended_build, false)
    error_message = "ios_recommended_build must be a whole number of at least 1."
  }
}

variable "android_recommended_build" {
  description = "MUT-293 / MUT-457: the Android nudge, as ios_recommended_build. Needs android_min_build, and must be at least it."
  type        = number
  default     = null
  validation {
    condition     = var.android_recommended_build == null || try(var.android_recommended_build >= 1 && floor(var.android_recommended_build) == var.android_recommended_build, false)
    error_message = "android_recommended_build must be a whole number of at least 1."
  }
}

variable "min_build_check_disabled" {
  description = "MUT-293 / MUT-457: the kill switch. true sets MIN_BUILD_CHECK_DISABLED=true and the API serves every build, whatever the floors say. false (default) sends nothing: undo a bad floor by setting true, then delete the line once the floor is fixed."
  type        = bool
  default     = false
}

variable "sentry_state_bucket" {
  description = "MUT-148: the GCS bucket holding the Sentry stack's state. null (default) = <project_id>-terraform-state, the bucket both stacks use (DEPLOYMENT.md §1.3)."
  type        = string
  default     = null
}

variable "api_ingress" {
  description = "Cloud Run ingress. INGRESS_TRAFFIC_ALL (default) serves everyone; INGRESS_TRAFFIC_INTERNAL_ONLY closes the service to outside traffic, for a whole-database restore (pilot runbook §4.3) and the source side of the MUT-487 project move (project-move.sh freeze, DEPLOYMENT.md §6d)."
  type        = string
  default     = "INGRESS_TRAFFIC_ALL"
  validation {
    condition     = contains(["INGRESS_TRAFFIC_ALL", "INGRESS_TRAFFIC_INTERNAL_ONLY"], var.api_ingress)
    error_message = "api_ingress must be INGRESS_TRAFFIC_ALL or INGRESS_TRAFFIC_INTERNAL_ONLY."
  }
}

variable "deletion_protection" {
  description = "Refuse `terraform destroy` on the Cloud SQL instance. Keep true in production."
  type        = bool
  default     = true
}

variable "min_instances" {
  description = "Cloud Run minimum instances. mtb3a-production runs 0 (Basel, 2026-10-30, ADR-233): the uptime checks every 300 s keep an instance warm, and with cpu_idle a non-minimum idle instance isn't billed, so it saves about ₪17 a month; the worst case is a cold start of a few seconds after about 15 minutes with no traffic, checks included. In-process timers don't run while it is scaled to zero (TD-215). max_instances stays 1 (TD-017). The default, 1, is what malafat-production ran."
  type        = number
  default     = 1
}

variable "max_instances" {
  description = "Cloud Run maximum instances. Stays at 1 until TD-017 (shared rate-limit store) is resolved: the per-key limiter is in-process, so N instances would allow N × RATE_LIMIT_PER_MINUTE."
  type        = number
  default     = 1
  validation {
    condition     = var.max_instances >= 1 && var.max_instances <= 1
    error_message = "max_instances must stay 1 until TD-017 is resolved; raise this validation together with the shared rate limiter."
  }
}

variable "db_pool_size" {
  description = "Prisma connection pool per Cloud Run instance: connection_limit in the DATABASE_URL secret (MUT-270). GET /v1/entries runs 4 queries per profile in parallel. mtb3a-production: 5 on db-f1-micro (MUT-511), so 2 × 5 × 1 + 10 = 20 ≤ 25."
  type        = number
  default     = 10
  validation {
    condition     = var.db_pool_size >= 1
    error_message = "db_pool_size must be at least 1."
  }
}

variable "db_max_connections" {
  description = "Cloud SQL max_connections flag, set explicitly (MUT-270). 50 is db-g1-small's own default, 25 db-f1-micro's (mtb3a-production, MUT-511); raise it with a bigger tier. Changing it restarts the instance."
  type        = number
  default     = 50
}

variable "rate_limit_per_minute" {
  description = "Per-API-key request budget over a 60 second sliding window."
  type        = number
  default     = 300
}

variable "log_level" {
  description = "pino level for the service."
  type        = string
  default     = "info"
}

variable "enable_uptime_check" {
  description = "Create the Cloud Monitoring uptime checks on GET /health, /ready and the portal page (MUT-328, monitoring.tf)."
  type        = bool
  default     = true
}

variable "alert_notification_channels" {
  description = "Existing Cloud Monitoring notification channel ids that receive every alert, on top of alert_email / alert_sms_number. With no channel at all: checks only, no alert policy."
  type        = list(string)
  default     = []
}

variable "uptime_host" {
  description = "Bare hostname the uptime checks probe (no scheme, path or port). Empty (default) = the portal host config/hosts.json names (MUT-326): the Cloud Run host until the custom domain is live, then app.<domain>. Set it only to override."
  type        = string
  default     = ""
  validation {
    condition     = var.uptime_host == "" || can(regex("^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$", var.uptime_host))
    error_message = "uptime_host must be a bare hostname such as app.example.com: no https://, path or port."
  }
}

variable "uptime_drill_path" {
  description = "Alert drill (MUT-328, DEPLOYMENT.md §6b): a path here adds a fourth check and its alert. /v1/uptime-drill (a 404) fires a real alert; /health makes it recover and close; empty (default) removes it."
  type        = string
  default     = ""
  validation {
    condition     = var.uptime_drill_path == "" || startswith(var.uptime_drill_path, "/")
    error_message = "uptime_drill_path must start with / (for example /v1/uptime-drill), or be empty."
  }
}

variable "alert_email" {
  description = "Email address that receives every alert (MUT-328). Empty = no email channel. Set it in production.tfvars."
  type        = string
  default     = ""
  validation {
    condition     = var.alert_email == "" || can(regex("^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$", var.alert_email))
    error_message = "alert_email must be an email address, or empty."
  }
}

variable "alert_sms_number" {
  description = "Phone number in E.164 (+972…) that receives every alert by SMS (MUT-328). Kept out of the repo: set it only in the git-ignored production.tfvars. Empty = no SMS channel."
  type        = string
  default     = ""
  sensitive   = true
  validation {
    condition     = var.alert_sms_number == "" || can(regex("^\\+[1-9][0-9]{6,14}$", var.alert_sms_number))
    error_message = "alert_sms_number must be in E.164 form: + then the country code and number, digits only."
  }
}

variable "attachments_url_ttl_seconds" {
  description = "Lifetime of signed upload/download URLs for attachments (M6)."
  type        = number
  default     = 900
}

variable "apple_team_id" {
  description = "Apple Developer Team ID for the iOS app (MUT-111 AASA / universal links and saved-password trust). Empty (default) disables app-association serving; must be set together with apple_bundle_id, android_package_name and android_sha256_fingerprints, or left empty with them — see the lifecycle precondition on google_cloud_run_v2_service.api."
  type        = string
  default     = ""
}

variable "apple_bundle_id" {
  description = "iOS bundle identifier (MUT-111). See apple_team_id."
  type        = string
  default     = ""
}

variable "android_package_name" {
  description = "Android applicationId (MUT-111 Digital Asset Links). See apple_team_id."
  type        = string
  default     = ""
}

variable "android_sha256_fingerprints" {
  description = "Comma-separated SHA-256 signing certificate fingerprints — debug and upload-key at minimum (MUT-114 adds the Play App Signing one later). See apple_team_id."
  type        = string
  default     = ""
}

# MUT-441: the server reads receipts (receipt_ocr.tf).
variable "server_ocr_enabled" {
  description = "MUT-441: the receipt-ocr service, its locked network, the receipt-reads queue, the 5-minute sweep and their service accounts, and SERVER_OCR=true plus OCR_URL, READ_QUEUE, API_ORIGIN, READ_INVOKER_SA and SWEEP_INVOKER_SA on the API. false (default) = none of it exists and the API gets SERVER_OCR=false. Even on, a receipt reads only for an uploader granted receipt_reading in the operator console. First apply after MUT-487's project move (docs/operations/before-release.md)."
  type        = bool
  default     = false
}

variable "ocr_image_tag" {
  description = "MUT-441: tag of the receipt-ocr image. null (default) = image_tag, the same commit as the API; deploy.sh passes it, and a rollback keeps the running one when the target commit has no OCR image (F6)."
  type        = string
  default     = null
}

variable "ocr_min_instances" {
  description = "MUT-441 (R4): receipt-ocr instances kept warm. 0 (default) sleeps when idle; the first read after a quiet spell takes about 12–18 s. Set 1 (about $50–70 a month) when pilots complain or volume grows."
  type        = number
  default     = 0
  validation {
    condition     = var.ocr_min_instances >= 0 && var.ocr_min_instances <= 3
    error_message = "ocr_min_instances must be 0 to 3 (the service's max instances)."
  }
}

variable "ocr_subnet_cidr" {
  description = "MUT-441 (R9): the receipt-ocr subnet Direct VPC egress takes instance IPs from. /26 or larger; it connects to nothing, so any private range the project doesn't use."
  type        = string
  default     = "10.80.0.0/26"
}

# ============================================================================
# MUT-487 (ADR-232): the move to mtb3a-production
# ============================================================================

variable "scheduler_paused" {
  description = "MUT-487 (R2, D3): pauses every Cloud Scheduler job of this stack. The new project sets true from its first apply until the cutover's open step, so its jobs never act on a rehearsal copy (duplicate trial mails, purges). false (default) = the jobs run. The legacy forwarder pauses them regardless."
  type        = bool
  default     = false
}

variable "api_public" {
  description = "MUT-487 (R3, D4): grants run.invoker to allUsers (the service authenticates every request itself). The new project sets false until the cutover's open step: then only callers with run.invoker reach it, through `gcloud run services proxy`. true (default) = public."
  type        = bool
  default     = true
}

variable "live_label" {
  description = "MUT-487 (AM7): the Cloud Run label mtb3a-live, the signal project-move.sh reads: it refuses to copy data over a service labelled live. The new project sets false until the cutover's open step. true (default) = live."
  type        = bool
  default     = true
}

variable "legacy_stack" {
  description = "MUT-487 (AM5): this is MTB3A's old project (malafat-production), applied with LEGACY_STACK=1 and legacy.tfvars. The forwarder token secret is then created empty, for project-move.sh secrets to copy the new project's value into, and the forwarder's own service account exists. false (default) = the production project, which generates the token."
  type        = bool
  default     = false
}

variable "legacy_forwarder" {
  description = "MUT-487 (D6/D7, AM4): runs the service as the legacy run.app forwarder (server/src/forwarder.ts) to forward_to: no database mount, no secrets but the forwarder token, its own service account, every Scheduler job paused. Only with legacy_stack. MUT-521 retires it."
  type        = bool
  default     = false
}

variable "forward_to" {
  description = "MUT-487: the new service's origin the forwarder relays to (https://mutaba3a-api-<hash>-zf.a.run.app, no path). Required with legacy_forwarder."
  type        = string
  default     = null
}

variable "registry_cleanup_dry_run" {
  description = "MUT-511: Artifact Registry runs the cleanup policy (keep the 3 newest of each image, delete untagged images older than 7 days) as a dry run, logging what it would delete. Set false only after reading the dry run (DEPLOYMENT.md §6d)."
  type        = bool
  default     = true
}

variable "billing_account_id" {
  description = "MUT-511: the billing account (XXXXXX-XXXXXX-XXXXXX) to put this project's monthly budget on (budget.tf). null (default) = no budget: set it only for MTB3A's own project."
  type        = string
  default     = null
}

variable "budget_amount" {
  description = "MUT-511: the monthly budget, in budget_currency, alerting at 50%, 90% and 100%. Required with billing_account_id. MUT-523: 25 (GBP) for mtb3a-production."
  type        = number
  default     = null
}

variable "budget_currency" {
  description = "MUT-511, MUT-523: the budget's currency, an ISO 4217 code. Google refuses any but the billing account's own: Barmajiyat Ltd's account 01E433-999491-75ECBD bills in GBP. Required with billing_account_id; nothing in the code names one."
  type        = string
  default     = null
  validation {
    condition     = var.budget_currency == null || can(regex("^[A-Z]{3}$", var.budget_currency))
    error_message = "budget_currency is a three-letter ISO 4217 code, such as GBP."
  }
}
