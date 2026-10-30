# MUT-487 (ADR-232) and MUT-511 (ADR-233): the switches the project move turns, and the new project's sizing,
# budget and registry cleanup, checked offline. The Google and random providers are mocked, so this needs no
# credentials, project or network:
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
      uri = "https://service-abc123-zf.a.run.example"
    }
  }
  mock_data "google_project" {
    defaults = {
      number = "123456789012"
    }
  }
}
mock_provider "random" {}

variables {
  project_id = "test-project"
  image_tag  = "test"
}

# --- T12 (R2, D3): scheduler_paused ------------------------------------------------------------------

run "jobs_run_by_default" {
  command = plan

  variables {
    stripe_enabled = true
    oauth_enabled  = true
  }

  assert {
    condition     = !google_cloud_scheduler_job.account_purge.paused && !google_cloud_scheduler_job.stripe_reconcile[0].paused && !google_cloud_scheduler_job.oauth_cleanup[0].paused
    error_message = "Without scheduler_paused every job runs, as before MUT-487."
  }
}

run "scheduler_paused_pauses_every_job" {
  command = plan

  variables {
    stripe_enabled       = true
    oauth_enabled        = true
    mailer               = "resend"
    mail_reply_to        = "support@example.com"
    mail_daily_cap       = 90
    billing_gate_enabled = true
    hosts_file           = "../../../config/fixtures/hosts.placeholder.json"
    scheduler_paused     = true
  }

  assert {
    condition = alltrue([
      google_cloud_scheduler_job.account_purge.paused,
      google_cloud_scheduler_job.stripe_reconcile[0].paused,
      google_cloud_scheduler_job.oauth_cleanup[0].paused,
      google_cloud_scheduler_job.trial_mail[0].paused,
    ])
    error_message = "scheduler_paused pauses all four jobs, so a rehearsal copy never mails or purges anyone."
  }
}

# --- T13 (R3, D4): api_public ----------------------------------------------------------------------

run "public_by_default" {
  command = plan

  assert {
    condition     = length(google_cloud_run_v2_service_iam_member.public) == 1 && google_cloud_run_v2_service_iam_member.public[0].member == "allUsers"
    error_message = "By default allUsers may invoke the service (it authenticates every request itself)."
  }
}

run "api_public_false_drops_the_allusers_binding_and_live_label_false_marks_it" {
  command = plan

  variables {
    api_public = false
    live_label = false
  }

  assert {
    condition     = length(google_cloud_run_v2_service_iam_member.public) == 0
    error_message = "api_public = false: no allUsers invoker, so only callers with run.invoker reach the rehearsal service."
  }

  assert {
    condition     = google_cloud_run_v2_service.api.labels["mtb3a-live"] == "false"
    error_message = "live_label = false labels the service mtb3a-live=false, the signal project-move.sh reads."
  }
}

run "the_live_label_is_owned_by_terraform" {
  command = plan

  assert {
    condition     = google_cloud_run_v2_service.api.labels["mtb3a-live"] == "true" && google_cloud_run_v2_service.api.labels["app"] == "mutaba3a-api"
    error_message = "The service carries mtb3a-live=true by default, beside the existing labels."
  }
}

# --- R5 (D9): the forwarder token in the new project -----------------------------------------------------

run "the_new_project_generates_the_forwarder_token_and_the_api_reads_it" {
  command = apply

  assert {
    condition     = google_secret_manager_secret.forwarder_token.secret_id == "mutaba3a-api-forwarder-token" && length(google_secret_manager_secret_version.forwarder_token) == 1
    error_message = "The production stack generates the forwarder token."
  }

  assert {
    condition     = one([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value_source[0].secret_key_ref[0].secret if e.name == "FORWARDER_TOKEN"]) == "mutaba3a-api-forwarder-token"
    error_message = "The API mounts FORWARDER_TOKEN, to trust a relayed caller's IP."
  }

  assert {
    condition     = length(google_service_account.forwarder) == 0
    error_message = "No forwarder account outside the old project."
  }
}

# --- T14 (D6/D7, AM4): legacy_forwarder on the old project --------------------------------------------------

run "the_old_stack_creates_the_token_secret_empty_and_keeps_serving_the_api" {
  command = plan

  variables {
    legacy_stack = true
  }

  assert {
    condition     = length(google_secret_manager_secret_version.forwarder_token) == 0 && length(random_password.forwarder_token) == 0
    error_message = "The old stack never generates a token: project-move.sh secrets copies the new one in."
  }

  assert {
    condition     = length([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e if e.name == "FORWARDER_TOKEN"]) == 0 && google_cloud_run_v2_service.api.template[0].containers[0].args == null
    error_message = "Until legacy_forwarder, the old service runs the API as before, and never trusts the token."
  }
}

run "legacy_forwarder_runs_the_forwarder_with_no_database_and_no_api_secrets" {
  command = apply

  variables {
    legacy_stack     = true
    legacy_forwarder = true
    forward_to       = "https://service-new-zf.a.run.example"
    stripe_enabled   = true
  }

  assert {
    condition     = length(google_cloud_run_v2_service.api.template[0].containers) == 1 && google_cloud_run_v2_service.api.template[0].containers[0].args == tolist(["dist/forwarder.js"])
    error_message = "The service runs the forwarder entrypoint of the same image."
  }

  assert {
    condition     = length(google_cloud_run_v2_service.api.template[0].volumes) == 0 && length(google_cloud_run_v2_service.api.template[0].containers[0].volume_mounts) == 0
    error_message = "No Cloud SQL mount."
  }

  assert {
    condition = (
      toset([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.name]) == toset(["FORWARD_TO", "FORWARDER_TOKEN"])
      && one([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value if e.name == "FORWARD_TO"]) == "https://service-new-zf.a.run.example"
    )
    error_message = "Its only env: where to forward, and the forwarder token. No DATABASE_URL, admin token, pepper or provider secret."
  }

  assert {
    condition     = google_cloud_run_v2_service.api.template[0].service_account == google_service_account.forwarder[0].email && length(google_secret_manager_secret_iam_member.forwarder_reads_token) == 1
    error_message = "It runs as its own account, which may read only the forwarder token."
  }

  assert {
    condition     = google_cloud_scheduler_job.account_purge.paused && google_cloud_scheduler_job.stripe_reconcile[0].paused
    error_message = "Behind the forwarder the old jobs would reach the new service a second time: they stay paused."
  }
}

