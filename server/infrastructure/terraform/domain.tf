# MUT-326 (ADR-155): the custom domain, read from the one hosts config (config/hosts.json).
#
# The front door itself (Cloudflare zone, DNS, Worker, and the token secret) is its own
# stack, server/infrastructure/frontdoor, applied first. Once config/hosts.json names a
# domain, this stack only:
#   - reads the front-door token secret by name (plan fails loudly if the frontdoor stack
#     hasn't been applied yet), and lets the API's service account read it;
#   - gives Cloud Run PORTAL_ORIGIN and FRONT_DOOR_TOKEN (and PORTAL_LEGACY_REDIRECT at
#     stage "redirect").
# While the domain is null (today) nothing here exists and the plan is unchanged.
# config/hosts.ts derives the same values; both are tested against config/fixtures/.

variable "hosts_file" {
  description = "The hosts config, relative to this module (MUT-326). Tests point it at config/fixtures/."
  type        = string
  default     = "../../../config/hosts.json"
}

locals {
  # An environment the file doesn't name (e.g. staging today) has no custom domain.
  hosts_config = lookup(jsondecode(file("${path.module}/${var.hosts_file}")), var.environment, null)
  domain       = local.hosts_config == null ? null : local.hosts_config.domain
  domain_stage = local.hosts_config == null ? "legacy" : local.hosts_config.stage

  front_door_enabled       = local.domain != null
  front_door_portal_origin = local.front_door_enabled ? "https://${local.hosts_config.portalSubdomain}.${local.domain}" : null
  front_door_token_secret  = "mutaba3a-api-front-door-token${local.suffix}"

  # Plain env for Cloud Run; FRONT_DOOR_TOKEN comes from the secret (main.tf).
  front_door_env = merge(
    local.front_door_enabled ? { PORTAL_ORIGIN = local.front_door_portal_origin } : {},
    local.domain_stage == "redirect" ? { PORTAL_LEGACY_REDIRECT = "true" } : {},
  )

  # What users reach the portal on: the new host from stage live on, else the legacy one
  # (the service's own URL for an environment the file doesn't name). For MUT-328's uptime checks.
  public_portal_origin = (
    local.hosts_config == null ? google_cloud_run_v2_service.api.uri :
    contains(["live", "redirect"], local.domain_stage) ? local.front_door_portal_origin :
    local.hosts_config.legacy.portal
  )
  public_portal_host = trimprefix(local.public_portal_origin, "https://")
}

data "google_secret_manager_secret" "front_door_token" {
  count     = local.front_door_enabled ? 1 : 0
  project   = var.project_id
  secret_id = local.front_door_token_secret
}

resource "google_secret_manager_secret_iam_member" "api_reads_front_door_token" {
  count     = local.front_door_enabled ? 1 : 0
  project   = var.project_id
  secret_id = data.google_secret_manager_secret.front_door_token[0].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}
