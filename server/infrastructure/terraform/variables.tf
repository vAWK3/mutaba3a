variable "project_id" {
  description = "GCP project that hosts the Mutaba3a API (may be Malafat's or a dedicated project)."
  type        = string
}

variable "region" {
  description = "Region for every resource. Must match the connecting firm's CRM region (ADR-024: data residency)."
  type        = string
  default     = "me-west1"
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
  description = "Cloud SQL machine tier. The M1 control plane is tiny; db-g1-small is plenty until the ledger tables land."
  type        = string
  default     = "db-g1-small"
}

variable "db_availability" {
  description = "REGIONAL (HA) or ZONAL. Production runs REGIONAL."
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

variable "deletion_protection" {
  description = "Refuse `terraform destroy` on the Cloud SQL instance. Keep true in production."
  type        = bool
  default     = true
}

variable "min_instances" {
  description = "Cloud Run minimum instances. 1 avoids cold starts on the first Malafat request of the day."
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
  description = "Prisma connection pool per Cloud Run instance: connection_limit in the DATABASE_URL secret (MUT-270). GET /v1/entries runs 4 queries per profile in parallel."
  type        = number
  default     = 10
  validation {
    condition     = var.db_pool_size >= 1
    error_message = "db_pool_size must be at least 1."
  }
}

variable "db_max_connections" {
  description = "Cloud SQL max_connections flag, set explicitly (MUT-270). 50 is db-g1-small's own default; raise it with a bigger tier. Changing it restarts the instance."
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
  description = "Bare hostname the uptime checks probe (no scheme, path or port). Empty (default) = the Cloud Run service's own host. The custom domain (MUT-112) moves the checks with it."
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
