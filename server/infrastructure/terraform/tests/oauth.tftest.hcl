# MUT-434 (ADR-197): OAuth for MCP agents ships dark. oauth_enabled = false (default) mounts no OAUTH_DERIVE_KEY and
# creates no cleanup job; true mounts the generated key and schedules /jobs/v1/oauth/cleanup nightly with the job token.
# Providers are mocked:
#   terraform init -backend=false && terraform test

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

run "off_by_default" {
  command = plan

  assert {
    condition     = length(google_cloud_scheduler_job.oauth_cleanup) == 0
    error_message = "No OAuth cleanup job until oauth_enabled."
  }

  assert {
    condition     = !contains([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.name], "OAUTH_DERIVE_KEY")
    error_message = "OAUTH_DERIVE_KEY is not mounted until oauth_enabled, so OAuth answers 503."
  }

  assert {
    condition     = google_secret_manager_secret.oauth_derive_key.secret_id == "mutaba3a-api-oauth-derive-key"
    error_message = "The key's secret exists (generated) either way, so turning OAuth on needs no manual step."
  }
}

run "on_mounts_the_key_and_schedules_cleanup" {
  command = apply

  variables {
    oauth_enabled = true
  }

  assert {
    condition     = contains([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.name], "OAUTH_DERIVE_KEY")
    error_message = "oauth_enabled mounts OAUTH_DERIVE_KEY."
  }

  assert {
    condition = (
      google_cloud_scheduler_job.oauth_cleanup[0].schedule == "40 3 * * *"
      && google_cloud_scheduler_job.oauth_cleanup[0].http_target[0].uri == "https://mutaba3a-api-test.a.run.example/jobs/v1/oauth/cleanup"
      && google_cloud_scheduler_job.oauth_cleanup[0].http_target[0].headers["X-Job-Token"] == random_password.job_token.result
    )
    error_message = "The cleanup job posts nightly to /jobs/v1/oauth/cleanup with the job token."
  }
}
