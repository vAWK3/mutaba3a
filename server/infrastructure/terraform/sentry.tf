# MUT-148 (ADR-091): the API's Sentry DSN. The Sentry stack (server/infrastructure/sentry) has its own
# state in the same bucket; this reads its `dsn` output, so a release needs no Sentry token. Nothing here
# exists until sentry_enabled, which comes after DEPLOYMENT.md §1.5 has applied that stack.

locals {
  secret_sentry_dsn   = "mutaba3a-api-sentry-dsn${local.suffix}"
  sentry_state_bucket = coalesce(var.sentry_state_bucket, "${var.project_id}-terraform-state")
}

data "terraform_remote_state" "sentry" {
  count   = var.sentry_enabled ? 1 : 0
  backend = "gcs"
  config = {
    bucket = local.sentry_state_bucket
    prefix = "mutaba3a-sentry/${var.environment}"
  }
}

resource "google_secret_manager_secret" "sentry_dsn" {
  count     = var.sentry_enabled ? 1 : 0
  project   = var.project_id
  secret_id = local.secret_sentry_dsn
  labels    = local.labels

  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "sentry_dsn" {
  count       = var.sentry_enabled ? 1 : 0
  secret      = google_secret_manager_secret.sentry_dsn[0].id
  secret_data = data.terraform_remote_state.sentry[0].outputs.dsn["api"]

  lifecycle {
    # ADR-091 D5: the same EU-region rule the server's config enforces at boot, caught at plan time instead.
    precondition {
      condition     = can(regex("^https://[A-Za-z0-9]+@[A-Za-z0-9.-]+\\.ingest\\.de\\.sentry\\.io/[0-9]+$", data.terraform_remote_state.sentry[0].outputs.dsn["api"]))
      error_message = "The Sentry stack's api DSN is not an EU-region (ingest.de.sentry.io) DSN; check the org's data region (DEPLOYMENT.md §1.5)."
    }
  }
}

resource "google_secret_manager_secret_iam_member" "api_reads_sentry_dsn" {
  count     = var.sentry_enabled ? 1 : 0
  project   = var.project_id
  secret_id = google_secret_manager_secret.sentry_dsn[0].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}
