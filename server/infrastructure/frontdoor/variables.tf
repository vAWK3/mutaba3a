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

variable "resend_dkim_value" {
  description = "MUT-359: the DKIM TXT value Resend shows for the sending domain (\"p=MIGfMA0…\"). null (default) = no email records; set it once the domain is added in Resend (DEPLOYMENT.md §6f)."
  type        = string
  default     = null
  validation {
    condition     = var.resend_dkim_value == null || can(regex("^p=[A-Za-z0-9+/=]+$", var.resend_dkim_value))
    error_message = "resend_dkim_value must be the bare DKIM value Resend shows, starting with p=."
  }
}

variable "resend_sending_region" {
  description = "MUT-359 (ADR-159 §5): the Resend sending region; Forge's regional return-path CNAME follows it. eu-west-1, as ADR-159 decided."
  type        = string
  default     = "eu-west-1"
}

variable "dmarc_report_address" {
  description = "MUT-359 (D23): where DMARC aggregate reports go (rua). null (default) = no reports. An address off the apex needs that domain to authorize ours (an _report._dmarc record there)."
  type        = string
  default     = null
}
