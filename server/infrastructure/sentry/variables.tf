variable "organization" {
  description = "Slug of the EU-region Sentry org, `barmajiyat-ltd` (ADR-091 amendment 5). Basel creates it by hand; Terraform never creates orgs."
  type        = string
}

variable "base_url" {
  description = "Sentry API base URL, `https://<host>/api/`. The EU-region org answers on de.sentry.io. Never switch to sentry.io to get past an error: that would hide an org created in the US (D5). The sentry_key postcondition is the second guard."
  type        = string
  default     = "https://de.sentry.io/api/"
}

variable "import_hand_made_projects" {
  description = "Imports mutaba3a-web and mutaba3a-flutter, which Basel created in Sentry's UI, instead of creating them. Leave true; only the offline tests set it false, because a mocked provider can't import."
  type        = bool
  default     = true
}

variable "team_slug" {
  description = "Team that owns the four projects."
  type        = string
  default     = "mutaba3a"
}

variable "hosts_file" {
  description = "MUT-326: the one hosts config, relative to this module. The portal and landing DSNs accept its origins, new and legacy, so the domain move needs no edit here."
  type        = string
  default     = "../../../config/hosts.json"
}

variable "portal_origins" {
  description = "Extra origins the portal DSN accepts events from (R2), beyond the ones config/hosts.json names (e.g. the project-number run.app URL if anyone uses it)."
  type        = list(string)
  default     = []
  validation {
    condition     = alltrue([for origin in var.portal_origins : can(regex("^https://[a-z0-9.-]+$", origin))])
    error_message = "portal_origins must be https origins with no path, never \"*\"."
  }
}

variable "landing_origins" {
  description = "Extra origins the landing DSN accepts events from (R2), beyond the ones config/hosts.json names."
  type        = list(string)
  default     = []
  validation {
    condition     = alltrue([for origin in var.landing_origins : can(regex("^https://[a-z0-9.-]+$", origin))])
    error_message = "landing_origins must be https origins with no path, never \"*\"."
  }
}

variable "spike_threshold_per_hour" {
  description = "The spike alert fires when one issue gets more than this many events in an hour."
  type        = number
  default     = 10
  validation {
    condition     = var.spike_threshold_per_hour > 0
    error_message = "spike_threshold_per_hour must be positive."
  }
}
