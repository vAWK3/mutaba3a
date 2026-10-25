# MUT-359 (ADR-159 §5, D1; Basel's MUT-359 comment 2026-10-21): the DNS records Resend gives for Mutaba3a's sending
# domain, in this stack because the zone is here. DNS only, never proxied. Nothing exists until the operator copies
# Resend's DKIM value into resend_dkim_value (DEPLOYMENT.md §6f), so merging changes no plan.
#
#   resend._domainkey.<mail>  TXT  the DKIM key Resend shows
#   send.<mail>               CNAME  send.forge.rmta.net                      the return path (Resend Forge)
#   rsend.<mail>              CNAME  rsend-<region code>.forge.rmta.net       the regional return path (Forge)
#   _dmarc.<apex>             TXT  v=DMARC1; p=none[; rua=mailto:<address>]   reporting only, for now
#
# <mail> is the Resend domain: <mailSubdomain>.<apex> from config/hosts.json (production: "notify", Basel 2026-10-25), or
# the apex without one. DMARC stays on the apex, where it also covers the mail subdomain. The apex keeps its own
# records: Resend's MX and SPF sit on `send.`. `npm --prefix server run email:check` reads
# them back. Basel turned Resend Forge on 2026-10-25: it replaced SES's MX + SPF on `send.` with the two CNAMEs, which
# Resend's dashboard lists as "SPF". A CNAME can't share its name, so the old MX + TXT go. DMARC moves to p=quarantine after 30 clean days (a later, deliberate change).

locals {
  # Forge's short region names, as its CNAME targets spell them. Only the region ADR-159 chose.
  forge_region_codes = { "eu-west-1" = "euw1" }
  email_dns_enabled  = local.enabled && var.resend_dkim_value != null
  email_dns = local.email_dns_enabled ? {
    dkim = {
      name     = "resend._domainkey.${local.mail_domain}"
      type     = "TXT"
      content  = var.resend_dkim_value
      priority = null
    }
    return_path = {
      name     = "send.${local.mail_domain}"
      type     = "CNAME"
      content  = "send.forge.rmta.net"
      priority = null
    }
    return_path_regional = {
      name     = "rsend.${local.mail_domain}"
      type     = "CNAME"
      content  = "rsend-${local.forge_region_codes[var.resend_sending_region]}.forge.rmta.net"
      priority = null
    }
    dmarc = {
      name     = "_dmarc.${local.domain}"
      type     = "TXT"
      content  = var.dmarc_report_address == null ? "v=DMARC1; p=none" : "v=DMARC1; p=none; rua=mailto:${var.dmarc_report_address}"
      priority = null
    }
  } : {}
}

resource "cloudflare_dns_record" "email" {
  for_each = local.email_dns
  zone_id  = cloudflare_zone.this[0].id
  name     = each.value.name
  type     = each.value.type
  content  = each.value.content
  priority = each.value.priority
  proxied  = false
  ttl      = 1
}
