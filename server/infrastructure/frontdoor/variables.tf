variable "project_id" {
  description = "GCP project the API runs in (the front-door token secret lives beside its other secrets)."
  type        = string
}

variable "region" {
  description = "Secret Manager replica location; the API stack's region."
  type        = string
  default     = "me-west1"
}

variable "environment" {
  description = "Which config/hosts.json environment to build the front door for."
  type        = string
  default     = "production"
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production."
  }
}

variable "hosts_file" {
  description = "The hosts config, relative to this module (MUT-326). Tests point it at config/fixtures/."
  type        = string
  default     = "../../../config/hosts.json"
}

variable "cloudflare_account_id" {
  description = "Cloudflare account that owns the zone and the Worker. Decide it on purpose: the Workers free tier (100,000 requests/day) is per account, shared with anything else on it (e.g. malafat-router)."
  type        = string
  default     = ""
}

variable "netlify_site_id" {
  description = "The Netlify site that serves the landing (Site settings > Site details > Site ID)."
  type        = string
  default     = ""
}

variable "worker_compatibility_date" {
  description = "Cloudflare Workers runtime version the front door is pinned to."
  type        = string
  default     = "2026-10-01"
}
