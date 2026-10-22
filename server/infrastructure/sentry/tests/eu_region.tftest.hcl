# MUT-147 (ADR-091, D5): an org created in the wrong region hands out ingest.us DSNs, and the
# sentry_key postcondition must stop the apply. Its own file, because runs in one file share
# state: once sentry.tftest.hcl has created the keys, an override no longer reaches them.

mock_provider "sentry" {
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
  organization              = "test-org"
  import_hand_made_projects = false
  portal_origins            = ["https://portal.example.test"]
  landing_origins           = ["https://landing.example.test"]
}

run "rejects_a_dsn_outside_the_eu_region" {
  command = apply

  override_resource {
    target = sentry_key.this
    values = {
      dsn = { public = "https://public@o0.ingest.us.sentry.io/0" }
    }
  }

  expect_failures = [sentry_key.this]
}
