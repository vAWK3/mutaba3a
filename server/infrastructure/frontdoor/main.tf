# The custom domain's front door (MUT-326, ADR-155; MUT-112 applies it):
#
#   <apex>, www.<apex>  ──DNS only──▶  Netlify (landing; Netlify issues the certificate)
#   <portal>.<apex>     ──proxied──▶   Worker front-door.js ──▶ Cloud Run (legacy run.app origin)
#
# Applied by the operator (server/DEPLOYMENT.md §5a), never by deploy.sh. Every resource is
# new, so the first plan only adds. The zone and the token secret refuse to be destroyed:
# clearing the domain by mistake would hand out new nameservers and break Cloud Run's
# FRONT_DOOR_TOKEN on its next cold start (rollback order: §5a).

check "domain_is_configured" {
  assert {
    condition     = !local.enabled || (var.cloudflare_account_id != "" && var.netlify_site_id != "")
    error_message = "config/hosts.json names a domain: set cloudflare_account_id and netlify_site_id in ${var.environment}.tfvars."
  }
}

# ---------------------------------------------------------------------------
# The token the Worker proves itself with; Cloud Run reads the same secret.
# ---------------------------------------------------------------------------

resource "random_password" "front_door_token" {
  count   = local.enabled ? 1 : 0
  length  = 48
  special = false
}

resource "google_secret_manager_secret" "front_door_token" {
  count     = local.enabled ? 1 : 0
  project   = var.project_id
  secret_id = local.token_secret_id

  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_secret_manager_secret_version" "front_door_token" {
  count       = local.enabled ? 1 : 0
  secret      = google_secret_manager_secret.front_door_token[0].id
  secret_data = random_password.front_door_token[0].result
}

# ---------------------------------------------------------------------------
# DNS and TLS (Cloudflare). If the domain was bought at Cloudflare Registrar the zone
# already exists: `terraform import 'cloudflare_zone.this[0]' <zone-id>` first (§5a).
# The apex record stays DNS-only with no Worker route or redirect rule: it serves the Malafat
# OAuth client document (MUT-387; see netlify_site_domain_settings below).
# ---------------------------------------------------------------------------

resource "cloudflare_zone" "this" {
  count   = local.enabled ? 1 : 0
  account = { id = var.cloudflare_account_id }
  name    = local.domain
  type    = "full"

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_zone_setting" "this" {
  for_each   = local.enabled ? local.zone_settings : {}
  zone_id    = cloudflare_zone.this[0].id
  setting_id = each.key
  value      = each.value
}

# Netlify's documented apex target (flattened CNAME), DNS only so Netlify can issue its certificate.
resource "cloudflare_dns_record" "apex" {
  count   = local.enabled ? 1 : 0
  zone_id = cloudflare_zone.this[0].id
  name    = local.domain
  type    = "CNAME"
  content = "apex-loadbalancer.netlify.com"
  proxied = false
  ttl     = 1
}

resource "cloudflare_dns_record" "www" {
  count   = local.enabled ? 1 : 0
  zone_id = cloudflare_zone.this[0].id
  name    = "www.${local.domain}"
  type    = "CNAME"
  content = local.netlify_host
  proxied = false
  ttl     = 1
}

# The portal host exists only for the Worker route: a proxied placeholder address.
resource "cloudflare_dns_record" "portal" {
  count   = local.enabled ? 1 : 0
  zone_id = cloudflare_zone.this[0].id
  name    = local.portal_host
  type    = "AAAA"
  content = "100::"
  proxied = true
  ttl     = 1
}

# ---------------------------------------------------------------------------
# The Worker in front of Cloud Run.
# ---------------------------------------------------------------------------

resource "cloudflare_workers_script" "front_door" {
  count              = local.enabled ? 1 : 0
  account_id         = var.cloudflare_account_id
  script_name        = local.worker_name
  content            = file("${path.module}/worker/front-door.js")
  main_module        = "front-door.js"
  compatibility_date = var.worker_compatibility_date

  bindings = [
    { name = "UPSTREAM_ORIGIN", type = "plain_text", text = local.upstream_origin },
    { name = "FRONT_DOOR_TOKEN", type = "secret_text", text = random_password.front_door_token[0].result },
  ]
}

resource "cloudflare_workers_route" "portal" {
  count   = local.enabled ? 1 : 0
  zone_id = cloudflare_zone.this[0].id
  pattern = "${local.portal_host}/*"
  script  = cloudflare_workers_script.front_door[0].script_name
}

# ---------------------------------------------------------------------------
# The landing's custom domain (Netlify). netlify.app keeps answering beside it.
# The apex must stay the PRIMARY domain: it serves the Malafat OAuth client document
# (src/services/oauth/oauth-client.ts, MUT-387), a fixed URL Malafat refuses behind any 3xx.
# Making www primary 301s the apex; changing the domain unbinds the old one. See §5a.
# ---------------------------------------------------------------------------

resource "netlify_site_domain_settings" "landing" {
  count          = local.enabled ? 1 : 0
  site_id        = var.netlify_site_id
  custom_domain  = local.domain
  domain_aliases = ["www.${local.domain}"]
}
