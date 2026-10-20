# Mutaba3a error reporting (ADR-091, epic MUT-146): one Sentry project per
# reporting surface in the dedicated EU org, each with one rate-limited DSN,
# spike protection and three email alerts. The org itself, billing (pay-as-you-go
# budget $0) and the org privacy settings are not in the provider; see
# server/DEPLOYMENT.md §1.5 and scripts/sentry-org-settings.ts.
#
# The local web app and desktop never report (ADR-024, ADR-090): they have no
# project here.

# The keys below are stable identifiers: renaming or removing one destroys that
# project's issue history and rotates its DSN. The capture-app DSN is compiled into
# store binaries, so rotating it silences every shipped phone version until users
# update; ship a phone release with the new DSN first. (No prevent_destroy: the
# offline `terraform test` creates and destroys mocked resources.)
# MUT-326: the browser DSNs accept every origin config/hosts.json names for production, new and legacy
# (the same derivation as config/hosts.ts), plus any extras from tfvars.
locals {
  hosts  = jsondecode(file("${path.module}/${var.hosts_file}"))["production"]
  domain = local.hosts.domain

  portal_origins  = distinct(concat(local.domain == null ? [] : ["https://${local.hosts.portalSubdomain}.${local.domain}"], [local.hosts.legacy.portal], var.portal_origins))
  landing_origins = distinct(concat(local.domain == null ? [] : ["https://${local.domain}"], [local.hosts.legacy.landing], var.landing_origins))
}

locals {
  surfaces = {
    api           = { platform = "node", allowed_domains = ["*"], browser = false }
    portal        = { platform = "javascript-react", allowed_domains = local.portal_origins, browser = true }
    landing       = { platform = "javascript-react", allowed_domains = local.landing_origins, browser = true }
    "capture-app" = { platform = "flutter", allowed_domains = ["*"], browser = false }
  }

  browser_filters = ["browser-extensions", "localhost", "web-crawlers"]
  browser_filter_pairs = {
    for pair in setproduct([for name, surface in local.surfaces : name if surface.browser], local.browser_filters) :
    "${pair[0]}/${pair[1]}" => { surface = pair[0], filter_id = pair[1] }
  }
}

resource "sentry_team" "mutaba3a" {
  organization = var.organization
  name         = "Mutaba3a"
  slug         = var.team_slug
}

resource "sentry_project" "this" {
  for_each = local.surfaces

  organization = var.organization
  teams        = [sentry_team.mutaba3a.slug]
  name         = "mutaba3a-${each.key}"
  slug         = "mutaba3a-${each.key}"
  platform     = each.value.platform

  # R1: Sentry's automatic key has no rate limit; sentry_key below is the only DSN.
  # Only takes effect at creation, so it must be here before the first apply.
  default_key = false
  # The alerts below are the only alert rules.
  default_rules = false

  # R2: a browser DSN is public, so it only accepts events from our own origins.
  client_security = {
    allowed_domains = each.value.allowed_domains
  }
}

resource "sentry_key" "this" {
  for_each = local.surfaces

  organization      = var.organization
  project           = sentry_project.this[each.key].id
  name              = "mutaba3a-${each.key}"
  rate_limit_window = 86400
  rate_limit_count  = var.key_rate_limit_per_day[each.key]

  lifecycle {
    # D5: reports must land in Sentry's EU region (ADR-091). A US-region org hands out
    # ingest.us DSNs, so an org created in the wrong region stops here.
    postcondition {
      condition     = strcontains(nonsensitive(self.dsn["public"]), ".ingest.de.sentry.io/")
      error_message = "The DSN does not point at Sentry's EU ingest host (.ingest.de.sentry.io): the org is not in the EU region. Stop and check the org's data region."
    }
  }
}

resource "sentry_project_inbound_data_filter" "this" {
  for_each = local.browser_filter_pairs

  organization = var.organization
  project      = sentry_project.this[each.value.surface].id
  filter_id    = each.value.filter_id
  active       = true
}

# R4: one crash loop can't use up the month's free quota.
resource "sentry_all_projects_spike_protection" "this" {
  organization = var.organization
  projects     = [for project in sentry_project.this : project.id]
  enabled      = true
}

# Three alerts per project, emailed to the issue owners and falling through to
# all members, which is Basel on a one-seat org. `frequency` is the minutes
# between repeat emails for the same issue. sentry_issue_alert is deprecated in
# favour of sentry_alert, which needs workflow monitor ids per project;
# TECH_DEBT records the move.
locals {
  alert_email = [{ notify_email = { target_type = "IssueOwners", fallthrough_type = "AllMembers" } }]
}

resource "sentry_issue_alert" "new_issue" {
  for_each = local.surfaces

  organization  = var.organization
  project       = sentry_project.this[each.key].id
  name          = "New issue: mutaba3a-${each.key}"
  action_match  = "any"
  frequency     = 30
  conditions_v2 = [{ first_seen_event = {} }]
  actions_v2    = local.alert_email
}

resource "sentry_issue_alert" "regression" {
  for_each = local.surfaces

  organization  = var.organization
  project       = sentry_project.this[each.key].id
  name          = "Regression: mutaba3a-${each.key}"
  action_match  = "any"
  frequency     = 30
  conditions_v2 = [{ regression_event = {} }]
  actions_v2    = local.alert_email
}

resource "sentry_issue_alert" "spike" {
  for_each = local.surfaces

  organization = var.organization
  project      = sentry_project.this[each.key].id
  name         = "Spike: mutaba3a-${each.key}"
  action_match = "any"
  frequency    = 60
  conditions_v2 = [{
    event_frequency = { comparison_type = "count", value = var.spike_threshold_per_hour, interval = "1h" }
  }]
  actions_v2 = local.alert_email
}
