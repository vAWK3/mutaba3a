variable "organization" {
  description = "Slug of the dedicated EU-region Sentry org (ADR-091, R3). Basel creates it by hand; Terraform never creates orgs."
  type        = string
}

variable "base_url" {
  description = "Sentry API base URL, `https://<host>/api/`. An EU-region org answers on de.sentry.io; if org-scoped calls plan cleanly through sentry.io instead, record which one in INFRA."
  type        = string
  default     = "https://de.sentry.io/api/"
}

variable "team_slug" {
  description = "Team that owns the four projects."
  type        = string
  default     = "mutaba3a"
}

variable "portal_origins" {
  description = "Origins the portal DSN accepts events from (R2): today the Cloud Run URL. Add the custom domain when MUT-112 ships."
  type        = list(string)
  validation {
    condition     = length(var.portal_origins) > 0 && alltrue([for origin in var.portal_origins : can(regex("^https://[a-z0-9.-]+$", origin))])
    error_message = "portal_origins must be one or more https origins with no path, never \"*\"."
  }
}

variable "landing_origins" {
  description = "Origins the landing DSN accepts events from (R2): today the Netlify origin. Add the custom domain when MUT-112 ships."
  type        = list(string)
  validation {
    condition     = length(var.landing_origins) > 0 && alltrue([for origin in var.landing_origins : can(regex("^https://[a-z0-9.-]+$", origin))])
    error_message = "landing_origins must be one or more https origins with no path, never \"*\"."
  }
}

variable "key_rate_limit_per_hour" {
  description = "Events per hour each project's DSN accepts. The free plan's monthly quota is the real cap; this stops one surface from using it all in an hour."
  type        = map(number)
  default = {
    api           = 120
    portal        = 60
    landing       = 60
    "capture-app" = 120
  }
  validation {
    condition     = toset(keys(var.key_rate_limit_per_hour)) == toset(["api", "portal", "landing", "capture-app"]) && alltrue([for limit in values(var.key_rate_limit_per_hour) : limit > 0])
    error_message = "key_rate_limit_per_hour needs a positive limit for exactly api, portal, landing and capture-app."
  }
}

variable "spike_threshold_per_hour" {
  description = "The spike alert fires when one issue gets more than this many events in an hour."
  type        = number
  default     = 50
}
