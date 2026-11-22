# MUT-710 (ADR-274 D4): the key that seals two-step sign-in secrets (TOTP) and digests recovery codes. Generated here,
# never a tfvars value, always mounted. Replacing it would make every authenticator-app secret unreadable and void
# every recovery code (everyone with two-step sign-in locked out of it), so it can't be destroyed by a plan.

resource "random_password" "two_factor_seal_key" {
  length  = 64
  special = false

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_secret_manager_secret" "two_factor_seal_key" {
  project   = var.project_id
  secret_id = "mutaba3a-api-two-factor-seal-key${local.suffix}"
  labels    = local.labels

  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "two_factor_seal_key" {
  secret      = google_secret_manager_secret.two_factor_seal_key.id
  secret_data = random_password.two_factor_seal_key.result
}

resource "google_secret_manager_secret_iam_member" "api_reads_two_factor_seal_key" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.two_factor_seal_key.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}