run "legacy_forwarder_needs_the_old_stack_and_an_origin" {
  command = plan

  variables {
    legacy_forwarder = true
    forward_to       = "https://service-new-zf.a.run.example"
  }

  expect_failures = [google_cloud_run_v2_service.api]
}

run "legacy_forwarder_refuses_a_url_with_a_path" {
  command = plan

  variables {
    legacy_stack     = true
    legacy_forwarder = true
    forward_to       = "https://service-new-zf.a.run.example/v1"
  }

  expect_failures = [google_cloud_run_v2_service.api]
}

# --- MUT-511 (ADR-233): db-f1-micro, ZONAL, pool 5 of 25 ------------------------------------------------------

run "the_new_project_sizing_fits_the_connection_budget" {
  command = apply

  variables {
    db_tier            = "db-f1-micro"
    db_availability    = "ZONAL"
    db_pool_size       = 5
    db_max_connections = 25
    min_instances      = 0
  }

  assert {
    condition = (
      google_sql_database_instance.postgres.settings[0].tier == "db-f1-micro"
      && google_sql_database_instance.postgres.settings[0].availability_type == "ZONAL"
      && one([for f in google_sql_database_instance.postgres.settings[0].database_flags : f.value if f.name == "max_connections"]) == "25"
      && endswith(google_secret_manager_secret_version.database_url.secret_data, "&connection_limit=5")
    )
    error_message = "db-f1-micro, ZONAL, max_connections 25 and a pool of 5: 2 x 5 x 1 + 10 = 20 <= 25 (MUT-270)."
  }

  assert {
    condition = (
      google_sql_database_instance.postgres.settings[0].backup_configuration[0].enabled
      && google_sql_database_instance.postgres.settings[0].backup_configuration[0].point_in_time_recovery_enabled
      && google_sql_database_instance.postgres.deletion_protection
    )
    error_message = "Backups, PITR and deletion protection stay on with the smaller instance (MUT-511 AC1)."
  }

  assert {
    condition     = google_cloud_run_v2_service.api.template[0].scaling[0].min_instance_count == 0 && google_cloud_run_v2_service.api.template[0].scaling[0].max_instance_count == 1
    error_message = "min_instances 0 (Basel, 2026-10-30), max stays 1 (TD-017)."
  }
}

run "a_pool_of_8_on_db_f1_micro_is_refused" {
  command = plan

  variables {
    db_tier            = "db-f1-micro"
    db_pool_size       = 8 # 2 x 8 + 10 = 26 > 25
    db_max_connections = 25
  }

  expect_failures = [google_secret_manager_secret_version.database_url]
}

# --- MUT-511: the registry cleanup and the budget ----------------------------------------------------------

run "registry_cleanup_keeps_the_3_newest_and_deletes_untagged_after_7_days_as_a_dry_run" {
  command = plan

  assert {
    condition     = google_artifact_registry_repository.images.cleanup_policy_dry_run
    error_message = "The cleanup starts as a dry run; Basel turns it on after reading it."
  }

  assert {
    condition = (
      one([for p in google_artifact_registry_repository.images.cleanup_policies : p.most_recent_versions[0].keep_count if p.id == "keep-3-newest"]) == 3
      && one([for p in google_artifact_registry_repository.images.cleanup_policies : p.action if p.id == "keep-3-newest"]) == "KEEP"
      && one([for p in google_artifact_registry_repository.images.cleanup_policies : p.condition[0].tag_state if p.id == "delete-untagged-after-7-days"]) == "UNTAGGED"
      && one([for p in google_artifact_registry_repository.images.cleanup_policies : p.condition[0].older_than if p.id == "delete-untagged-after-7-days"]) == "604800s"
    )
    error_message = "Keep the 3 newest (rollback.sh needs them); delete only untagged images older than 7 days."
  }
}

run "no_budget_without_a_billing_account" {
  command = plan

  assert {
    condition     = length(google_billing_budget.project) == 0
    error_message = "The shared old project gets no budget: its bill is Malafat's too."
  }
}

run "a_100_ils_budget_alerting_at_50_90_and_100_percent" {
  command = plan

  variables {
    billing_account_id = "000000-AAAAAA-BBBBBB"
    alert_email        = "ops@example.com"
  }

  assert {
    condition = (
      google_billing_budget.project[0].amount[0].specified_amount[0].currency_code == "ILS"
      && google_billing_budget.project[0].amount[0].specified_amount[0].units == "100"
      && [for r in google_billing_budget.project[0].threshold_rules : r.threshold_percent] == [0.5, 0.9, 1.0]
      && google_billing_budget.project[0].budget_filter[0].projects == toset(["projects/123456789012"])
    )
    error_message = "₪100 a month on this project, alerting at 50%, 90% and 100%."
  }

  assert {
    condition     = contains(keys(google_project_service.apis), "billingbudgets.googleapis.com")
    error_message = "The budget API is enabled with the budget."
  }
}
