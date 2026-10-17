variable "organization" {
  description = "Slug of the dedicated EU-region Sentry org (ADR-091, R3). Basel creates it by hand; Terraform never creates orgs."
  type        = string
}

variable "base_url" {
  description = "Sentry API base URL, `https://<host>/api/`. The EU-region org answers on de.sentry.io. Never switch to sentry.io to get past an error: that would hide an org created in the US (D5). The sentry_key postcondition is the second guard."
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

variable "monthly_event_quota" {
  description = "Error events the org's plan includes per month (Developer plan: about 5,000; check at signup). With a $0 pay-as-you-go budget, events past it are dropped for every surface."
  type        = number
  default     = 5000
}

variable "key_rate_limit_per_day" {
  description = "Events per day each project's DSN accepts (D6). The caps add up to no more than the monthly quota over 31 days, so a public DSN (landing, portal, the phone's) abused or stuck in a crash loop can't use up the shared quota and blind the API for the month. A surface that hits its cap drops the rest of that day's events."
  type        = map(number)
  default = {
    api           = 60
    portal        = 20
    landing       = 20
    "capture-app" = 60
  }
  validation {
    condition     = toset(keys(var.key_rate_limit_per_day)) == toset(["api", "portal", "landing", "capture-app"]) && alltrue([for limit in values(var.key_rate_limit_per_day) : limit > 0])
    error_message = "key_rate_limit_per_day needs a positive limit for exactly api, portal, landing and capture-app."
  }
  validation {
    condition     = sum(values(var.key_rate_limit_per_day)) * 31 <= var.monthly_event_quota
    error_message = "The daily caps over 31 days must fit within monthly_event_quota, or one surface can exhaust the quota for all."
  }
}

variable "spike_threshold_per_hour" {
  description = "The spike alert fires when one issue gets more than this many events in an hour. It must sit below the smallest daily key cap: a key drops everything past its cap, so a higher threshold could never be reached and the alert would never fire."
  type        = number
  default     = 10
  validation {
    condition     = var.spike_threshold_per_hour > 0 && var.spike_threshold_per_hour < min(values(var.key_rate_limit_per_day)...)
    error_message = "spike_threshold_per_hour must be positive and below the smallest key_rate_limit_per_day, or the spike alert can never fire."
  }
}
