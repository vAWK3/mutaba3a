# MUT-147 (ADR-091, R8): the cost and abuse guards the eng review approved, checked offline.
# The Sentry provider is mocked, so this needs no token, account or network:
#   terraform init -backend=false && terraform test

mock_provider "sentry" {
  # A mocked map attribute comes back empty; outputs.tf reads dsn["public"].
  mock_resource "sentry_key" {
    defaults = {
      dsn = { public = "https://public@o0.ingest.de.sentry.io/0" }
    }
  }
  mock_data "sentry_project_error_monitor" {
    defaults = {
      id = "4512000000000001"
    }
  }
}

variables {
  organization = "test-org"
  # A mocked provider can't import; the real apply imports mutaba3a-web and mutaba3a-flutter.
  import_hand_made_projects = false
  # MUT-326: the origins come from the hosts config; this fixture's legacy hosts are portal/landing.example.test.
  hosts_file = "../../../config/fixtures/hosts.no-domain.json"
}

run "project_slugs_and_the_two_made_by_hand" {
  command = plan

  assert {
    condition = { for surface, project in local.surfaces : surface => project.slug } == {
      api = "mutaba3a-api", portal = "mutaba3a-web", landing = "mutaba3a-landing", "capture-app" = "mutaba3a-flutter"
    }
    error_message = "Each surface keeps its project slug; renaming one destroys that project's history and rotates its DSN."
  }

  assert {
    condition     = local.adopted_projects == { portal = "mutaba3a-web", "capture-app" = "mutaba3a-flutter" }
    error_message = "mutaba3a-web and mutaba3a-flutter were made by hand in Sentry and are imported, never created."
  }

  assert {
    condition     = alltrue([for project in local.surfaces : startswith(project.slug, "mutaba3a-")])
    error_message = "Every slug starts mutaba3a-: scripts/sentry-org-settings.ts refuses an org holding any other project (D16)."
  }
}

run "four_projects_each_with_one_key" {
  command = apply

  assert {
    condition     = toset(keys(sentry_project.this)) == toset(["api", "portal", "landing", "capture-app"])
    error_message = "Exactly the four reporting surfaces get a project; never the local app or desktop."
  }

  assert {
    condition     = alltrue([for project in sentry_project.this : project.default_key == false])
    error_message = "default_key must be false (R1): Sentry's automatic key has no rate limit."
  }

  assert {
    condition     = alltrue([for project in sentry_project.this : project.default_rules == false])
    error_message = "default_rules must be false: the alerts below are the only alert rules."
  }

  assert {
    condition     = toset(keys(sentry_key.this)) == toset(keys(sentry_project.this))
    error_message = "Every project has exactly one managed key."
  }
}

run "browser_dsns_accept_only_their_own_origins" {
  command = apply

  assert {
    condition     = sentry_project.this["portal"].client_security.allowed_domains == toset(["https://portal.example.test"])
    error_message = "The portal DSN accepts events only from the portal's origins (R2)."
  }

  assert {
    condition     = sentry_project.this["landing"].client_security.allowed_domains == toset(["https://landing.example.test"])
    error_message = "The landing DSN accepts events only from the landing's origins (R2)."
  }

  assert {
    condition = alltrue([
      for surface in ["api", "capture-app"] : sentry_project.this[surface].client_security.allowed_domains == toset(["*"])
    ])
    error_message = "The server and the phone send no browser Origin, so they accept any origin."
  }

  assert {
    condition = toset([for filter in sentry_project_inbound_data_filter.this : "${filter.project}/${filter.filter_id}"]) == toset([
      for pair in setproduct(["portal", "landing"], ["browser-extensions", "localhost", "web-crawlers"]) :
      "${sentry_project.this[pair[0]].id}/${pair[1]}"
    ])
    error_message = "Browser projects drop extension, localhost and crawler noise."
  }
}

run "spike_protection_covers_every_project" {
  command = apply

  assert {
    condition     = sentry_all_projects_spike_protection.this.enabled
    error_message = "Spike protection is on (R4)."
  }

  assert {
    condition     = sentry_all_projects_spike_protection.this.projects == toset([for project in sentry_project.this : project.id])
    error_message = "Spike protection covers all four projects."
  }
}

