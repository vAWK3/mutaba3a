# MUT-419 (ADR-182): the daily trial-reminder job exists only with mail, Stripe and the lapse gate all on, and calls
# /jobs/v1/billing/trial-mail with the job token at 10:00 Jerusalem time. Providers are mocked:
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

run "no_job_by_default" {
  command = plan

  assert {
    condition     = length(google_cloud_scheduler_job.trial_mail) == 0
    error_message = "With mail, Stripe and the gate at their defaults (mail off) there is no trial-mail job."
  }
}

run "no_job_without_stripe" {
  command = plan

  variables {
    mailer = "resend"
  }

  assert {
    condition     = length(google_cloud_scheduler_job.trial_mail) == 0
    error_message = "Without Stripe the mails' Subscribe links lead nowhere: no job."
  }
}

run "no_job_with_the_gate_off" {
  command = plan

  variables {
    mailer               = "resend"
    stripe_enabled       = true
    billing_gate_enabled = false
  }

  assert {
    condition     = length(google_cloud_scheduler_job.trial_mail) == 0
    error_message = "With the lapse gate off nothing goes read-only or locks, so there is nothing true to mail: no job."
  }
}

run "mail_stripe_and_gate_on_schedule_the_daily_job" {
  command = apply

  variables {
    mailer         = "resend"
    stripe_enabled = true
  }

  assert {
    condition = (
      google_cloud_scheduler_job.trial_mail[0].name == "mutaba3a-trial-mail"
      && google_cloud_scheduler_job.trial_mail[0].schedule == "0 10 * * *"
      && google_cloud_scheduler_job.trial_mail[0].time_zone == "Asia/Jerusalem"
      && google_cloud_scheduler_job.trial_mail[0].attempt_deadline == "280s"
    )
    error_message = "One daily job at 10:00 Jerusalem time, inside Cloud Run's request timeout."
  }

  assert {
    condition = (
      google_cloud_scheduler_job.trial_mail[0].http_target[0].uri == "https://mutaba3a-api-test.a.run.example/jobs/v1/billing/trial-mail"
      && google_cloud_scheduler_job.trial_mail[0].http_target[0].http_method == "POST"
      && google_cloud_scheduler_job.trial_mail[0].http_target[0].headers["X-Job-Token"] == random_password.job_token.result
    )
    error_message = "The job posts to the trial-mail route with the job token."
  }
}
