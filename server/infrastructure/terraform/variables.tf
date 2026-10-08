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
  description = "Create a Cloud Monitoring uptime check on GET /health."
  type        = bool
  default     = true
}

variable "alert_notification_channels" {
  description = "Cloud Monitoring notification channel ids that receive the uptime alert. Empty = check only, no alert policy."
  type        = list(string)
  default     = []
}