run "three_email_alerts_per_project" {
  command = apply

  assert {
    condition = alltrue([
      for alerts in [sentry_alert.new_issue, sentry_alert.regression, sentry_alert.spike] :
      toset(keys(alerts)) == toset(keys(sentry_project.this))
    ])
    error_message = "Each of the four projects has a new-issue, a regression and a spike alert."
  }

  assert {
    condition = alltrue([
      for surface, alert in merge(sentry_alert.new_issue, sentry_alert.regression, sentry_alert.spike) :
      alert.monitor_ids == toset([data.sentry_project_error_monitor.this[surface].id])
    ])
    error_message = "Every alert runs on its own project's default error monitor."
  }

  assert {
    condition = alltrue([
      for alert in concat(values(sentry_alert.new_issue), values(sentry_alert.regression), values(sentry_alert.spike)) :
      alert.action_filters[0].actions[0].email.target_type == "issue_owners" && alert.action_filters[0].actions[0].email.fallthrough_type == "AllMembers"
    ])
    error_message = "Every alert emails the issue owners, falling through to all members (Basel on a one-seat org)."
  }

  assert {
    condition = alltrue([for alert in sentry_alert.new_issue : alert.trigger_conditions[0].first_seen_event != null]) && alltrue([
      for alert in sentry_alert.regression : alert.trigger_conditions[0].regression_event != null
    ])
    error_message = "The new-issue alert triggers on a first-seen event, the regression alert on a regression."
  }

  assert {
    condition = alltrue([for alert in sentry_alert.spike :
      alert.action_filters[0].conditions[0].event_frequency_count.value == 10 && alert.action_filters[0].conditions[0].event_frequency_count.interval == "1h"
    ])
    error_message = "The spike alert fires above the default 10 events of one issue per hour."
  }
}

run "rejects_a_wildcard_browser_origin" {
  command = plan

  variables {
    portal_origins = ["*"]
  }

  expect_failures = [var.portal_origins]
}

run "rejects_a_wildcard_landing_origin" {
  command = plan

  variables {
    landing_origins = ["*"]
  }

  expect_failures = [var.landing_origins]
}

run "rejects_a_plain_http_origin" {
  command = plan

  variables {
    portal_origins = ["http://portal.example.test"]
  }

  expect_failures = [var.portal_origins]
}

run "rejects_an_origin_with_a_path" {
  command = plan

  variables {
    landing_origins = ["https://landing.example.test/path"]
  }

  expect_failures = [var.landing_origins]
}

# MUT-326: the tfvars lists are extras now; with none, each DSN still accepts the hosts config's
# origins, so neither ever ends up accepting nothing (or everything).
run "no_extras_still_allows_the_configured_origins" {
  command = plan

  variables {
    portal_origins  = []
    landing_origins = []
  }

  assert {
    condition     = sentry_project.this["portal"].client_security.allowed_domains == toset(["https://portal.example.test"])
    error_message = "With no extras the portal DSN accepts exactly the configured portal origin."
  }
}

run "rejects_a_non_positive_spike_threshold" {
  command = plan

  variables {
    spike_threshold_per_hour = 0
  }

  expect_failures = [var.spike_threshold_per_hour]
}

# MUT-326: once a domain is set in config/hosts.json, both DSNs accept the new origin and keep the legacy one.
run "a_chosen_domain_adds_its_origins_and_keeps_the_legacy_ones" {
  command = plan

  variables {
    hosts_file      = "../../../config/fixtures/hosts.placeholder.json"
    portal_origins  = ["https://extra.example.test"]
    landing_origins = []
  }

  assert {
    condition     = sentry_project.this["portal"].client_security.allowed_domains == toset(["https://app.placeholder.example", "https://portal.example.test", "https://extra.example.test"])
    error_message = "The portal DSN accepts the new portal origin, the legacy one and the tfvars extras."
  }

  assert {
    condition     = sentry_project.this["landing"].client_security.allowed_domains == toset(["https://placeholder.example", "https://landing.example.test"])
    error_message = "The landing DSN accepts the apex and the legacy landing origin."
  }
}
