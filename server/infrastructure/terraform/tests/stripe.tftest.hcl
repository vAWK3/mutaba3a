# MUT-360: the Stripe secrets, the job token, the nightly reconcile job and its alerts, checked offline.
# stripe_enabled is off by default, so merging changes nothing in production but the job token.
# The Google, Google beta and random providers are mocked, so this needs no credentials, project or network:
#   terraform init -backend=false && terraform test

mock_provider "google" {
  # A mocked string is random; IAM bindings validate the service account's name and email format.
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

run "off_by_default_mounts_the_job_token_but_no_stripe_and_no_job" {
  command = apply

  assert {
    condition     = var.stripe_enabled == false
    error_message = "stripe_enabled must default to false, so merging MUT-360 turns nothing on in production."
  }

  assert {
    condition     = length(google_cloud_scheduler_job.stripe_reconcile) == 0
    error_message = "With stripe_enabled off there is no reconcile job."
  }

  assert {
    condition     = length([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e if contains(["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"], e.name)]) == 0
    error_message = "With stripe_enabled off Cloud Run gets no Stripe env: the secrets may still be empty, and an empty secret stops the revision starting."
  }

  assert {
    condition     = one([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value_source[0].secret_key_ref[0].secret if e.name == "MUTABA3A_JOB_TOKEN"]) == "mutaba3a-api-job-token"
    error_message = "MUTABA3A_JOB_TOKEN is always mounted, from the job token secret."
  }

  assert {
    condition     = one([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value_source[0].secret_key_ref[0].version if e.name == "MUTABA3A_JOB_TOKEN"]) == "latest"
    error_message = "MUTABA3A_JOB_TOKEN reads the secret's latest version, so a rotation reaches the next revision."
  }

  assert {
    condition = (
      google_secret_manager_secret_version.job_token.secret_data == random_password.job_token.result
      && random_password.job_token.length == 64
      && random_password.job_token.special == false
    )
    error_message = "The job token is a 64-character Terraform-generated password, stored as the secret's version."
  }

  assert {
    condition = (
      google_secret_manager_secret.stripe_secret_key.secret_id == "mutaba3a-api-stripe-secret-key"
      && google_secret_manager_secret.stripe_webhook_secret.secret_id == "mutaba3a-api-stripe-webhook-secret"
    )
    error_message = "The Stripe secrets exist with the flag off, so Basel can add their versions before turning it on."
  }

  assert {
    condition = (
      google_secret_manager_secret_iam_member.api_reads_stripe_secret_key.secret_id == "mutaba3a-api-stripe-secret-key"
      && google_secret_manager_secret_iam_member.api_reads_stripe_webhook_secret.secret_id == "mutaba3a-api-stripe-webhook-secret"
      && google_secret_manager_secret_iam_member.api_reads_job_token.secret_id == "mutaba3a-api-job-token"
      && google_secret_manager_secret_iam_member.api_reads_stripe_secret_key.role == "roles/secretmanager.secretAccessor"
      && google_secret_manager_secret_iam_member.api_reads_stripe_webhook_secret.role == "roles/secretmanager.secretAccessor"
      && google_secret_manager_secret_iam_member.api_reads_job_token.role == "roles/secretmanager.secretAccessor"
      && google_secret_manager_secret_iam_member.api_reads_job_token.member == "serviceAccount:mutaba3a-api@test-project.iam.gserviceaccount.com"
    )
    error_message = "The API's service account may read all three new secrets."
  }

  assert {
    condition     = contains(keys(google_project_service.apis), "cloudscheduler.googleapis.com")
    error_message = "The Cloud Scheduler API is enabled."
  }
}

run "off_creates_no_stripe_alerts_even_with_a_channel" {
  command = apply

  variables {
    alert_email = "ops@example.com"
  }

  assert {
    condition     = length(google_monitoring_alert_policy.stripe) == 0
    error_message = "With stripe_enabled off there is nothing to watch, so no Stripe alert policy."
  }
}

run "stripe_enabled_mounts_both_secrets_and_schedules_the_reconcile" {
  command = apply

  variables {
    stripe_enabled = true
  }

  assert {
    condition     = length(google_cloud_scheduler_job.stripe_reconcile) == 1
    error_message = "stripe_enabled creates exactly one reconcile job."
  }

  assert {
    condition = (
      google_cloud_scheduler_job.stripe_reconcile[0].http_target[0].uri == "https://mutaba3a-api-test.a.run.example/jobs/v1/billing/stripe-reconcile"
      && endswith(google_cloud_scheduler_job.stripe_reconcile[0].http_target[0].uri, "/jobs/v1/billing/stripe-reconcile")
      && google_cloud_scheduler_job.stripe_reconcile[0].http_target[0].http_method == "POST"
    )
    error_message = "The job POSTs to the service's /jobs/v1/billing/stripe-reconcile."
  }

  assert {
    condition = (
      google_cloud_scheduler_job.stripe_reconcile[0].http_target[0].headers["X-Job-Token"] == random_password.job_token.result
      && google_cloud_scheduler_job.stripe_reconcile[0].http_target[0].headers["X-Job-Token"] == google_secret_manager_secret_version.job_token.secret_data
    )
    error_message = "The job sends the same token the service reads from its secret."
  }

  assert {
    condition = (
      google_cloud_scheduler_job.stripe_reconcile[0].name == "mutaba3a-stripe-reconcile"
      && google_cloud_scheduler_job.stripe_reconcile[0].region == "europe-west1"
      && google_cloud_scheduler_job.stripe_reconcile[0].schedule == "30 3 * * *"
      && google_cloud_scheduler_job.stripe_reconcile[0].time_zone == "Asia/Jerusalem"
      && google_cloud_scheduler_job.stripe_reconcile[0].attempt_deadline == "280s"
      && google_cloud_scheduler_job.stripe_reconcile[0].retry_config[0].retry_count == 3
    )
    error_message = "The reconcile runs nightly at 03:30 Israel time, gets 280 s (under Cloud Run's 300 s request timeout), and retries 3 times."
  }

  assert {
    condition     = one([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value_source[0].secret_key_ref[0].secret if e.name == "STRIPE_SECRET_KEY"]) == "mutaba3a-api-stripe-secret-key"
    error_message = "STRIPE_SECRET_KEY comes from the Stripe key secret, never a plain value."
  }

  assert {
    condition     = one([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value_source[0].secret_key_ref[0].secret if e.name == "STRIPE_WEBHOOK_SECRET"]) == "mutaba3a-api-stripe-webhook-secret"
    error_message = "STRIPE_WEBHOOK_SECRET comes from the webhook secret, never a plain value."
  }

  assert {
    condition     = [for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value_source[0].secret_key_ref[0].version if contains(["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"], e.name)] == ["latest", "latest"]
    error_message = "Both Stripe env vars read their secret's latest version, so a key rotation reaches the next revision."
  }

  assert {
    condition     = length([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e if e.name == "MUTABA3A_JOB_TOKEN"]) == 1
    error_message = "MUTABA3A_JOB_TOKEN stays mounted with Stripe on."
  }

  assert {
    condition     = length(google_monitoring_alert_policy.stripe) == 0
    error_message = "With no alert channel set, Stripe on creates no alert policy (like MUT-328's)."
  }
}

run "stripe_enabled_alerts_on_what_needs_the_operator_and_a_failed_job" {
  command = apply

  variables {
    stripe_enabled              = true
    alert_email                 = "ops@example.com"
    alert_notification_channels = ["projects/test-project/notificationChannels/111"]
  }

  assert {
    condition     = toset(keys(google_monitoring_alert_policy.stripe)) == toset(["sync", "reconcile", "scheduler"])
    error_message = "One policy each: the webhook sync, the reconcile's own log lines, and the Scheduler job's failed attempts."
  }

  assert {
    condition = alltrue([
      for p in values(google_monitoring_alert_policy.stripe) :
      toset(p.notification_channels) == toset([google_monitoring_notification_channel.email[0].name, "projects/test-project/notificationChannels/111"])
    ])
    error_message = "Every Stripe policy notifies the MUT-328 channels."
  }

  assert {
    condition = alltrue([
      for p in values(google_monitoring_alert_policy.stripe) :
      p.alert_strategy[0].notification_rate_limit[0].period == "3600s" && length(p.conditions) == 1
    ])
    error_message = "Each is one log-match condition, at most one notice an hour."
  }

  assert {
    condition = alltrue([
      for msg in ["stripe sync needs the operator", "stripe event failed; Stripe will redeliver", "stripe refused a re-fetch"] :
      strcontains(google_monitoring_alert_policy.stripe["sync"].conditions[0].condition_matched_log[0].filter, "\"${msg}\"")
    ])
    error_message = "The sync policy matches the three webhook messages exactly."
  }

  assert {
    condition = alltrue([
      for msg in ["stripe reconcile needs the operator", "stripe reconcile could not list"] :
      strcontains(google_monitoring_alert_policy.stripe["reconcile"].conditions[0].condition_matched_log[0].filter, "\"${msg}\"")
    ])
    error_message = "The reconcile policy matches both reconcile messages exactly."
  }

  assert {
    condition = alltrue([
      for k in ["sync", "reconcile"] :
      startswith(google_monitoring_alert_policy.stripe[k].conditions[0].condition_matched_log[0].filter, "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"mutaba3a-api\" AND jsonPayload.msg=(")
    ])
    error_message = "The API's policies read only mutaba3a-api's logs, by pino's msg field."
  }

  assert {
    condition     = google_monitoring_alert_policy.stripe["scheduler"].conditions[0].condition_matched_log[0].filter == "resource.type=\"cloud_scheduler_job\" AND resource.labels.job_id=\"mutaba3a-stripe-reconcile\" AND severity>=ERROR"
    error_message = "The job policy matches the reconcile job's failed attempts (Scheduler logs a non-2xx or a timeout at ERROR)."
  }

  assert {
    condition     = google_monitoring_alert_policy.stripe["scheduler"].conditions[0].condition_matched_log[0].filter == "resource.type=\"cloud_scheduler_job\" AND resource.labels.job_id=\"${google_cloud_scheduler_job.stripe_reconcile[0].name}\" AND severity>=ERROR"
    error_message = "The job policy names the job Terraform creates."
  }
}

run "a_non_production_environment_suffixes_every_name" {
  command = apply

  variables {
    environment    = "staging"
    stripe_enabled = true
  }

  assert {
    condition = (
      google_secret_manager_secret.stripe_secret_key.secret_id == "mutaba3a-api-stripe-secret-key-staging"
      && google_secret_manager_secret.stripe_webhook_secret.secret_id == "mutaba3a-api-stripe-webhook-secret-staging"
      && google_secret_manager_secret.job_token.secret_id == "mutaba3a-api-job-token-staging"
    )
    error_message = "Staging's secrets carry the -staging suffix, so they never collide with production's."
  }

  assert {
    condition = (
      one([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value_source[0].secret_key_ref[0].secret if e.name == "STRIPE_SECRET_KEY"]) == "mutaba3a-api-stripe-secret-key-staging"
      && one([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value_source[0].secret_key_ref[0].secret if e.name == "STRIPE_WEBHOOK_SECRET"]) == "mutaba3a-api-stripe-webhook-secret-staging"
      && one([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value_source[0].secret_key_ref[0].secret if e.name == "MUTABA3A_JOB_TOKEN"]) == "mutaba3a-api-job-token-staging"
    )
    error_message = "Staging's service mounts staging's secrets."
  }

  assert {
    condition     = google_cloud_scheduler_job.stripe_reconcile[0].name == "mutaba3a-stripe-reconcile-staging"
    error_message = "Staging's reconcile job carries the -staging suffix."
  }
}

run "a_non_production_environment_alerts_on_its_own_job_and_service" {
  command = apply

  variables {
    environment    = "staging"
    stripe_enabled = true
    alert_email    = "ops@example.com"
  }

  assert {
    condition = (
      strcontains(google_monitoring_alert_policy.stripe["scheduler"].conditions[0].condition_matched_log[0].filter, "resource.labels.job_id=\"mutaba3a-stripe-reconcile-staging\"")
      && strcontains(google_monitoring_alert_policy.stripe["sync"].conditions[0].condition_matched_log[0].filter, "resource.labels.service_name=\"mutaba3a-api-staging\"")
      && strcontains(google_monitoring_alert_policy.stripe["reconcile"].conditions[0].condition_matched_log[0].filter, "resource.labels.service_name=\"mutaba3a-api-staging\"")
    )
    error_message = "Staging's Stripe alerts watch staging's job and service only."
  }
}
