# MUT-535 (ADR-259, D12, D13): the monthly summary mail job exists only with mail on and the operator's switch, runs on
# days 1-7 at 14:00 Jerusalem with the job token, and passes MONTHLY_SUMMARY_DAILY_SENDS only when it isn't the API's
# default. Providers are mocked:
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

run "off_by_default_even_with_mail_on" {
  command = plan

  variables {
    mailer = "resend"
  }

  assert {
    condition     = length(google_cloud_scheduler_job.monthly_summary_mail) == 0
    error_message = "The monthly summary job waits for the operator's switch after a dry run (before-release.md)."
  }
}

run "on_with_mail_and_the_switch" {
  command = apply

  variables {
    mailer                       = "resend"
    monthly_summary_mail_enabled = true
  }

  assert {
    condition = (
      google_cloud_scheduler_job.monthly_summary_mail[0].schedule == "0 14 1-7 * *"
      && google_cloud_scheduler_job.monthly_summary_mail[0].time_zone == "Asia/Jerusalem"
      && google_cloud_scheduler_job.monthly_summary_mail[0].http_target[0].uri == "https://mutaba3a-api-test.a.run.example/jobs/v1/billing/monthly-summary-mail"
      && google_cloud_scheduler_job.monthly_summary_mail[0].http_target[0].headers["X-Job-Token"] == random_password.job_token.result
    )
    error_message = "The job posts to the monthly summary route with the job token, days 1-7 at 14:00 Jerusalem."
  }
}

run "never_without_mail" {
  command = plan

  variables {
    mailer                       = "noop"
    monthly_summary_mail_enabled = true
  }

  assert {
    condition     = length(google_cloud_scheduler_job.monthly_summary_mail) == 0
    error_message = "With no real mailer there is nothing to send."
  }
}
