# MUT-767 (ADR-300): the daily unclaimed-sweep job exists only with accountant_provisioning, and posts to the sweep
# route daily at 10:00 Jerusalem with the job token, paused with the other jobs. Providers are mocked:
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
  project_id = "test-project"
  region     = "europe-west1"
  image_tag  = "test"
  hosts_file = "../../../config/fixtures/hosts.no-domain.json"
}

run "no_job_while_the_switch_is_off" {
  command = plan

  assert {
    condition     = length(google_cloud_scheduler_job.accountant_unclaimed_sweep) == 0
    error_message = "With accountant_provisioning off there is no sweep job (the route answers 404)."
  }
}

run "daily_job_with_the_switch" {
  command = apply

  variables {
    accountant_provisioning = true
  }

  assert {
    condition = (
      google_cloud_scheduler_job.accountant_unclaimed_sweep[0].schedule == "0 10 * * *"
      && google_cloud_scheduler_job.accountant_unclaimed_sweep[0].time_zone == "Asia/Jerusalem"
      && google_cloud_scheduler_job.accountant_unclaimed_sweep[0].http_target[0].http_method == "POST"
      && google_cloud_scheduler_job.accountant_unclaimed_sweep[0].http_target[0].uri == "https://mutaba3a-api-test.a.run.example/jobs/v1/accountants/unclaimed-sweep"
      && google_cloud_scheduler_job.accountant_unclaimed_sweep[0].http_target[0].headers["X-Job-Token"] == random_password.job_token.result
    )
    error_message = "The job posts to the sweep route with the job token, daily at 10:00 Jerusalem."
  }
  assert {
    condition     = google_cloud_scheduler_job.accountant_unclaimed_sweep[0].name == "mutaba3a-accountant-unclaimed-sweep"
    error_message = "Production's job is named without a suffix."
  }
}

run "paused_with_the_other_jobs" {
  command = apply

  variables {
    accountant_provisioning = true
    scheduler_paused        = true
  }

  assert {
    condition     = google_cloud_scheduler_job.accountant_unclaimed_sweep[0].paused && google_cloud_scheduler_job.account_purge.paused
    error_message = "scheduler_paused pauses the sweep with the account purge it relies on."
  }
}
