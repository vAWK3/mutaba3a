# MUT-359 (ADR-159 §5): mail on Cloud Run, checked offline. mailer is noop by default, so merging changes nothing in
# production but two empty secrets and their grants. The providers are mocked: no credentials, project or network.
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

run "noop_by_default_sends_nothing_and_mounts_no_resend_secret" {
  command = plan

  assert {
    condition     = var.mailer == "noop"
    error_message = "mailer must default to noop, so merging MUT-359 sends no mail in production."
  }

  assert {
    condition     = one([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value if e.name == "MAILER"]) == "noop"
    error_message = "MAILER is always set, so the server's own default never decides it."
  }

  assert {
    condition     = length([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e if contains(["RESEND_API_KEY", "RESEND_WEBHOOK_SECRET", "MAIL_FROM_ADDRESS", "MAIL_REPLY_TO", "MAIL_DAILY_CAP", "TURNSTILE_SECRET"], e.name)]) == 0
    error_message = "With mailer noop Cloud Run gets no Resend env: the secrets may still be empty, and an empty secret stops the revision starting."
  }

  assert {
    condition = (
      google_secret_manager_secret.resend_api_key.secret_id == "mutaba3a-api-resend-api-key"
      && google_secret_manager_secret.resend_webhook_secret.secret_id == "mutaba3a-api-resend-webhook-secret"
      && google_secret_manager_secret_iam_member.api_reads_resend_api_key.role == "roles/secretmanager.secretAccessor"
      && google_secret_manager_secret_iam_member.api_reads_resend_webhook_secret.role == "roles/secretmanager.secretAccessor"
    )
    error_message = "The Resend secrets and their grants exist with mail off, so the operator can add versions before turning it on."
  }

  assert {
    condition     = length(google_monitoring_alert_policy.email) == 0
    error_message = "With mail off there is nothing to watch."
  }

  assert {
    condition = (
      one([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value if e.name == "SELF_SIGNUP_ENABLED"]) == "false"
      && google_secret_manager_secret.turnstile.secret_id == "mutaba3a-api-turnstile-secret"
      && google_secret_manager_secret_iam_member.api_reads_turnstile.role == "roles/secretmanager.secretAccessor"
    )
    error_message = "MUT-366: signup is off by default and always set; the Turnstile secret and its grant exist empty so the operator can add a version first."
  }
}

run "a_mail_subdomain_is_the_sender_domain" {
  command = plan

  variables {
    hosts_file     = "../../../config/fixtures/hosts.mail-subdomain.json"
    mailer         = "resend"
    mail_reply_to  = "help@example.com"
    mail_daily_cap = 90
    alert_email    = "ops@example.com"
  }

  assert {
    condition     = one([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value if e.name == "MAIL_FROM_ADDRESS"]) == "no-reply@notify.placeholder.example"
    error_message = "Basel 2026-10-25: with mailSubdomain the sender is no-reply@<mailSubdomain>.<domain>, the domain verified in Resend."
  }
}

run "resend_mounts_the_secrets_and_sends_from_the_domain" {
  command = plan

  variables {
    hosts_file     = "../../../config/fixtures/hosts.placeholder.json"
    mailer         = "resend"
    mail_reply_to  = "help@example.com"
    mail_daily_cap = 90
    alert_email    = "ops@example.com"
  }

  assert {
    condition = (
      one([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value if e.name == "MAILER"]) == "resend"
      && one([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value if e.name == "MAIL_FROM_ADDRESS"]) == "no-reply@placeholder.example"
      && one([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value if e.name == "MAIL_REPLY_TO"]) == "help@example.com"
      && one([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value if e.name == "MAIL_DAILY_CAP"]) == "90"
    )
    error_message = "The sender is no-reply@<domain> from config/hosts.json, with the reply-to and cap from this stack."
  }

  assert {
    condition = (
      one([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value_source[0].secret_key_ref[0].secret if e.name == "RESEND_API_KEY"]) == "mutaba3a-api-resend-api-key"
      && one([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value_source[0].secret_key_ref[0].secret if e.name == "RESEND_WEBHOOK_SECRET"]) == "mutaba3a-api-resend-webhook-secret"
    )
    error_message = "The sending key and the webhook secret come from Secret Manager."
  }

  assert {
    condition     = one([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value_source[0].secret_key_ref[0].secret if e.name == "TURNSTILE_SECRET"]) == "mutaba3a-api-turnstile-secret"
    error_message = "MUT-366: with mail on, recovery mails links, so the Turnstile secret is mounted (the server refuses to start without it)."
  }

  assert {
    condition     = length(google_monitoring_alert_policy.email) == 2
    error_message = "With mail on and a channel, the cap and provider alerts exist."
  }
}

run "resend_without_a_domain_fails_the_plan" {
  command = plan

  variables {
    mailer         = "resend"
    mail_reply_to  = "help@example.com"
    mail_daily_cap = 90
  }

  expect_failures = [google_cloud_run_v2_service.api]
}

run "resend_without_a_cap_fails_the_plan" {
  command = plan

  variables {
    hosts_file    = "../../../config/fixtures/hosts.placeholder.json"
    mailer        = "resend"
    mail_reply_to = "help@example.com"
  }

  expect_failures = [google_cloud_run_v2_service.api]
}

run "log_is_not_offered" {
  command = plan

  variables {
    mailer = "log"
  }

  expect_failures = [var.mailer]
}

run "signup_on_with_mail_opens_signup" {
  command = plan

  variables {
    hosts_file          = "../../../config/fixtures/hosts.placeholder.json"
    mailer              = "resend"
    mail_reply_to       = "help@example.com"
    mail_daily_cap      = 90
    self_signup_enabled = true
  }

  assert {
    condition     = one([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value if e.name == "SELF_SIGNUP_ENABLED"]) == "true"
    error_message = "MUT-366: self_signup_enabled reaches the server as SELF_SIGNUP_ENABLED=true."
  }
}

run "signup_without_mail_fails_the_plan" {
  command = plan

  variables {
    self_signup_enabled = true
  }

  expect_failures = [google_cloud_run_v2_service.api]
}
