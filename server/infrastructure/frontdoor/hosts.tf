# MUT-326 (ADR-155): everything here derives from config/hosts.json, the same way as
# config/hosts.ts (both tested against config/fixtures/). Nothing exists until the file
# names a domain; from stage "proxy" on, the front door is built.
locals {
  hosts_config = lookup(jsondecode(file("${path.module}/${var.hosts_file}")), var.environment, null)
  domain       = local.hosts_config == null ? null : local.hosts_config.domain
  enabled      = local.domain != null
  suffix       = var.environment == "production" ? "" : "-${var.environment}"

  portal_host     = local.enabled ? "${local.hosts_config.portalSubdomain}.${local.domain}" : null
  upstream_origin = local.enabled ? local.hosts_config.legacy.portal : null
  netlify_host    = local.enabled ? trimprefix(local.hosts_config.legacy.landing, "https://") : null

  # Same name the API stack reads (server/infrastructure/terraform/domain.tf).
  token_secret_id = "mutaba3a-api-front-door-token${local.suffix}"
  worker_name     = "mutaba3a-front-door${local.suffix}"

  # Full (strict) TLS to Cloud Run, HTTPS only. The browser check, email obfuscation and a
  # high security level would answer JSON clients, the phone and Apple's AASA fetcher with
  # an HTML challenge or a rewritten body: off.
  zone_settings = {
    ssl               = "strict"
    always_use_https  = "on"
    min_tls_version   = "1.2"
    browser_check     = "off"
    email_obfuscation = "off"
    security_level    = "low"
  }
}
