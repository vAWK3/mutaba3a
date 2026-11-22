# MUT-710 (ADR-274): authentication events kept 12 months, encrypted at rest (SHAAM security appendix §19), and the key
# that seals two-step sign-in secrets. Providers are mocked:
#   terraform init -backend=false && terraform test -filter=tests/auth_log.tftest.hcl

mock_provider "google" {
  mock_resource "google_service_account" {
    defaults = {
      name  = "projects/test-project/serviceAccounts/mutaba3a-api@test-project.iam.gserviceaccount.com"
      email = "mutaba3a-api@test-project.iam.gserviceaccount.com"
    }
  }
  mock_resource "google_cloud_run_v2_service" {
    defaults = {
      uri = "https://mutaba3a-api-test.a.run.example"
    }
  }
}
mock_provider "random" {}

variables {
  project_id     = "test-project"
  region         = "europe-west1"
  image_tag      = "test"
  hosts_file     = "../../../config/fixtures/hosts.placeholder.json"
  mail_reply_to  = "help@example.com"
  mail_daily_cap = 90
}

run "auth_events_kept_365_days_in_region" {
  command = plan

  assert {
    condition     = google_logging_project_bucket_config.auth_events.retention_days == 365
    error_message = "Authentication events are kept 12 months (appendix §19)."
  }

  assert {
    condition     = google_logging_project_bucket_config.auth_events.location == "europe-west1"
    error_message = "The bucket lives in the project's region (ADR-024 as amended by ADR-232: data residency follows the region)."
  }

  assert {
    condition     = google_logging_project_bucket_config.auth_events.bucket_id == "auth-events"
    error_message = "Production's bucket is auth-events."
  }

  assert {
    condition     = google_logging_project_bucket_config.auth_events.locked == false
    error_message = "Locking is irreversible, so it stays an operator step (auth_log_bucket_locked)."
  }
}

run "sink_routes_only_the_apis_auth_events" {
  command = plan

  assert {
    condition     = google_logging_project_sink.auth_events.destination == "logging.googleapis.com/projects/test-project/locations/europe-west1/buckets/auth-events"
    error_message = "The sink writes into the 12-month bucket."
  }

  assert {
    condition     = strcontains(google_logging_project_sink.auth_events.filter, "jsonPayload.event=\"auth_event\"")
    error_message = "Only auth_event lines are routed."
  }

  assert {
    condition     = strcontains(google_logging_project_sink.auth_events.filter, "resource.labels.service_name=\"mutaba3a-api\"")
    error_message = "Only the API service's lines are routed."
  }

  assert {
    condition     = strcontains(google_logging_project_sink.auth_events.filter, "logName=\"projects/test-project/logs/run.googleapis.com%2Fstdout\"")
    error_message = "Pinned to the service's stdout, so another writer can't add lines to the record."
  }

  assert {
    condition     = strcontains(google_logging_project_sink.auth_events.filter, "resource.type=\"cloud_run_revision\"")
    error_message = "Pinned to Cloud Run revisions."
  }
}

run "lock_is_a_switch" {
  command = plan

  variables {
    auth_log_bucket_locked = true
  }

  assert {
    condition     = google_logging_project_bucket_config.auth_events.locked == true
    error_message = "auth_log_bucket_locked locks the bucket."
  }
}

run "staging_names_its_own_bucket" {
  command = plan

  variables {
    environment = "staging"
  }

  assert {
    condition     = google_logging_project_bucket_config.auth_events.bucket_id == "auth-events-staging"
    error_message = "A non-production environment gets its own bucket."
  }

  assert {
    condition     = strcontains(google_logging_project_sink.auth_events.filter, "resource.labels.service_name=\"mutaba3a-api-staging\"")
    error_message = "A non-production sink reads its own service."
  }
}

run "two_factor_seal_key_is_generated_and_mounted" {
  command = plan

  assert {
    condition     = google_secret_manager_secret.two_factor_seal_key.secret_id == "mutaba3a-api-two-factor-seal-key"
    error_message = "The seal key lives in Secret Manager."
  }

  assert {
    condition     = contains([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.name], "TWO_FACTOR_SEAL_KEY")
    error_message = "TWO_FACTOR_SEAL_KEY is always mounted: production refuses to start without it."
  }
}
