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
}

variables {
  organization    = "test-org"
  portal_origins  = ["https://portal.example.test"]
  landing_origins = ["https://landing.example.test"]
}

run "four_projects_each_with_one_capped_key" {
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

  assert {
    condition     = alltrue([for key in sentry_key.this : key.rate_limit_window == 86400 && key.rate_limit_count > 0])
    error_message = "Every key is capped per day (D6)."
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
      for alerts in [sentry_issue_alert.new_issue, sentry_issue_alert.regression, sentry_issue_alert.spike] :
      toset(keys(alerts)) == toset(keys(sentry_project.this))
    ])
    error_message = "Each of the four projects has a new-issue, a regression and a spike alert."
  }

  assert {
    condition = alltrue([
      for alert in concat(values(sentry_issue_alert.new_issue), values(sentry_issue_alert.regression), values(sentry_issue_alert.spike)) :
      alert.actions_v2[0].notify_email.target_type == "IssueOwners" && alert.actions_v2[0].notify_email.fallthrough_type == "AllMembers"
    ])
    error_message = "Every alert emails the issue owners, falling through to all members (Basel on a one-seat org)."
  }

  assert {
    condition     = alltrue([for alert in sentry_issue_alert.spike : alert.conditions_v2[0].event_frequency.value == 10 && alert.conditions_v2[0].event_frequency.interval == "1h"])
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

run "rejects_an_empty_origin_list" {
  command = plan

  variables {
    portal_origins = []
  }

  expect_failures = [var.portal_origins]
}

run "rejects_a_zero_rate_limit" {
  command = plan

  variables {
    key_rate_limit_per_day = { api = 0, portal = 20, landing = 20, "capture-app" = 60 }
  }

  expect_failures = [var.key_rate_limit_per_day]
}

run "rejects_a_rate_limit_map_missing_a_surface" {
  command = plan

  variables {
    key_rate_limit_per_day = { api = 60 }
  }

  expect_failures = [var.key_rate_limit_per_day]
}

run "rejects_daily_caps_that_overrun_the_monthly_quota" {
  command = plan

  # D6: 200 a day x 31 days is more than the 5,000-event monthly quota.
  variables {
    key_rate_limit_per_day = { api = 100, portal = 20, landing = 20, "capture-app" = 60 }
  }

  expect_failures = [var.key_rate_limit_per_day]
}

run "rejects_a_spike_threshold_the_daily_caps_never_reach" {
  command = plan

  # Convergence review: portal and landing keys drop everything past 20 a day, so 50 an hour can never happen there.
  variables {
    spike_threshold_per_hour = 50
  }

  expect_failures = [var.spike_threshold_per_hour]
}
