# MUT-571 AC3: the Tax Authority re-consent reminder job exists only with mail on and the operator's switch, and runs
# daily at 09:00 Jerusalem with the job token. Providers are mocked:
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
    condition     = length(google_cloud_scheduler_job.tax_authority_reminders) == 0
    error_message = "The reminder job waits for the operator's switch (before-release.md)."
  }
}

run "on_with_mail_and_the_switch" {
  command = apply

  variables {
    mailer                          = "resend"
    tax_authority_reminders_enabled = true
  }

  assert {
    condition = (
      google_cloud_scheduler_job.tax_authority_reminders[0].schedule == "0 9 * * *"
      && google_cloud_scheduler_job.tax_authority_reminders[0].time_zone == "Asia/Jerusalem"
      && google_cloud_scheduler_job.tax_authority_reminders[0].http_target[0].uri == "https://mutaba3a-api-test.a.run.example/jobs/v1/issuing/tax-authority-reminders"
      && google_cloud_scheduler_job.tax_authority_reminders[0].http_target[0].headers["X-Job-Token"] == random_password.job_token.result
    )
    error_message = "The job posts to the reminder route with the job token, daily at 09:00 Jerusalem."
  }
}

run "never_without_mail" {
  command = plan

  variables {
    mailer                          = "noop"
    tax_authority_reminders_enabled = true
  }

  assert {
    condition     = length(google_cloud_scheduler_job.tax_authority_reminders) == 0
    error_message = "With no real mailer there is nothing to send."
  }
}
