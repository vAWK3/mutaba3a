# MUT-333 (ADR-188, D11): the hourly hard delete of closed accounts always exists (no switch: the privacy policy's 30
# days are a promise), and calls /jobs/v1/accounts/purge with the job token at minute 15. Providers are mocked:
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
mock_provider "google-beta" {}
mock_provider "random" {}

variables {
  project_id     = "test-project"
  image_tag      = "test"
  hosts_file     = "../../../config/fixtures/hosts.placeholder.json"
  mail_reply_to  = "help@example.com"
  mail_daily_cap = 90
}

run "job_exists_with_every_switch_at_its_default" {
  command = apply

  assert {
    condition     = google_cloud_scheduler_job.account_purge.schedule == "15 * * * *"
    error_message = "The account purge runs hourly at minute 15, whatever mail, Stripe or the gate are set to."
  }

  assert {
    condition = (
      google_cloud_scheduler_job.account_purge.http_target[0].uri == "https://mutaba3a-api-test.a.run.example/jobs/v1/accounts/purge"
      && google_cloud_scheduler_job.account_purge.http_target[0].http_method == "POST"
      && google_cloud_scheduler_job.account_purge.http_target[0].headers["X-Job-Token"] == random_password.job_token.result
      && google_cloud_scheduler_job.account_purge.attempt_deadline == "280s"
    )
    error_message = "The job posts to the purge route with the job token, inside Cloud Run's request timeout."
  }
}

run "job_exists_with_stripe_and_the_gate_off" {
  command = plan

  variables {
    stripe_enabled       = false
    billing_gate_enabled = false
  }

  assert {
    condition     = google_cloud_scheduler_job.account_purge.name == "mutaba3a-account-purge"
    error_message = "Closing accounts doesn't depend on Stripe or the lapse gate: the job is always there."
  }
}
